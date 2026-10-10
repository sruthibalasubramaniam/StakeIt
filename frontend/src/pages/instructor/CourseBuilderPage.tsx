import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { courseApi, curriculumApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, IconButton, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, EmptyState, ErrorBlock, LoadingBlock, Modal, SectionHeader } from '../../components/ui/data';
import { Input, Select, Switch, Textarea } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { useCourseAreaBase } from '../../router/routeAccess';
import { formatDate, formatPoints } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { CommitmentOption, ContentType, ModuleAuthoring } from '../../types/api';

const CONTENT_TYPES: Array<{ value: ContentType; label: string }> = [
  { value: 'VIDEO', label: 'Video' },
  { value: 'READING', label: 'Reading' },
  { value: 'QUIZ', label: 'Quiz' },
  { value: 'MODULE_ASSESSMENT', label: 'Module assessment' },
];

interface QuestionDraft {
  prompt: string;
  explanation: string;
  options: Array<{ label: string; detail: string; isCorrect: boolean }>;
}

const EMPTY_QUESTION: QuestionDraft = {
  prompt: '',
  explanation: '',
  options: [
    { label: '', detail: '', isCorrect: true },
    { label: '', detail: '', isCorrect: false },
  ],
};

/**
 * Course builder — the `course_builder` design.
 *
 * Ordering uses explicit up/down controls (no drag-and-drop dependency), which
 * keeps the reorder calls reliable and keyboard accessible.
 */
