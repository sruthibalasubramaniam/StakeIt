import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { readingApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
// (layout primitives are re-used so the editor matches every other authoring screen)
import { Button, Chip, Divider, IconButton, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, ConfirmDialog, EmptyState, ErrorBlock, LoadingBlock, Modal } from '../../components/ui/data';
import { Input, Select, Switch, Textarea } from '../../components/ui/forms';
import { RichTextEditor } from '../../components/domain/RichTextEditor';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { useCourseAreaBase } from '../../router/routeAccess';
import { cn } from '../../utils/cn';
import type { ReadingPreviewPayload, ReadingSectionAuthoring } from '../../types/api';

/**
 * Reading lesson editor.
 *
 * Authoring model:
 *  - the lesson is a draft until explicitly published; learners never see a
 *    draft (enforced by the API, not by hiding a button),
 *  - sections save individually so a long lesson never depends on one giant
 *    PUT, and every save bumps the lesson version,
 *  - checkpoints are edited inline per section and validated server-side
 *    (at least one question, a correct option, single-correct for single choice),
 *  - publishing runs the server's own checklist and shows its issues verbatim.
 */

interface SectionDraft {
  title: string;
  bodyHtml: string;
  estimatedMinutes: number | null;
}

interface CheckpointQuestionDraft {
  type: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TRUE_FALSE';
  prompt: string;
  explanation: string;
  points: number;
  options: Array<{ label: string; isCorrect: boolean }>;
}

interface CheckpointDraft {
  title: string;
  prompt: string;
  passingScore: number;
  maxAttempts: number | null;
  questions: CheckpointQuestionDraft[];
}

const EMPTY_QUESTION: CheckpointQuestionDraft = {
  type: 'SINGLE_CHOICE',
  prompt: '',
  explanation: '',
  points: 1,
  options: [
    { label: '', isCorrect: true },
    { label: '', isCorrect: false },
  ],
};

function toSectionDraft(section: ReadingSectionAuthoring): SectionDraft {
  return { title: section.title, bodyHtml: section.bodyHtml, estimatedMinutes: section.estimatedMinutes };
}

function toCheckpointDraft(section: ReadingSectionAuthoring): CheckpointDraft | null {
  if (!section.checkpoint) return null;
  return {
    title: section.checkpoint.title,
    prompt: section.checkpoint.prompt ?? '',
    passingScore: section.checkpoint.passingScore,
    maxAttempts: section.checkpoint.maxAttempts,
    questions: section.checkpoint.questions.map((question) => ({
      type: question.type,
      prompt: question.prompt,
      explanation: question.explanation ?? '',
      points: question.points,
      options: question.options.map((option) => ({ label: option.label, isCorrect: option.isCorrect })),
    })),
  };
}

export function ReadingLessonEditorPage() {
  const { courseId = '', contentId = '' } = useParams<{ courseId: string; contentId: string }>();
  const toast = useToast();
  const areaBase = useCourseAreaBase();

  const lesson = useAsync(() => readingApi.view(contentId), [contentId]);
  const [busy, setBusy] = useState(false);

  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionDraft>>({});
  const [checkpointDrafts, setCheckpointDrafts] = useState<Record<string, CheckpointDraft | null>>({});
  const [aiBusySection, setAiBusySection] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [meta, setMeta] = useState({ description: '', estimatedMinutes: '', objectives: '' });
  const [metaDirty, setMetaDirty] = useState(false);

  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceDraft, setResourceDraft] = useState({ kind: 'EXTERNAL_LINK' as 'EXTERNAL_LINK' | 'EMBED', title: '', url: '' });
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [preview, setPreview] = useState<ReadingPreviewPayload | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishIssues, setPublishIssues] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'section' | 'resource' | 'checkpoint'; id: string; title: string } | null>(null);

  useDocumentTitle(lesson.data?.content.title ?? 'Reading lesson');

  // Seed local drafts whenever the server view reloads.
  useEffect(() => {
    const data = lesson.data;
    if (!data) return;
    setSectionDrafts(Object.fromEntries(data.sections.map((section) => [section.id, toSectionDraft(section)])));
    setCheckpointDrafts(Object.fromEntries(data.sections.map((section) => [section.id, toCheckpointDraft(section)])));
    setMeta({
      description: data.content.description ?? '',
      estimatedMinutes: data.content.estimatedMinutes ? String(data.content.estimatedMinutes) : '',
      objectives: data.content.objectives.join('\n'),
    });
    setMetaDirty(false);
  }, [lesson.data]);

  const data = lesson.data;
  const totalMinutes = data?.estimatedReadingMinutes ?? 0;
  const published = data?.content.published ?? false;

  const patchSection = (sectionId: string, patch: Partial<SectionDraft>) => {
    setSectionDrafts((current) => ({ ...current, [sectionId]: { ...current[sectionId]!, ...patch } }));
  };

  const patchCheckpoint = (sectionId: string, patch: Partial<CheckpointDraft>) => {
    setCheckpointDrafts((current) => ({
      ...current,
      [sectionId]: current[sectionId] ? { ...current[sectionId]!, ...patch } : current[sectionId] ?? null,
    }));
  };

  /**
   * Drafts questions from the section text with the configured AI provider.
   *
   * They land in the editor as unsaved drafts — nothing is persisted until the
   * instructor reviews them and saves the section, which is what keeps a bad
   * generated answer key from ever reaching a learner.
   */
  const draftQuestionsWithAi = async (section: ReadingSectionAuthoring, existing: CheckpointDraft | null) => {
    setAiBusySection(section.id);
    try {
      const result = await readingApi.draftQuestions(contentId, section.id, 2);
      const generated: CheckpointQuestionDraft[] = result.questions.map((question) => ({
        type: 'SINGLE_CHOICE',
        prompt: question.prompt,
        explanation: question.explanation,
        points: 1,
        options: question.options.map((option) => ({ label: option.label, isCorrect: option.isCorrect })),
      }));

      setCheckpointDrafts((current) => {
        const base: CheckpointDraft = current[section.id] ??
          existing ?? {
            title: `Knowledge check · ${section.title}`,
            prompt: '',
            passingScore: 100,
            maxAttempts: null,
            questions: [],
          };
        return { ...current, [section.id]: { ...base, questions: [...base.questions, ...generated] } };
      });

      toast.success(
        `${generated.length} draft question(s) added`,
        'Review the wording and the correct answers, then save the section.',
      );
    } catch (caught) {
      toast.error('Could not draft questions', errorMessage(caught));
    } finally {
      setAiBusySection(null);
    }
  };

  /* -------------------------------- actions ------------------------------ */

  const saveMeta = async () => {
    setBusy(true);
    try {
      await readingApi.updateLesson(contentId, {
        description: meta.description.trim() || null,
        estimatedMinutes: meta.estimatedMinutes ? Number(meta.estimatedMinutes) : null,
        objectives: meta.objectives
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      toast.success('Lesson details saved');
      setMetaDirty(false);
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not save the lesson details', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const addSection = async () => {
    setBusy(true);
    try {
      await readingApi.createSection(contentId, {
        title: `Section ${(data?.sections.length ?? 0) + 1}`,
        bodyHtml: '<p></p>',
      });
      toast.success('Section added', 'Write the content, then save the section.');
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not add a section', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveSection = async (section: ReadingSectionAuthoring) => {
    const draft = sectionDrafts[section.id];
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error('Section title required', 'Give the section a title before saving.');
      return;
    }
    setBusy(true);
    try {
      await readingApi.updateSection(contentId, section.id, {
        title: draft.title.trim(),
        bodyHtml: draft.bodyHtml,
        estimatedMinutes: draft.estimatedMinutes,
      });
      toast.success('Section saved');
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not save the section', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const moveSection = async (index: number, direction: -1 | 1) => {
    if (!data) return;
    const target = index + direction;
    if (target < 0 || target >= data.sections.length) return;
    const ordered = data.sections.map((section) => section.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
    setBusy(true);
    try {
      await readingApi.reorderSections(contentId, ordered);
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not reorder sections', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveCheckpoint = async (sectionId: string) => {
    const draft = checkpointDrafts[sectionId];
    if (!draft) return;

    if (draft.questions.some((question) => !question.prompt.trim())) {
      toast.error('Every question needs a prompt');
      return;
    }
    if (draft.questions.some((question) => question.options.filter((option) => option.label.trim()).length < 2)) {
      toast.error('Every question needs at least two options');
      return;
    }

    setBusy(true);
    try {
      await readingApi.saveCheckpoint(contentId, sectionId, {
        title: draft.title.trim() || undefined,
        prompt: draft.prompt.trim() || null,
        passingScore: draft.passingScore,
        maxAttempts: draft.maxAttempts,
        questions: draft.questions.map((question) => ({
          type: question.type,
          prompt: question.prompt.trim(),
          explanation: question.explanation.trim() || null,
          points: question.points,
          options: question.options
            .filter((option) => option.label.trim())
            .map((option) => ({ label: option.label.trim(), isCorrect: option.isCorrect })),
        })),
      });
      toast.success('Knowledge check saved');
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not save the knowledge check', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    setPublishIssues([]);
    try {
      await readingApi.publish(contentId);
      toast.success('Lesson published', 'Learners can now read it inside the course.');
      await lesson.refetch();
    } catch (caught) {
      const details = (caught as { details?: { issues?: string[] } }).details;
      const issues = details?.issues ?? [];
      setPublishIssues(issues.length > 0 ? issues : [errorMessage(caught)]);
      toast.error('This lesson is not ready to publish', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    setBusy(true);
    try {
      await readingApi.unpublish(contentId);
      toast.success('Lesson unpublished', 'Learners keep their progress; the content is hidden until republished.');
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not unpublish', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async () => {
    setBusy(true);
    try {
      const result = await readingApi.preview(contentId);
      setPreview(result);
      setPreviewOpen(true);
    } catch (caught) {
      toast.error('Could not preview the lesson', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const addResource = async () => {
    setBusy(true);
    try {
      await readingApi.addResource(contentId, {
        kind: resourceDraft.kind,
        title: resourceDraft.title.trim(),
        url: resourceDraft.url.trim(),
      });
      toast.success('Resource attached');
      setResourceOpen(false);
      setResourceDraft({ kind: 'EXTERNAL_LINK', title: '', url: '' });
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not attach the resource', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Imports a document into draft sections.
   *
   * The server also unpublishes the lesson when it has sections, because the
   * definition of "complete" changes — that is why we refetch afterwards instead
   * of patching state optimistically.
   */
  const importDocument = async (file: File) => {
    setImporting(true);
    try {
      const result = await readingApi.importDocument(contentId, file, data?.aiConfigured ?? true);
      toast.success(
        result.mode === 'ATTACHMENT_ONLY' ? 'Attached, no text found' : 'Document imported',
        result.message,
      );
      await lesson.refetch();
    } catch (caught) {
      toast.error('Import failed', errorMessage(caught));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const uploadPdf = async (file: File) => {
    setUploading(true);
    try {
      await readingApi.uploadPdf(contentId, file);
      toast.success('PDF uploaded', 'It is stored privately and served through signed links.');
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not upload the PDF', errorMessage(caught));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (pendingDelete.kind === 'section') await readingApi.deleteSection(contentId, pendingDelete.id);
      if (pendingDelete.kind === 'resource') await readingApi.deleteResource(contentId, pendingDelete.id);
      if (pendingDelete.kind === 'checkpoint') {
        const sectionId = pendingDelete.id;
        await readingApi.deleteCheckpoint(contentId, sectionId);
      }
      toast.success('Deleted');
      setPendingDelete(null);
      await lesson.refetch();
    } catch (caught) {
      toast.error('Could not delete', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const issuesPreview = useMemo(() => publishIssues, [publishIssues]);

  if (lesson.loading) return <LoadingBlock label="Loading reading lesson…" rows={5} />;
  if (lesson.error || !data) {
    return <ErrorBlock title="Could not load this reading lesson" message={lesson.error} onRetry={() => void lesson.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-space-lg pb-space-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <Link
          to={`${areaBase}/${courseId}/builder`}
          className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" className="text-[16px]" />
          Course builder
        </Link>
        <div className="flex flex-wrap items-center gap-space-sm">
          <Chip tone={published ? 'earned' : 'info'} icon={published ? 'visibility' : 'edit_note'}>
            {published ? 'published' : 'draft'}
          </Chip>
          <Button variant="secondary" icon="visibility" loading={busy} onClick={() => void openPreview()}>
            Preview
          </Button>
          {published ? (
            <Button variant="secondary" icon="visibility_off" loading={busy} onClick={() => void unpublish()}>
              Unpublish
            </Button>
          ) : (
            <Button icon="publish" loading={busy} onClick={() => void publish()}>
              Publish lesson
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-space-xs">
        <span className="micro-label text-on-surface-variant">Reading lesson · version {data.content.version}</span>
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">{data.content.title}</h1>
        <span className="font-label-xs text-label-xs text-on-surface-variant">
          {data.sections.length} section(s) · {totalMinutes} min estimated · {data.resources.length} resource(s)
          {published ? '' : ' · learners cannot see this lesson until it is published'}
        </span>
      </div>

      {issuesPreview.length > 0 ? (
        <Alert tone="error" title="Not ready to publish">
          <ul className="list-disc pl-5">
            {issuesPreview.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {!data.storageConfigured ? (
        <Alert tone="warning" title="PDF storage is not configured">
          Uploading PDFs requires <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> and{' '}
          <code>SUPABASE_STORAGE_BUCKET</code> on the API. External links and written sections work without it.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        {/* Lesson details */}
        <Card className="lg:col-span-1">
          <CardHeader title="Lesson details" subtitle="Shown above the first section" />
          <Divider />
          <div className="flex flex-col gap-space-md p-space-lg">
            <Textarea
              label="Description"
              rows={3}
              value={meta.description}
              onChange={(event) => {
                setMeta((current) => ({ ...current, description: event.target.value }));
                setMetaDirty(true);
              }}
              placeholder="What this lesson covers and why it matters"
            />
            <Input
              label="Estimated reading time (minutes)"
              type="number"
              min={0}
              value={meta.estimatedMinutes}
              onChange={(event) => {
                setMeta((current) => ({ ...current, estimatedMinutes: event.target.value }));
                setMetaDirty(true);
              }}
              hint="Leave empty to estimate from word count."
            />
            <Textarea
              label="Learning objectives"
              rows={4}
              value={meta.objectives}
              onChange={(event) => {
                setMeta((current) => ({ ...current, objectives: event.target.value }));
                setMetaDirty(true);
              }}
              hint="One objective per line."
            />
            <div className="flex justify-end">
              <Button size="sm" icon="save" loading={busy} disabled={!metaDirty} onClick={() => void saveMeta()}>
                Save details
              </Button>
            </div>
          </div>
        </Card>

        {/* Sections */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Sections"
            subtitle="Learners unlock sections in order; a checkpoint gates its section."
            action={<Chip tone="info">{data.sections.length} section(s)</Chip>}
          />
          <Divider />

          {/*
            Import turns a document into draft sections. The server unpublishes
            the lesson when it does, so this never leaks to learners unreviewed.
          */}
          <div className="flex flex-wrap items-center gap-space-sm px-space-lg py-space-md">
            <input
              ref={importInputRef}
              type="file"
              accept=".pdf,.docx,.md,.markdown,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importDocument(file);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              icon="upload_file"
              loading={importing}
              disabled={busy}
              onClick={() => importInputRef.current?.click()}
            >
              Import document
            </Button>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              PDF, DOCX, Markdown or TXT → draft sections
              {data.aiConfigured ? ' + AI knowledge checks' : ''}
            </span>
            <div className="ml-auto">
              <Button size="sm" icon="add" loading={busy} onClick={() => void addSection()}>
                Add section
              </Button>
            </div>
          </div>

          {data.sections.length === 0 ? (
            <EmptyState
              icon="article"
              title="No sections yet"
              description="Add sections to build the reading. Each section can carry images, tables, code blocks and links, and optionally a knowledge check."
              action={
                <Button icon="add" loading={busy} onClick={() => void addSection()}>
                  Add the first section
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-outline-variant">
              {data.sections.map((section, index) => {
                const draft = sectionDrafts[section.id] ?? toSectionDraft(section);
                const checkpointDraft = checkpointDrafts[section.id] ?? null;
                const isOpen = expanded[section.id] ?? index === 0;
                const dirty =
                  draft.title !== section.title ||
                  draft.bodyHtml !== section.bodyHtml ||
                  draft.estimatedMinutes !== section.estimatedMinutes;

                return (
                  <li key={section.id} className="flex flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-space-sm px-space-lg py-space-md">
                      <button
                        type="button"
                        onClick={() => setExpanded((current) => ({ ...current, [section.id]: !isOpen }))}
                        aria-expanded={isOpen}
                        className="flex min-w-0 flex-1 items-center gap-space-sm text-left"
                      >
                        <MaterialIcon name={isOpen ? 'expand_less' : 'expand_more'} className="text-on-surface-variant" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-label-md text-label-md text-on-surface">
                            {index + 1}. {draft.title || 'Untitled section'}
                          </span>
                          <span className="font-label-xs text-label-xs text-on-surface-variant">
                            {section.wordCount} word(s)
                            {checkpointDraft ? ` · knowledge check (${checkpointDraft.questions.length} q)` : ' · no checkpoint'}
                            {dirty ? ' · unsaved changes' : ''}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-space-xs">
                        <IconButton
                          icon="arrow_upward"
                          label="Move section up"
                          disabled={index === 0 || busy}
                          onClick={() => void moveSection(index, -1)}
                        />
                        <IconButton
                          icon="arrow_downward"
                          label="Move section down"
                          disabled={index === data.sections.length - 1 || busy}
                          onClick={() => void moveSection(index, 1)}
                        />
                        <IconButton
                          icon="delete"
                          label="Delete section"
                          className="text-error"
                          disabled={busy}
                          onClick={() => setPendingDelete({ kind: 'section', id: section.id, title: draft.title })}
                        />
                      </div>
                    </div>

                    {isOpen ? (
                      <div className="flex flex-col gap-space-md border-t border-outline-variant bg-surface-container-low/40 px-space-lg py-space-md">
                        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
                          <Input
                            label="Section title"
                            className="sm:col-span-2"
                            value={draft.title}
                            onChange={(event) => patchSection(section.id, { title: event.target.value })}
                          />
                          <Input
                            label="Minutes (optional)"
                            type="number"
                            min={0}
                            value={draft.estimatedMinutes ?? ''}
                            onChange={(event) =>
                              patchSection(section.id, {
                                estimatedMinutes: event.target.value ? Number(event.target.value) : null,
                              })
                            }
                          />
                        </div>

                        <RichTextEditor
                          label="Section content"
                          value={draft.bodyHtml}
                          onChange={(html) => patchSection(section.id, { bodyHtml: html })}
                          hint="Headings, lists, tables, code blocks, links and images. Markup is sanitised on save."
                        />

                        <div className="flex flex-wrap items-center justify-between gap-space-sm">
                          <span className="font-label-xs text-label-xs text-on-surface-variant">
                            {checkpointDraft
                              ? 'Learners must pass this knowledge check to unlock the next section.'
                              : 'Learners will mark this section as read to continue.'}
                          </span>
                           <div className="flex items-center gap-space-sm">
                             {data?.aiConfigured ? (
                               <Button
                                 size="sm"
                                 variant="ghost"
                                 icon="auto_awesome"
                                 loading={aiBusySection === section.id}
                                 disabled={busy || draft.bodyHtml.trim().length < 200}
                                 title={
                                   draft.bodyHtml.trim().length < 200
                                     ? 'Write a couple of paragraphs first — the questions must come from the section text'
                                     : 'Draft questions from this section text'
                                 }
                                 onClick={() => void draftQuestionsWithAi(section, checkpointDraft)}
                               >
                                 {checkpointDraft ? 'Draft more with AI' : 'Draft with AI'}
                               </Button>
                             ) : null}
                             {checkpointDraft ? (
                               <Button
                                 size="sm"
                                 variant="ghost"
                                 icon="delete"
                                className="text-error"
                                disabled={busy}
                                onClick={() => setPendingDelete({ kind: 'checkpoint', id: section.id, title: draft.title })}
                              >
                                Remove checkpoint
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                icon="quiz"
                                disabled={busy}
                                onClick={() =>
                                  setCheckpointDrafts((current) => ({
                                    ...current,
                                    [section.id]: {
                                      title: `Knowledge check · ${draft.title || `Section ${index + 1}`}`,
                                      prompt: '',
                                      passingScore: 100,
                                      maxAttempts: null,
                                      questions: [{ ...EMPTY_QUESTION, options: EMPTY_QUESTION.options.map((option) => ({ ...option })) }],
                                    },
                                  }))
                                }
                              >
                                Add knowledge check
                              </Button>
                            )}
                            <Button size="sm" icon="save" loading={busy} disabled={!dirty && !checkpointDraft} onClick={() => void saveSection(section)}>
                              Save section
                            </Button>
                          </div>
                        </div>

                        {/* Checkpoint editor */}
                        {checkpointDraft ? (
                          <div className="flex flex-col gap-space-md rounded border border-outline-variant bg-surface-container-lowest p-space-md">
                            <div className="flex items-center gap-space-sm">
                              <MaterialIcon name="quiz" className="text-on-surface-variant" />
                              <span className="font-label-md text-label-md text-on-surface">Knowledge check</span>
                            </div>

                            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
                              <Input
                                label="Checkpoint title"
                                value={checkpointDraft.title}
                                onChange={(event) => patchCheckpoint(section.id, { title: event.target.value })}
                              />
                              <Input
                                label="Passing score %"
                                type="number"
                                min={0}
                                max={100}
                                value={checkpointDraft.passingScore}
                                onChange={(event) => patchCheckpoint(section.id, { passingScore: Number(event.target.value) })}
                              />
                            </div>
                            <Input
                              label="Intro prompt (optional)"
                              value={checkpointDraft.prompt}
                              onChange={(event) => patchCheckpoint(section.id, { prompt: event.target.value })}
                              placeholder="Answer to unlock the next section"
                            />
                            <Switch
                              checked={checkpointDraft.maxAttempts === null}
                              onChange={(unlimited) =>
                                patchCheckpoint(section.id, { maxAttempts: unlimited ? null : 3 })
                              }
                              label="Unlimited attempts"
                              description="Turn off to cap how many times a learner can retry."
                            />
                            {checkpointDraft.maxAttempts !== null ? (
                              <Input
                                label="Max attempts"
                                type="number"
                                min={1}
                                max={20}
                                value={checkpointDraft.maxAttempts}
                                onChange={(event) =>
                                  patchCheckpoint(section.id, { maxAttempts: Number(event.target.value) || 1 })
                                }
                              />
                            ) : null}

                            <Divider />

                            {checkpointDraft.questions.map((question, questionIndex) => (
                              <div key={questionIndex} className="flex flex-col gap-space-sm rounded border border-outline-variant p-space-md">
                                <div className="flex items-center justify-between gap-space-sm">
                                  <span className="micro-label text-on-surface-variant">Question {questionIndex + 1}</span>
                                  <div className="flex items-center gap-space-xs">
                                    <Select
                                      className="w-40"
                                      value={question.type}
                                      onChange={(event) =>
                                        patchCheckpoint(section.id, {
                                          questions: checkpointDraft.questions.map((entry, i) =>
                                            i === questionIndex
                                              ? { ...entry, type: event.target.value as CheckpointQuestionDraft['type'] }
                                              : entry,
                                          ),
                                        })
                                      }
                                      options={[
                                        { value: 'SINGLE_CHOICE', label: 'Single choice' },
                                        { value: 'MULTI_CHOICE', label: 'Multi choice' },
                                        { value: 'TRUE_FALSE', label: 'True / false' },
                                      ]}
                                    />
                                    <IconButton
                                      icon="delete"
                                      label={`Remove question ${questionIndex + 1}`}
                                      className="text-error"
                                      disabled={checkpointDraft.questions.length === 1}
                                      onClick={() =>
                                        patchCheckpoint(section.id, {
                                          questions: checkpointDraft.questions.filter((_, i) => i !== questionIndex),
                                        })
                                      }
                                    />
                                  </div>
                                </div>

                                <Textarea
                                  label="Prompt"
                                  rows={2}
                                  value={question.prompt}
                                  onChange={(event) =>
                                    patchCheckpoint(section.id, {
                                      questions: checkpointDraft.questions.map((entry, i) =>
                                        i === questionIndex ? { ...entry, prompt: event.target.value } : entry,
                                      ),
                                    })
                                  }
                                />

                                <div className="flex flex-col gap-space-xs">
                                  <span className="font-label-sm text-label-sm text-on-surface">Options</span>
                                  {question.options.map((option, optionIndex) => (
                                    <div key={optionIndex} className="flex items-center gap-space-sm">
                                      <input
                                        type={question.type === 'MULTI_CHOICE' ? 'checkbox' : 'radio'}
                                        name={`correct-${section.id}-${questionIndex}`}
                                        checked={option.isCorrect}
                                        aria-label={`Mark option ${optionIndex + 1} correct`}
                                        onChange={() =>
                                          patchCheckpoint(section.id, {
                                            questions: checkpointDraft.questions.map((entry, i) =>
                                              i === questionIndex
                                                ? {
                                                    ...entry,
                                                    options: entry.options.map((candidate, oi) =>
                                                      question.type === 'MULTI_CHOICE'
                                                        ? oi === optionIndex
                                                          ? { ...candidate, isCorrect: !candidate.isCorrect }
                                                          : candidate
                                                        : { ...candidate, isCorrect: oi === optionIndex },
                                                    ),
                                                  }
                                                : entry,
                                            ),
                                          })
                                        }
                                        className="h-4 w-4 accent-[#4338CA]"
                                      />
                                      <Input
                                        className="flex-1"
                                        placeholder={`Option ${optionIndex + 1}`}
                                        value={option.label}
                                        onChange={(event) =>
                                          patchCheckpoint(section.id, {
                                            questions: checkpointDraft.questions.map((entry, i) =>
                                              i === questionIndex
                                                ? {
                                                    ...entry,
                                                    options: entry.options.map((candidate, oi) =>
                                                      oi === optionIndex ? { ...candidate, label: event.target.value } : candidate,
                                                    ),
                                                  }
                                                : entry,
                                            ),
                                          })
                                        }
                                      />
                                    </div>
                                  ))}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    icon="add"
                                    onClick={() =>
                                      patchCheckpoint(section.id, {
                                        questions: checkpointDraft.questions.map((entry, i) =>
                                          i === questionIndex
                                            ? { ...entry, options: [...entry.options, { label: '', isCorrect: false }] }
                                            : entry,
                                        ),
                                      })
                                    }
                                  >
                                    Add option
                                  </Button>
                                </div>

                                <Input
                                  label="Explanation (shown after passing)"
                                  value={question.explanation}
                                  onChange={(event) =>
                                    patchCheckpoint(section.id, {
                                      questions: checkpointDraft.questions.map((entry, i) =>
                                        i === questionIndex ? { ...entry, explanation: event.target.value } : entry,
                                      ),
                                    })
                                  }
                                />
                              </div>
                            ))}

                            <div className="flex flex-wrap items-center justify-between gap-space-sm">
                              <Button
                                size="sm"
                                variant="secondary"
                                icon="add"
                                disabled={checkpointDraft.questions.length >= data.limits.maxQuestionsPerCheckpoint}
                                onClick={() =>
                                  patchCheckpoint(section.id, {
                                    questions: [
                                      ...checkpointDraft.questions,
                                      { ...EMPTY_QUESTION, options: EMPTY_QUESTION.options.map((option) => ({ ...option })) },
                                    ],
                                  })
                                }
                              >
                                Add question
                              </Button>
                              <Button size="sm" icon="save" loading={busy} onClick={() => void saveCheckpoint(section.id)}>
                                Save knowledge check
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <Divider />
          <div className="flex flex-wrap items-center justify-between gap-space-sm p-space-lg">
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              {data.sections.length}/{data.limits.maxSections} sections used
            </span>
            <Button icon="add" loading={busy} disabled={data.sections.length >= data.limits.maxSections} onClick={() => void addSection()}>
              Add section
            </Button>
          </div>
        </Card>
      </div>

      {/* Resources */}
      <Card>
        <CardHeader
          title="Attached materials"
          subtitle="PDFs and external resources shown alongside the reading"
          action={
            <div className="flex items-center gap-space-sm">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadPdf(file);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                icon="upload_file"
                loading={uploading}
                disabled={!data.storageConfigured || data.resources.length >= data.limits.maxResources}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload PDF
              </Button>
              <Button
                size="sm"
                icon="add_link"
                disabled={data.resources.length >= data.limits.maxResources}
                onClick={() => setResourceOpen(true)}
              >
                Attach link
              </Button>
            </div>
          }
        />
        <Divider />
        {data.resources.length === 0 ? (
          <EmptyState
            icon="attach_file"
            title="No attached materials"
            description="Upload a PDF or attach an external article, Google Drive file or slide deck."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-outline-variant">
            {data.resources.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center justify-between gap-space-md px-space-lg py-space-sm">
                <span className="flex min-w-0 items-center gap-space-sm">
                  <MaterialIcon
                    name={resource.kind === 'PDF' ? 'picture_as_pdf' : resource.kind === 'EMBED' ? 'slideshow' : 'link'}
                    className="text-on-surface-variant"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-label-md text-label-md text-on-surface">{resource.title}</span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">
                      {resource.kind === 'PDF' ? resource.fileName ?? 'PDF' : resource.url}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-space-xs">
                  {resource.kind !== 'PDF' && resource.url ? (
                    <a href={resource.url} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="secondary" icon="open_in_new">
                        Open
                      </Button>
                    </a>
                  ) : null}
                  <IconButton
                    icon="delete"
                    label={`Remove ${resource.title}`}
                    className="text-error"
                    disabled={busy}
                    onClick={() => setPendingDelete({ kind: 'resource', id: resource.id, title: resource.title })}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Attach link modal */}
      <Modal
        open={resourceOpen}
        onClose={() => setResourceOpen(false)}
        title="Attach a resource"
        description="Only http(s) links are accepted. Google Drive share links work when set to “anyone with the link”."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResourceOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              icon="add_link"
              loading={busy}
              disabled={!resourceDraft.title.trim() || !resourceDraft.url.trim()}
              onClick={() => void addResource()}
            >
              Attach
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-md">
          <Select
            label="Type"
            value={resourceDraft.kind}
            onChange={(event) =>
              setResourceDraft((current) => ({ ...current, kind: event.target.value as 'EXTERNAL_LINK' | 'EMBED' }))
            }
            options={[
              { value: 'EXTERNAL_LINK', label: 'External article / file' },
              { value: 'EMBED', label: 'Embeddable resource' },
            ]}
          />
          <Input
            label="Title"
            value={resourceDraft.title}
            onChange={(event) => setResourceDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="Course notes (Google Drive)"
          />
          <Input
            label="URL"
            type="url"
            value={resourceDraft.url}
            onChange={(event) => setResourceDraft((current) => ({ ...current, url: event.target.value }))}
            placeholder="https://drive.google.com/…"
          />
        </div>
      </Modal>

      {/* Preview modal */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Lesson preview"
        description="Rendered from the saved draft. Answer keys are hidden, exactly as a learner would see them."
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        }
      >
        {preview ? (
          <div className="flex flex-col gap-space-lg">
            {preview.publishIssues.length > 0 ? (
              <Alert tone="warning" title="Publish checklist">
                <ul className="list-disc pl-5">
                  {preview.publishIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="success" title="Ready to publish">
                No blocking issues found by the server.
              </Alert>
            )}

            {preview.sections.map((section, index) => (
              <section key={section.id} className="flex flex-col gap-space-sm">
                <span className="micro-label text-on-surface-variant">Section {index + 1}</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">{section.title}</h3>
                <div className="reading-prose" dangerouslySetInnerHTML={{ __html: section.bodyHtml ?? '' }} />
                {section.checkpoint ? (
                  <div className="rounded border border-outline-variant bg-surface-container-low p-space-md">
                    <span className="font-label-md text-label-md text-on-surface">{section.checkpoint.title}</span>
                    <ol className="mt-space-sm flex list-decimal flex-col gap-1 pl-5 font-body-sm text-body-sm text-on-surface-variant">
                      {section.checkpoint.questions.map((question) => (
                        <li key={question.id}>{question.prompt}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <Divider />
              </section>
            ))}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={
          pendingDelete?.kind === 'section'
            ? 'Delete this section?'
            : pendingDelete?.kind === 'resource'
              ? 'Remove this resource?'
              : 'Remove this knowledge check?'
        }
        message={
          pendingDelete?.kind === 'section'
            ? `“${pendingDelete.title}” and its knowledge check will be removed. Sections with recorded learner progress cannot be deleted while the lesson is published.`
            : pendingDelete?.kind === 'resource'
              ? `“${pendingDelete.title}” will no longer appear in the lesson. Uploaded PDFs are removed from storage.`
              : 'Learners will be able to mark this section as read instead of answering questions.'
        }
        confirmLabel="Delete"
        destructive
        pending={busy}
      />

      <div className={cn('flex flex-wrap items-center justify-between gap-space-sm font-label-xs text-label-xs text-on-surface-variant')}>
        <span>
          Saving a section bumps the lesson version. Existing learner progress and earned completions are never reset.
        </span>
        <Link to={`${areaBase}/${courseId}/builder`} className="text-primary hover:underline">
          Back to the builder
        </Link>
      </div>
    </div>
  );
}