export function CourseBuilderPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const toast = useToast();
  // Instructors stay under /instructor/courses, administrators under /admin/courses.
  const areaBase = useCourseAreaBase();

  useDocumentTitle('Course builder');

  const course = useAsync(() => courseApi.preview(courseId), [courseId]);
  const modules = useAsync(() => curriculumApi.listModules(courseId), [courseId]);
  const [busy, setBusy] = useState(false);

  // --- new item / module drafts -------------------------------------------
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [contentDrafts, setContentDrafts] = useState<Record<string, { type: ContentType; title: string; videoUrl: string; body: string }>>({});

  // --- editors -------------------------------------------------------------
  const [questionEditor, setQuestionEditor] = useState<{
    kind: 'QUIZ' | 'ASSESSMENT';
    targetId: string;
    title: string;
  } | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([EMPTY_QUESTION]);
  const [savingQuestions, setSavingQuestions] = useState(false);

  const [finalEditorOpen, setFinalEditorOpen] = useState(false);
  const [finalTitle, setFinalTitle] = useState('Final Course Assessment');
  const [finalPassing, setFinalPassing] = useState(70);
  const [finalAttempts, setFinalAttempts] = useState(1);

  const [commitmentOpen, setCommitmentOpen] = useState(false);
  const [commitmentDrafts, setCommitmentDrafts] = useState<
    Array<{ label: string; durationDays: number; commitmentStake: number; commitmentBonus: number; isDefault: boolean }>
  >([{ label: '', durationDays: 14, commitmentStake: 100, commitmentBonus: 40, isDefault: true }]);

  /* --------------------------------------------------------------------- */
  /* Module operations                                                     */
  /* --------------------------------------------------------------------- */

  const addModule = async () => {
    if (!newModuleTitle.trim()) return;
    setBusy(true);
    try {
      await curriculumApi.createModule(courseId, { title: newModuleTitle.trim() });
      setNewModuleTitle('');
      toast.success('Module added');
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not add module', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const moveModule = async (index: number, direction: -1 | 1) => {
    const list = modules.data ?? [];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const ordered = list.map((module) => module.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
    setBusy(true);
    try {
      await curriculumApi.reorderModules(courseId, ordered);
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not reorder modules', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const deleteModule = async (moduleId: string) => {
    setBusy(true);
    try {
      await curriculumApi.deleteModule(moduleId);
      toast.success('Module deleted');
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not delete module', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------------------- */
  /* Content operations                                                    */
  /* --------------------------------------------------------------------- */

  const addContent = async (moduleId: string) => {
    const draft = contentDrafts[moduleId] ?? { type: 'VIDEO' as ContentType, title: '', videoUrl: '', body: '' };
    if (!draft.title.trim()) {
      toast.error('Content title required', 'Give the item a title before adding it.');
      return;
    }

    setBusy(true);
    try {
      await curriculumApi.createContent(moduleId, {
        type: draft.type,
        title: draft.title.trim(),
        ...(draft.type === 'VIDEO' ? { videoUrl: draft.videoUrl.trim(), durationSeconds: 600 } : {}),
        ...(draft.type === 'READING' ? { readingBody: draft.body.trim() } : {}),
        ...(draft.type === 'QUIZ' ? { passingScore: 70 } : {}),
        ...(draft.type === 'MODULE_ASSESSMENT' ? { passingScore: 70, maxAttempts: 3 } : {}),
      });
      setContentDrafts((current) => ({
        ...current,
        [moduleId]: { type: draft.type, title: '', videoUrl: '', body: '' },
      }));
      toast.success('Content added', 'A quiz or assessment item also needs questions — use the "Questions" button.');
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not add content', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const moveContent = async (module: ModuleAuthoring, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= module.contents.length) return;
    const ordered = module.contents.map((content) => content.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
    setBusy(true);
    try {
      await curriculumApi.reorderContent(module.id, ordered);
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not reorder content', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const deleteContent = async (contentId: string) => {
    setBusy(true);
    try {
      await curriculumApi.deleteContent(contentId);
      toast.success('Content deleted');
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not delete content', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------------------- */
  /* Question editing                                                      */
  /* --------------------------------------------------------------------- */

  const saveQuestions = async () => {
    if (!questionEditor) return;
    setSavingQuestions(true);
    try {
      const payload = questionDrafts.map((draft) => ({
        type: 'SINGLE_CHOICE' as const,
        prompt: draft.prompt.trim(),
        explanation: draft.explanation.trim() || null,
        points: 10,
        options: draft.options
          .filter((option) => option.label.trim())
          .map((option) => ({
            label: option.label.trim(),
            detail: option.detail.trim() || null,
            isCorrect: option.isCorrect,
          })),
      }));

      if (questionEditor.kind === 'QUIZ') {
        await curriculumApi.replaceQuizQuestions(questionEditor.targetId, payload);
      } else {
        await curriculumApi.replaceAssessmentQuestions(questionEditor.targetId, payload);
      }

      toast.success('Questions saved');
      setQuestionEditor(null);
      setQuestionDrafts([EMPTY_QUESTION]);
      await modules.refetch();
    } catch (caught) {
      toast.error('Could not save questions', errorMessage(caught));
    } finally {
      setSavingQuestions(false);
    }
  };

  /* --------------------------------------------------------------------- */
  /* Final assessment & commitments                                        */
  /* --------------------------------------------------------------------- */

  const saveFinalAssessment = async () => {
    setBusy(true);
    try {
      const assessment = await curriculumApi.upsertFinalAssessment(courseId, {
        title: finalTitle.trim(),
        passingScore: finalPassing,
        maxAttempts: finalAttempts,
      });
      toast.success('Final assessment saved', 'Now add its questions.');
      setFinalEditorOpen(false);
      await course.refetch();
      setQuestionEditor({ kind: 'ASSESSMENT', targetId: (assessment as { id: string }).id, title: finalTitle });
    } catch (caught) {
      toast.error('Could not save the final assessment', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveCommitments = async () => {
    setBusy(true);
    try {
      await curriculumApi.replaceCommitmentOptions(
        courseId,
        commitmentDrafts
          .filter((draft) => draft.label.trim())
          .map((draft) => ({
            label: draft.label.trim(),
            durationDays: draft.durationDays,
            commitmentStake: draft.commitmentStake,
            commitmentBonus: draft.commitmentBonus,
            isDefault: draft.isDefault,
          })),
      );
      toast.success('Accelerated options saved');
      setCommitmentOpen(false);
      await course.refetch();
    } catch (caught) {
      toast.error('Could not save accelerated options', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await courseApi.publish(courseId);
      toast.success('Course published', 'Learners can now enrol and stake points.');
      await course.refetch();
    } catch (caught) {
      // The API returns the exact blocking issues; relay them verbatim.
      toast.error('Course is not ready to publish', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (course.loading) return <LoadingBlock label="Loading course…" rows={6} />;
  if (course.error || !course.data) {
    return <ErrorBlock title="Could not load this course" message={course.error} onRetry={() => void course.refetch()} />;
  }

  const detail = course.data;
  const moduleList = modules.data ?? [];

  return (
    <div className="flex flex-col gap-space-lg pb-space-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <Link
          to={areaBase}
          className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" className="text-[16px]" />
          Courses
        </Link>
        <div className="flex flex-wrap items-center gap-space-sm">
          <Chip tone={detail.status === 'PUBLISHED' ? 'earned' : 'info'}>{detail.status}</Chip>
          <Link to={`/courses/${detail.slug}`}>
            <Button variant="secondary" icon="visibility">
              Preview
            </Button>
          </Link>
          {detail.status === 'PUBLISHED' ? (
            <Button
              variant="secondary"
              icon="visibility_off"
              loading={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    await courseApi.unpublish(courseId);
                    toast.success('Course unpublished');
                    await course.refetch();
                  } catch (caught) {
                    toast.error('Could not unpublish', errorMessage(caught));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Unpublish
            </Button>
          ) : (
            <Button icon="publish" loading={busy} onClick={() => void publish()}>
              Publish course
            </Button>
          )}
        </div>
      </div>

      <SectionHeader
        eyebrow="Course builder"
        title={detail.title}
        meta={<span className="font-mono text-label-sm text-on-surface-variant">{detail.code}</span>}
      />

      {/* Read-only summaries of steps configured elsewhere */}
      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Course information"
            subtitle="01 / Foundation"
            action={
              <Link to={`${areaBase}/${courseId}/edit`} className="font-label-sm text-label-sm text-primary hover:underline">
                Edit
              </Link>
            }
          />
          <Divider />
          <div className="flex flex-col gap-space-xs p-space-lg">
            <span className="font-body-sm text-body-sm text-on-surface-variant">{detail.shortDescription}</span>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              {detail.category} · {detail.difficulty} · {detail.durationDays} days · {detail.gracePeriodHours}h grace
            </span>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Stake & rewards"
            subtitle="02 / Accountability economics"
            action={
              <Link to={`${areaBase}/${courseId}/edit`} className="font-label-sm text-label-sm text-primary hover:underline">
                Edit
              </Link>
            }
          />
          <Divider />
          <div className="grid grid-cols-2 gap-space-md p-space-lg">
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Base stake</span>
              <span className="font-mono text-label-md tabular text-on-surface">{formatPoints(detail.baseStake, { suffix: false })}</span>
            </div>
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Completion reward</span>
              <span className="font-mono text-label-md tabular text-secondary">+{detail.completionReward}</span>
            </div>
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Commitment bonus</span>
              <span className="font-mono text-label-md tabular text-secondary">+{detail.commitmentBonus}</span>
            </div>
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Performance bonus</span>
              <span className="font-mono text-label-md tabular text-secondary">+{detail.performanceBonus}</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Weights & pace"
            subtitle="03 / Schedule"
            action={
              <Link to={`${areaBase}/${courseId}/edit`} className="font-label-sm text-label-sm text-primary hover:underline">
                Edit
              </Link>
            }
          />
          <Divider />
          <div className="grid grid-cols-2 gap-space-md p-space-lg">
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Module weight</span>
              <span className="font-mono text-label-md tabular text-on-surface">{detail.moduleWeight}%</span>
            </div>
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Final test weight</span>
              <span className="font-mono text-label-md tabular text-on-surface">{detail.finalTestWeight}%</span>
            </div>
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Performance ≥</span>
              <span className="font-mono text-label-md tabular text-on-surface">{detail.performanceThreshold}%</span>
            </div>
            <div className="flex flex-col">
              <span className="micro-label text-on-surface-variant">Max attempts</span>
              <span className="font-mono text-label-md tabular text-on-surface">{detail.maxAttempts}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Accelerated commitment options */}
      <Card>
        <CardHeader
          title="Accelerated commitment options"
          subtitle="Optional personal deadlines learners can choose at enrolment"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon="edit"
              onClick={() => {
                setCommitmentDrafts(
                  (detail.commitmentOptions ?? []).length > 0
                    ? (detail.commitmentOptions as CommitmentOption[]).map((option) => ({
                        label: option.label,
                        durationDays: option.durationDays,
                        commitmentStake: option.commitmentStake,
                        commitmentBonus: option.commitmentBonus,
                        isDefault: option.isDefault,
                      }))
                    : [{ label: '', durationDays: 14, commitmentStake: 100, commitmentBonus: 40, isDefault: true }],
                );
                setCommitmentOpen(true);
              }}
            >
              Configure
            </Button>
          }
        />
        <Divider />
        {(detail.commitmentOptions ?? []).length === 0 ? (
          <p className="p-space-lg font-body-sm text-body-sm text-on-surface-variant">
            No accelerated options. Learners will only commit the base stake against the standard deadline.
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {(detail.commitmentOptions ?? []).map((option) => (
              <li key={option.id} className="flex flex-wrap items-center justify-between gap-space-md px-space-lg py-space-sm">
                <span className="flex items-center gap-space-sm">
                  <MaterialIcon name="timer" className="text-on-surface-variant" />
                  <span className="font-label-md text-label-md text-on-surface">{option.label}</span>
                  {option.isDefault ? <Chip tone="info">default</Chip> : null}
                </span>
                <span className="flex items-center gap-space-lg font-label-xs text-label-xs text-on-surface-variant">
                  <span className="metric">{option.durationDays} days</span>
                  <span>stake {option.commitmentStake} pts</span>
                  <span className="text-secondary">bonus +{option.commitmentBonus} pts</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Modules */}
      <Card>
        <CardHeader
          title="Curriculum & modules"
          subtitle="04 / Syllabus structure"
          action={<Chip tone="info">{moduleList.length} module(s)</Chip>}
        />
        <Divider />

        <div className="flex flex-col">
          {moduleList.length === 0 ? (
            <EmptyState
              icon="layers"
              title="No modules yet"
              description="Add a module, then add the video, reading, quiz and module assessment inside it. The final test is configured separately below."
            />
          ) : (
            moduleList.map((module, moduleIndex) => (
              <div key={module.id} className="border-b border-outline-variant p-space-lg last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-space-md">
                  <div className="flex items-start gap-space-md">
                    <MaterialIcon name="drag_indicator" className="mt-0.5 text-on-surface-variant" />
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface">
                        M{moduleIndex + 1} · {module.title}
                      </span>
                      {module.summary ? (
                        <span className="font-body-sm text-body-sm text-on-surface-variant">{module.summary}</span>
                      ) : null}
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {module.contents.length} item(s)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-space-xs">
                    <IconButton
                      icon="arrow_upward"
                      label={`Move ${module.title} up`}
                      disabled={moduleIndex === 0 || busy}
                      onClick={() => void moveModule(moduleIndex, -1)}
                    />
                    <IconButton
                      icon="arrow_downward"
                      label={`Move ${module.title} down`}
                      disabled={moduleIndex === moduleList.length - 1 || busy}
                      onClick={() => void moveModule(moduleIndex, 1)}
                    />
                    <IconButton
                      icon="delete"
                      label={`Delete ${module.title}`}
                      disabled={busy}
                      onClick={() => void deleteModule(module.id)}
                      className="text-error"
                    />
                  </div>
                </div>

                {/* Contents */}
                <ul className="mt-space-md flex flex-col divide-y divide-outline-variant rounded border border-outline-variant">
                  {module.contents.length === 0 ? (
                    <li className="px-space-md py-space-sm font-body-sm text-body-sm text-on-surface-variant">
                      No content yet — add a video, reading, quiz or module assessment below.
                    </li>
                  ) : (
                    module.contents.map((content, contentIndex) => {
                      const questionCount =
                        content.quiz?._count.questions ?? content.assessment?._count.questions ?? null;

                      return (
                        <li key={content.id} className="flex flex-wrap items-center justify-between gap-space-md px-space-md py-space-sm">
                          <span className="flex items-center gap-space-md">
                            <MaterialIcon
                              name={
                                content.type === 'VIDEO'
                                  ? 'play_circle'
                                  : content.type === 'READING'
                                    ? 'article'
                                    : content.type === 'QUIZ'
                                      ? 'quiz'
                                      : 'assignment'
                              }
                              className="text-[16px] text-on-surface-variant"
                            />
                            <span className="flex flex-col">
                              <span className="font-label-sm text-label-sm text-on-surface">{content.title}</span>
                              <span className="font-label-xs text-label-xs text-on-surface-variant">
                                {content.type.replace('_', ' ').toLowerCase()}
                                {questionCount !== null ? ` · ${questionCount} question(s)` : ''}
                                {content.isRequired ? ' · required' : ' · optional'}
                              </span>
                            </span>
                          </span>

                          <span className="flex items-center gap-space-xs">
                            {content.quiz ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                icon="list_alt"
                                onClick={() =>
                                  setQuestionEditor({ kind: 'QUIZ', targetId: content.quiz!.id, title: content.title })
                                }
                              >
                                Questions
                              </Button>
                            ) : null}
                            {content.assessment ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                icon="list_alt"
                                onClick={() =>
                                  setQuestionEditor({
                                    kind: 'ASSESSMENT',
                                    targetId: content.assessment!.id,
                                    title: content.title,
                                  })
                                }
                              >
                                Questions
                              </Button>
                            ) : null}
                            <IconButton
                              icon="arrow_upward"
                              label="Move up"
                              disabled={contentIndex === 0 || busy}
                              onClick={() => void moveContent(module, contentIndex, -1)}
                            />
                            <IconButton
                              icon="arrow_downward"
                              label="Move down"
                              disabled={contentIndex === module.contents.length - 1 || busy}
                              onClick={() => void moveContent(module, contentIndex, 1)}
                            />
                            <IconButton
                              icon="delete"
                              label={`Delete ${content.title}`}
                              disabled={busy}
                              onClick={() => void deleteContent(content.id)}
                              className="text-error"
                            />
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>

                {/* Add content */}
                <div className="mt-space-md flex flex-col gap-space-sm rounded border border-dashed border-outline-variant p-space-md">
                  <span className="micro-label text-on-surface-variant">Add item to module {moduleIndex + 1}</span>
                  <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-3">
                    <Select
                      value={(contentDrafts[module.id]?.type ?? 'VIDEO') as string}
                      onChange={(event) =>
                        setContentDrafts((current) => ({
                          ...current,
                          [module.id]: {
                            ...(current[module.id] ?? { title: '', videoUrl: '', body: '' }),
                            type: event.target.value as ContentType,
                          },
                        }))
                      }
                      options={CONTENT_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))}
                    />
                    <Input
                      placeholder="Item title"
                      value={contentDrafts[module.id]?.title ?? ''}
                      onChange={(event) =>
                        setContentDrafts((current) => ({
                          ...current,
                          [module.id]: {
                            ...(current[module.id] ?? { type: 'VIDEO' as ContentType, videoUrl: '', body: '' }),
                            title: event.target.value,
                          },
                        }))
                      }
                      className={cn('sm:col-span-2')}
                    />
                  </div>

                  {(contentDrafts[module.id]?.type ?? 'VIDEO') === 'VIDEO' ? (
                    <Input
                      placeholder="Video URL (https://…)"
                      value={contentDrafts[module.id]?.videoUrl ?? ''}
                      onChange={(event) =>
                        setContentDrafts((current) => ({
                          ...current,
                          [module.id]: {
                            ...(current[module.id] ?? { type: 'VIDEO' as ContentType, title: '', body: '' }),
                            videoUrl: event.target.value,
                          },
                        }))
                      }
                    />
                  ) : null}

                  {(contentDrafts[module.id]?.type ?? 'VIDEO') === 'READING' ? (
                    <Textarea
                      rows={3}
                      placeholder="Reading body"
                      value={contentDrafts[module.id]?.body ?? ''}
                      onChange={(event) =>
                        setContentDrafts((current) => ({
                          ...current,
                          [module.id]: {
                            ...(current[module.id] ?? { type: 'READING' as ContentType, title: '', videoUrl: '' }),
                            body: event.target.value,
                          },
                        }))
                      }
                    />
                  ) : null}

                  <div className="flex justify-end">
                    <Button size="sm" icon="add" loading={busy} onClick={() => void addContent(module.id)}>
                      Add item
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <Divider />
        <div className="flex flex-col gap-space-sm p-space-lg sm:flex-row sm:items-end">
          <Input
            label="New module title"
            value={newModuleTitle}
            onChange={(event) => setNewModuleTitle(event.target.value)}
            placeholder="Theoretical Foundations of Pairs Trading"
            className="sm:flex-1"
          />
          <Button icon="add" loading={busy} disabled={!newModuleTitle.trim()} onClick={() => void addModule()}>
            Add module
          </Button>
        </div>
      </Card>

      {/* Final assessment */}
      <Card>
        <CardHeader
          title="Final course assessment"
          subtitle="Locked for learners until every required module is passed"
          action={
            <div className="flex items-center gap-space-sm">
              {detail.finalAssessment ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="list_alt"
                  onClick={() =>
                    setQuestionEditor({
                      kind: 'ASSESSMENT',
                      targetId: detail.finalAssessment!.id,
                      title: detail.finalAssessment!.title,
                    })
                  }
                >
                  Questions
                </Button>
              ) : null}
              <Button
                size="sm"
                icon="edit"
                onClick={() => {
                  if (detail.finalAssessment) {
                    setFinalTitle(detail.finalAssessment.title);
                    setFinalPassing(detail.finalAssessment.passingScore);
                    setFinalAttempts(detail.finalAssessment.maxAttempts ?? 1);
                  }
                  setFinalEditorOpen(true);
                }}
              >
                {detail.finalAssessment ? 'Edit' : 'Create'}
              </Button>
            </div>
          }
        />
        <Divider />
        {detail.finalAssessment ? (
          <div className="flex flex-wrap items-center justify-between gap-space-md p-space-lg">
            <div className="flex items-center gap-space-sm">
              <MaterialIcon name="school" className="text-on-surface-variant" />
              <span className="flex flex-col">
                <span className="font-label-md text-label-md text-on-surface">{detail.finalAssessment.title}</span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  {detail.finalAssessment._count?.questions ?? 0} question(s) ·{' '}
                  {detail.finalAssessment.passingScore}% to pass · {detail.finalAssessment.maxAttempts ?? 'unlimited'} attempt(s)
                </span>
              </span>
            </div>
            {(detail.finalAssessment._count?.questions ?? 0) === 0 ? (
              <Chip tone="risk" icon="warning">
                needs questions before publishing
              </Chip>
            ) : (
              <Chip tone="earned" icon="check">
                ready
              </Chip>
            )}
          </div>
        ) : (
          <p className="p-space-lg font-body-sm text-body-sm text-on-surface-variant">
            No final assessment yet. A course cannot be published without one.
          </p>
        )}
      </Card>

      {/* Publish checklist */}
      <Card>
        <CardHeader title="Publish checklist" subtitle="The API enforces every item below" />
        <Divider />
        <ul className="flex flex-col divide-y divide-outline-variant">
          {[
            { label: 'At least one module', done: moduleList.length > 0 },
            {
              label: 'Every module has required content and any video has a URL',
              done:
                moduleList.length > 0 &&
                moduleList.every((module) => {
                  const required = module.contents.filter((content) => content.isRequired);
                  return required.length > 0 && required.every((content) => content.type !== 'VIDEO' || Boolean(content.videoUrl));
                }),
            },
            {
              label: 'Every quiz and module assessment has questions',
              done:
                moduleList.length > 0 &&
                moduleList
                  .flatMap((module) => module.contents)
                  .filter((content) => content.type === 'QUIZ' || content.type === 'MODULE_ASSESSMENT')
                  .every((content) => (content.quiz?._count.questions ?? content.assessment?._count.questions ?? 0) > 0),
            },
            {
              label: 'Final assessment exists and has questions',
              done: Boolean(detail.finalAssessment) && (detail.finalAssessment?._count?.questions ?? 0) > 0,
            },
            {
              label: 'Weights total exactly 100%',
              done: detail.moduleWeight + detail.finalTestWeight === 100,
            },
            {
              label: 'Accelerated options are shorter than the course duration',
              done: (detail.commitmentOptions ?? []).every((option) => option.durationDays < detail.durationDays),
            },
          ].map((item) => (
            <li key={item.label} className="flex items-center gap-space-md px-space-lg py-space-sm">
              <MaterialIcon
                name={item.done ? 'check_circle' : 'radio_button_unchecked'}
                filled={item.done}
                className={cn('text-[16px]', item.done ? 'text-secondary' : 'text-outline-variant')}
              />
              <span className={cn('font-body-sm text-body-sm', item.done ? 'text-on-surface' : 'text-on-surface-variant')}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
        {detail.publishedAt ? (
          <div className="border-t border-outline-variant px-space-lg py-space-sm">
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              First published {formatDate(detail.publishedAt)}
            </span>
          </div>
        ) : null}
      </Card>

      {/* Questions modal */}
      <Modal
        open={Boolean(questionEditor)}
        onClose={() => setQuestionEditor(null)}
        title={`Questions · ${questionEditor?.title ?? ''}`}
        description="Single-choice questions are auto-graded. Saving replaces the whole question set for this instrument."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setQuestionEditor(null)} disabled={savingQuestions}>
              Cancel
            </Button>
            <Button icon="save" loading={savingQuestions} onClick={() => void saveQuestions()}>
              Save questions
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-lg">
          {questionDrafts.map((draft, index) => (
            <div key={index} className="flex flex-col gap-space-sm rounded border border-outline-variant p-space-md">
              <div className="flex items-center justify-between">
                <span className="micro-label text-on-surface-variant">Question {index + 1}</span>
                <IconButton
                  icon="delete"
                  label={`Remove question ${index + 1}`}
                  disabled={questionDrafts.length === 1}
                  onClick={() => setQuestionDrafts((current) => current.filter((_, i) => i !== index))}
                  className="text-error"
                />
              </div>

              <Textarea
                label="Prompt"
                rows={2}
                value={draft.prompt}
                onChange={(event) =>
                  setQuestionDrafts((current) =>
                    current.map((item, i) => (i === index ? { ...item, prompt: event.target.value } : item)),
                  )
                }
              />
              <Input
                label="Explanation (shown after submission)"
                value={draft.explanation}
                onChange={(event) =>
                  setQuestionDrafts((current) =>
                    current.map((item, i) => (i === index ? { ...item, explanation: event.target.value } : item)),
                  )
                }
              />

              <div className="flex flex-col gap-space-xs">
                <span className="font-label-sm text-label-sm text-on-surface">Options</span>
                {draft.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-space-sm">
                    <input
                      type="radio"
                      name={`correct-${index}`}
                      checked={option.isCorrect}
                      aria-label={`Mark option ${optionIndex + 1} correct`}
                      onChange={() =>
                        setQuestionDrafts((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, options: item.options.map((entry, oi) => ({ ...entry, isCorrect: oi === optionIndex })) }
                              : item,
                          ),
                        )
                      }
                      className="h-4 w-4 accent-[#4338CA]"
                    />
                    <Input
                      placeholder={`Option ${optionIndex + 1}`}
                      value={option.label}
                      onChange={(event) =>
                        setQuestionDrafts((current) =>
                          current.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  options: item.options.map((entry, oi) =>
                                    oi === optionIndex ? { ...entry, label: event.target.value } : entry,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                      className="flex-1"
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  icon="add"
                  onClick={() =>
                    setQuestionDrafts((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, options: [...item.options, { label: '', detail: '', isCorrect: false }] }
                          : item,
                      ),
                    )
                  }
                >
                  Add option
                </Button>
              </div>
            </div>
          ))}

          <Button
            variant="secondary"
            icon="add"
            onClick={() => setQuestionDrafts((current) => [...current, { ...EMPTY_QUESTION, options: EMPTY_QUESTION.options.map((o) => ({ ...o })) }])}
          >
            Add question
          </Button>
        </div>
      </Modal>

      {/* Final assessment modal */}
      <Modal
        open={finalEditorOpen}
        onClose={() => setFinalEditorOpen(false)}
        title="Final course assessment"
        description="Locked until every required module is complete."
        footer={
          <>
            <Button variant="secondary" onClick={() => setFinalEditorOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void saveFinalAssessment()} icon="save">
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-md">
          <Input label="Title" value={finalTitle} onChange={(event) => setFinalTitle(event.target.value)} />
          <div className="grid grid-cols-2 gap-space-md">
            <Input
              label="Passing score %"
              type="number"
              min={0}
              max={100}
              value={finalPassing}
              onChange={(event) => setFinalPassing(Number(event.target.value))}
            />
            <Input
              label="Max attempts"
              type="number"
              min={1}
              value={finalAttempts}
              onChange={(event) => setFinalAttempts(Number(event.target.value))}
            />
          </div>
          <Alert tone="info" icon="info">
            The course-level minimum final-test score is configured in course settings and applies on top of this passing score.
          </Alert>
        </div>
      </Modal>

      {/* Commitment options modal */}
      <Modal
        open={commitmentOpen}
        onClose={() => setCommitmentOpen(false)}
        title="Accelerated commitment options"
        description="Learners may pick one of these at enrolment. Each must be shorter than the course duration."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCommitmentOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button loading={busy} icon="save" onClick={() => void saveCommitments()}>
              Save options
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-lg">
          {commitmentDrafts.map((draft, index) => (
            <div key={index} className="flex flex-col gap-space-sm rounded border border-outline-variant p-space-md">
              <div className="flex items-center justify-between">
                <span className="micro-label text-on-surface-variant">Option {index + 1}</span>
                <IconButton
                  icon="delete"
                  label={`Remove option ${index + 1}`}
                  onClick={() => setCommitmentDrafts((current) => current.filter((_, i) => i !== index))}
                  className="text-error"
                />
              </div>
              <Input
                label="Label"
                value={draft.label}
                onChange={(event) =>
                  setCommitmentDrafts((current) =>
                    current.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)),
                  )
                }
                placeholder={`Finish in ${draft.durationDays} days`}
              />
              <div className="grid grid-cols-3 gap-space-md">
                <Input
                  label="Duration (days)"
                  type="number"
                  min={1}
                  max={detail.durationDays - 1}
                  value={draft.durationDays}
                  onChange={(event) =>
                    setCommitmentDrafts((current) =>
                      current.map((item, i) => (i === index ? { ...item, durationDays: Number(event.target.value) } : item)),
                    )
                  }
                />
                <Input
                  label="Commitment stake"
                  type="number"
                  min={1}
                  value={draft.commitmentStake}
                  onChange={(event) =>
                    setCommitmentDrafts((current) =>
                      current.map((item, i) => (i === index ? { ...item, commitmentStake: Number(event.target.value) } : item)),
                    )
                  }
                />
                <Input
                  label="Commitment bonus"
                  type="number"
                  min={0}
                  value={draft.commitmentBonus}
                  onChange={(event) =>
                    setCommitmentDrafts((current) =>
                      current.map((item, i) => (i === index ? { ...item, commitmentBonus: Number(event.target.value) } : item)),
                    )
                  }
                />
              </div>
              <Switch
                checked={draft.isDefault}
                onChange={(checked) =>
                  setCommitmentDrafts((current) =>
                    current.map((item, i) => ({ ...item, isDefault: i === index ? checked : false })),
                  )
                }
                label="Pre-select this option at enrolment"
              />
            </div>
          ))}

          <Button
            variant="secondary"
            icon="add"
            onClick={() =>
              setCommitmentDrafts((current) => [
                ...current,
                { label: '', durationDays: 14, commitmentStake: 100, commitmentBonus: 40, isDefault: false },
              ])
            }
          >
            Add option
          </Button>
        </div>
      </Modal>
    </div>
  );
}
