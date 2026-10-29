import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { learningApi } from '../../services/endpoints';
import { errorMessage } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { Button, Chip, Divider, MaterialIcon, ProgressBar } from '../ui/core';
import { Alert, Card, CardHeader } from '../ui/data';
import { cn } from '../../utils/cn';
import type {
  ReadingCheckpointResult,
  ReadingLessonPayload,
  ReadingResourceView,
  ReadingSectionSummary,
  ReadingSectionView,
} from '../../types/api';

/**
 * MOOC-style reading experience.
 *
 * Everything that decides *what the learner may do* lives on the server: this
 * component renders `isUnlocked` / `isCompleted` and posts intentions. It never
 * unlocks a section locally, and the checkpoint panel only enables itself for a
 * section the API has already marked as unlocked.
 *
 * Position is saved on every section change and on a 30-second heartbeat, which
 * is what makes "Continue reading" survive refreshes, logouts and devices.
 */

const FONT_SIZE_KEY = 'stakeit.reading.fontSize';
const FONT_SIZES = [14, 16, 18, 20, 22] as const;
const HEARTBEAT_MS = 30_000;

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReadingLessonReader({
  attemptId,
  contentId,
  payload,
  isContentCompleted,
  onRefresh,
  onComplete,
  completing,
}: {
  attemptId: string;
  contentId: string;
  payload: ReadingLessonPayload;
  isContentCompleted: boolean;
  onRefresh: () => Promise<void> | void;
  onComplete: () => void;
  completing: boolean;
}) {
  const toast = useToast();

  const initialSectionId = useMemo(() => {
    const resumeId = payload.resume.sectionId;
    const resumed = payload.sections.find((section) => section.id === resumeId && section.isUnlocked);
    return (
      resumed?.id ??
      payload.sections.find((section) => section.isUnlocked && !section.isCompleted)?.id ??
      payload.sections.find((section) => section.isUnlocked)?.id ??
      payload.sections[0]?.id ??
      ''
    );
    // Resume only on mount / when the lesson changes — not on every refetch, or
    // the learner would be yanked back while reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  const [activeSectionId, setActiveSectionId] = useState(initialSectionId);
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem(FONT_SIZE_KEY));
    return FONT_SIZES.includes(stored as (typeof FONT_SIZES)[number]) ? stored : 16;
  });
  const [openResourceId, setOpenResourceId] = useState<string | null>(null);
  const [pdfPage, setPdfPage] = useState<number>(payload.resume.pdfPage ?? 1);
  const [summary, setSummary] = useState<ReadingSectionSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Record<string, string[]>>>({});
  const [results, setResults] = useState<Record<string, ReadingCheckpointResult>>({});
  const [submittingCheckpoint, setSubmittingCheckpoint] = useState<string | null>(null);

  /** Optional study aid. The server refuses locked sections, so this can't leak ahead. */
  const loadSummary = useCallback(
    async (sectionId: string) => {
      setSummaryBusy(true);
      try {
        setSummary(await learningApi.sectionSummary(attemptId, contentId, sectionId));
      } catch (error) {
        toast.error('Could not summarise this section', errorMessage(error));
      } finally {
        setSummaryBusy(false);
      }
    },
    [attemptId, contentId, toast],
  );
  const [markingSection, setMarkingSection] = useState<string | null>(null);
  const activeSeconds = useRef(0);

  const activeSection = payload.sections.find((section) => section.id === activeSectionId) ?? payload.sections[0] ?? null;
  const activeIndex = payload.sections.findIndex((section) => section.id === activeSection?.id);

  /* ----------------------------- persistence ----------------------------- */

  const savePosition = useCallback(
    async (params: { sectionId?: string | null; pdfPage?: number | null; seconds?: number }) => {
      try {
        await learningApi.saveReadingPosition(attemptId, contentId, {
          sectionId: params.sectionId ?? null,
          pdfPage: params.pdfPage ?? null,
          activeSeconds: params.seconds ?? 0,
        });
      } catch {
        // A dropped position write is recoverable — the next heartbeat retries.
      }
    },
    [attemptId, contentId],
  );

  // Heartbeat: keeps the resume pointer and engagement time current without
  // spamming the API while the tab is in the background.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      activeSeconds.current += HEARTBEAT_MS / 1000;
      void savePosition({
        sectionId: activeSectionId,
        pdfPage: openResourceId ? pdfPage : undefined,
        seconds: HEARTBEAT_MS / 1000,
      });
    }, HEARTBEAT_MS);

    return () => window.clearInterval(timer);
  }, [activeSectionId, openResourceId, pdfPage, savePosition]);

  const goToSection = (section: ReadingSectionView) => {
    if (!section.isUnlocked) return;
    setActiveSectionId(section.id);
    void savePosition({ sectionId: section.id, seconds: activeSeconds.current });
    activeSeconds.current = 0;
    // Scroll the content pane back to the top of the new section.
    document.getElementById('reading-section-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const changeFontSize = (direction: -1 | 1) => {
    const index = FONT_SIZES.indexOf(fontSize as (typeof FONT_SIZES)[number]);
    const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction))];
    if (!next) return;
    setFontSize(next);
    window.localStorage.setItem(FONT_SIZE_KEY, String(next));
  };

  /* ------------------------------ sections ------------------------------- */

  const markSectionRead = async (section: ReadingSectionView) => {
    setMarkingSection(section.id);
    try {
      const result = await learningApi.markReadingSection(attemptId, contentId, section.id, Math.round(activeSeconds.current));
      activeSeconds.current = 0;
      toast.success(
        'Section complete',
        result.nextSectionTitle ? `Next: ${result.nextSectionTitle}` : 'Every section is now complete.',
      );
      await onRefresh();
      if (result.nextSectionId) setActiveSectionId(result.nextSectionId);
    } catch (caught) {
      toast.error('Could not complete this section', errorMessage(caught));
    } finally {
      setMarkingSection(null);
    }
  };

  /* ---------------------------- checkpoints ------------------------------ */

  const setAnswer = (checkpointId: string, questionId: string, optionIds: string[]) => {
    setAnswers((current) => ({
      ...current,
      [checkpointId]: { ...(current[checkpointId] ?? {}), [questionId]: optionIds },
    }));
  };

  const submitCheckpoint = async (section: ReadingSectionView) => {
    const checkpoint = section.checkpoint;
    if (!checkpoint) return;

    const checkpointAnswers = answers[checkpoint.id] ?? {};
    const unanswered = checkpoint.questions.filter((question) => (checkpointAnswers[question.id] ?? []).length === 0);
    if (unanswered.length > 0) {
      toast.error('Answer every question', `${unanswered.length} question(s) are still blank.`);
      return;
    }

    setSubmittingCheckpoint(checkpoint.id);
    try {
      const result = await learningApi.submitReadingCheckpoint(attemptId, contentId, checkpoint.id, checkpointAnswers);
      setResults((current) => ({ ...current, [checkpoint.id]: result }));
      if (result.passed) {
        toast.success(`Knowledge check passed · ${result.percentage}%`, 'This section is now complete.');
        await onRefresh();
      } else {
        toast.error(
          `Not quite · ${result.percentage}%`,
          `You need ${checkpoint.passingScore}% to unlock the next section.`,
        );
      }
    } catch (caught) {
      toast.error('Could not submit the knowledge check', errorMessage(caught));
    } finally {
      setSubmittingCheckpoint(null);
    }
  };

  /* ------------------------------ resources ----------------------------- */

  const openResource = async (resource: ReadingResourceView) => {
    if (resource.kind !== 'PDF') {
      window.open(resource.url ?? '', '_blank', 'noopener,noreferrer');
      return;
    }
    if (!resource.available || !resource.url) {
      toast.error('Document unavailable', 'This PDF could not be opened right now. Please retry shortly.');
      return;
    }
    setOpenResourceId((current) => (current === resource.id ? null : resource.id));
    void savePosition({ sectionId: activeSection?.id ?? null, pdfPage, seconds: activeSeconds.current });
  };

  const goToPdfPage = (page: number) => {
    const next = Math.max(1, Math.min(5000, Math.round(page)));
    setPdfPage(next);
    void savePosition({ sectionId: activeSection?.id ?? null, pdfPage: next, seconds: activeSeconds.current });
  };

  const pdfResource = payload.resources.find((resource) => resource.id === openResourceId && resource.kind === 'PDF');
  const pdfSrc = pdfResource?.url ? `${pdfResource.url}#page=${pdfPage}` : null;

  /* -------------------------------- render ------------------------------ */

  if (payload.sections.length === 0) {
    return (
      <Alert tone="warning" title="This lesson has no sections yet">
        The instructor has not published the content for this reading lesson. Please check back later.
      </Alert>
    );
  }

  const percentComplete = payload.sectionProgress.percent;
  const resumedAt = payload.resume.sectionIndex > 0 ? payload.sections[payload.resume.sectionIndex] : null;

  return (
    <div className="flex flex-col gap-space-md">
      {/* Lesson chrome: objectives, reading time, progress, text size */}
      <Card>
        <div className="flex flex-col gap-space-md p-space-lg">
          <div className="flex flex-wrap items-start justify-between gap-space-md">
            <div className="flex flex-col gap-space-xs">
              <span className="flex flex-wrap items-center gap-space-sm font-label-xs text-label-xs text-on-surface-variant">
                <Chip tone="info" icon="schedule">
                  {formatMinutes(payload.lesson.estimatedMinutes)} read
                </Chip>
                <Chip tone={percentComplete >= 100 ? 'earned' : 'neutral'} icon="menu_book">
                  {payload.sectionProgress.completed}/{payload.sectionProgress.total} sections
                </Chip>
                {isContentCompleted ? (
                  <Chip tone="earned" icon="check_circle">
                    lesson complete
                  </Chip>
                ) : null}
                {payload.completion.pendingCheckpoints ? (
                  <Chip tone="risk" icon="quiz">
                    knowledge checks pending
                  </Chip>
                ) : null}
              </span>
              {payload.lesson.objectives.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer font-label-sm text-label-sm text-primary">Learning objectives</summary>
                  <ul className="mt-space-sm flex list-disc flex-col gap-1 pl-5 font-body-sm text-body-sm text-on-surface-variant">
                    {payload.lesson.objectives.map((objective) => (
                      <li key={objective}>{objective}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>

            <div className="flex items-center gap-space-xs" role="group" aria-label="Text size">
              <span className="micro-label text-on-surface-variant">Text</span>
              <Button size="sm" variant="secondary" onClick={() => changeFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]!} aria-label="Decrease text size">
                A−
              </Button>
              <span className="font-mono text-label-xs tabular text-on-surface-variant">{fontSize}px</span>
              <Button size="sm" variant="secondary" onClick={() => changeFontSize(1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]!} aria-label="Increase text size">
                A+
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <ProgressBar value={percentComplete} tone={percentComplete >= 100 ? 'success' : 'primary'} label="Lesson progress" />
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              {resumedAt && !isContentCompleted ? `Continuing from “${resumedAt.title}”` : `${percentComplete}% of this lesson complete`}
            </span>
          </div>
        </div>
      </Card>

      {payload.resources.length > 0 ? (
        <Card>
          <CardHeader
            title="Lesson materials"
            subtitle={payload.storageConfigured ? 'PDFs open in a secure viewer; links open in a new tab.' : undefined}
          />
          <Divider />
          <ul className="flex flex-col divide-y divide-outline-variant">
            {payload.resources.map((resource) => (
              <li key={resource.id} className="flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-space-sm px-space-lg py-space-sm">
                  <span className="flex min-w-0 items-center gap-space-sm">
                    <MaterialIcon
                      name={resource.kind === 'PDF' ? 'picture_as_pdf' : resource.kind === 'EMBED' ? 'slideshow' : 'link'}
                      className="text-on-surface-variant"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-label-md text-label-md text-on-surface">{resource.title}</span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {resource.kind === 'PDF'
                          ? [resource.fileName, formatBytes(resource.sizeBytes)].filter(Boolean).join(' · ') || 'PDF document'
                          : resource.kind === 'EMBED'
                            ? 'Embedded resource'
                            : 'External link'}
                        {resource.kind === 'PDF' && !resource.available ? ' · unavailable right now' : ''}
                      </span>
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={resource.kind === 'PDF' ? (openResourceId === resource.id ? 'close' : 'visibility') : 'open_in_new'}
                    disabled={resource.kind === 'PDF' && !resource.available}
                    onClick={() => void openResource(resource)}
                  >
                    {resource.kind === 'PDF' ? (openResourceId === resource.id ? 'Close viewer' : 'Open document') : 'Open'}
                  </Button>
                </div>

                {pdfResource?.id === resource.id && pdfSrc ? (
                  <div className="flex flex-col gap-space-sm border-t border-outline-variant bg-surface-container-low p-space-md">
                    <div className="flex flex-wrap items-center justify-between gap-space-sm">
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Page</span>
                      <div className="flex items-center gap-space-xs">
                        <Button size="sm" variant="secondary" icon="chevron_left" onClick={() => goToPdfPage(pdfPage - 1)} disabled={pdfPage <= 1}>
                          Prev
                        </Button>
                        <input
                          type="number"
                          min={1}
                          max={5000}
                          value={pdfPage}
                          aria-label="PDF page"
                          onChange={(event) => goToPdfPage(Number(event.target.value) || 1)}
                          className="h-8 w-16 rounded border border-outline-variant bg-surface-container-lowest px-2 text-center font-mono text-label-sm tabular"
                        />
                        <Button size="sm" variant="secondary" iconRight="chevron_right" onClick={() => goToPdfPage(pdfPage + 1)}>
                          Next
                        </Button>
                        <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="font-label-xs text-label-xs text-primary hover:underline">
                          Open in new tab
                        </a>
                      </div>
                    </div>
                    <iframe
                      title={resource.title}
                      src={pdfSrc}
                      className="h-[70vh] w-full rounded border border-outline-variant bg-surface-container-lowest"
                    />
                    <span className="font-label-xs text-label-xs text-on-surface-variant">
                      Your page is saved automatically, so you can resume here later.
                    </span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Table of contents */}
        <nav aria-label="Lesson contents" className="order-2 lg:order-1">
          <Card className="lg:sticky lg:top-4">
            <CardHeader title="Contents" subtitle={`${payload.sections.length} sections`} />
            <Divider />
            <ol className="flex flex-col">
              {payload.sections.map((section, index) => {
                const isActive = section.id === activeSection?.id;
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => goToSection(section)}
                      disabled={!section.isUnlocked}
                      aria-current={isActive ? 'step' : undefined}
                      className={cn(
                        'flex w-full items-start gap-space-sm border-l-2 px-space-md py-space-sm text-left transition-colors',
                        isActive
                          ? 'border-primary bg-primary-fixed/40'
                          : 'border-transparent hover:bg-surface-container-low',
                        !section.isUnlocked && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                        {section.isCompleted ? (
                          <MaterialIcon name="check_circle" filled className="text-[16px] text-secondary" />
                        ) : section.isUnlocked ? (
                          <span className="font-mono text-label-xs tabular text-on-surface-variant">{index + 1}</span>
                        ) : (
                          <MaterialIcon name="lock" className="text-[14px] text-[#94A3B8]" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className={cn('font-label-sm text-label-sm', isActive ? 'text-on-surface' : 'text-on-surface-variant')}>
                          {section.title}
                        </span>
                        <span className="font-label-xs text-label-xs text-on-surface-variant">
                          {formatMinutes(section.estimatedMinutes)}
                          {section.checkpoint ? ` · check · ${section.checkpoint.questions.length} q` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Card>
        </nav>

        {/* Section body */}
        <article className="order-1 flex flex-col gap-space-md lg:order-2">
          <div id="reading-section-top" />
          {activeSection ? (
            <Card>
              <div className="flex flex-col gap-space-xs px-space-lg pt-space-lg">
                <span className="micro-label text-on-surface-variant">
                  Section {activeIndex + 1} of {payload.sections.length}
                </span>
                <h2 className="font-headline-md text-headline-md tracking-tight text-on-surface">{activeSection.title}</h2>
                {activeSection.isCompleted ? (
                  <Chip tone="earned" icon="check">
                    completed
                  </Chip>
                ) : null}
              </div>

              {payload.aiConfigured ? (
                <div className="flex flex-wrap items-center gap-space-sm px-space-lg pt-space-md">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="auto_awesome"
                    loading={summaryBusy}
                    onClick={() => void loadSummary(activeSection.id)}
                  >
                    {summary ? 'Regenerate summary' : 'Summarise this section'}
                  </Button>
                  {summary ? (
                    <span className="font-label-xs text-label-xs text-on-surface-variant">
                      Generated from this section only
                    </span>
                  ) : null}
                </div>
              ) : null}

              {summary && summary.sectionId === activeSection.id ? (
                <div className="mx-space-lg mt-space-sm rounded border border-outline-variant bg-surface-container-low px-space-md py-space-md">
                  <div className="flex items-center justify-between gap-space-sm">
                    <span className="micro-label text-on-surface-variant">AI summary</span>
                    <button
                      type="button"
                      className="font-label-xs text-label-xs text-on-surface-variant underline"
                      onClick={() => setSummary(null)}
                    >
                      Hide
                    </button>
                  </div>
                  <p className="mt-space-xs font-body-md text-body-md text-on-surface">{summary.summary}</p>
                  {summary.keyPoints.length > 0 ? (
                    <ul className="mt-space-sm flex list-disc flex-col gap-space-xs pl-5 font-body-md text-body-md text-on-surface-variant">
                      {summary.keyPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-space-sm font-label-xs text-label-xs text-on-surface-variant">
                    A study aid, not a substitute for the section — checkpoints are graded on the full text.
                  </p>
                </div>
              ) : null}

              <div
                className="reading-prose px-space-lg py-space-md"
                style={{ ['--reading-font-size' as string]: `${fontSize}px` }}
                // Sanitised server-side by an allow-list (`lib/richText.ts`).
                dangerouslySetInnerHTML={{ __html: activeSection.bodyHtml ?? '' }}
              />

              {/* Checkpoint */}
              {activeSection.checkpoint ? (
                <div className="border-t border-outline-variant bg-surface-container-low px-space-lg py-space-lg">
                  <div className="flex flex-wrap items-center justify-between gap-space-sm">
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface">{activeSection.checkpoint.title}</span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {activeSection.checkpoint.questions.length} question(s) ·{' '}
                        {activeSection.checkpoint.passingScore}% to pass
                        {activeSection.checkpoint.maxAttempts
                          ? ` · ${activeSection.checkpoint.attemptsUsed}/${activeSection.checkpoint.maxAttempts} attempts used`
                          : ''}
                      </span>
                    </div>
                    {activeSection.isCompleted || results[activeSection.checkpoint.id]?.passed ? (
                      <Chip tone="earned" icon="verified">
                        passed
                      </Chip>
                    ) : (
                      <Chip tone="risk" icon="lock">
                        required to continue
                      </Chip>
                    )}
                  </div>

                  {activeSection.checkpoint.prompt ? (
                    <p className="mt-space-sm font-body-sm text-body-sm text-on-surface-variant">{activeSection.checkpoint.prompt}</p>
                  ) : null}

                  <CheckpointForm
                    checkpoint={activeSection.checkpoint}
                    answers={answers[activeSection.checkpoint.id] ?? {}}
                    onChange={(questionId, optionIds) => setAnswer(activeSection.checkpoint!.id, questionId, optionIds)}
                    disabled={
                      submittingCheckpoint === activeSection.checkpoint.id ||
                      Boolean(activeSection.isCompleted) ||
                      Boolean(results[activeSection.checkpoint.id]?.passed)
                    }
                  />

                  {results[activeSection.checkpoint.id] ? (
                    <Alert
                      className="mt-space-md"
                      tone={results[activeSection.checkpoint.id]!.passed ? 'success' : 'warning'}
                      title={
                        results[activeSection.checkpoint.id]!.passed
                          ? `Passed · ${results[activeSection.checkpoint.id]!.percentage}%`
                          : `Not passed · ${results[activeSection.checkpoint.id]!.percentage}%`
                      }
                    >
                      {results[activeSection.checkpoint.id]!.passed
                        ? 'The next section is now unlocked.'
                        : `Review the section and try again — you need ${activeSection.checkpoint.passingScore}%.`}
                    </Alert>
                  ) : null}

                  {!activeSection.isCompleted && !results[activeSection.checkpoint.id]?.passed ? (
                    <div className="mt-space-md flex justify-end">
                      <Button
                        icon="task_alt"
                        loading={submittingCheckpoint === activeSection.checkpoint.id}
                        onClick={() => void submitCheckpoint(activeSection)}
                      >
                        Submit answers
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant px-space-lg py-space-md">
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    {activeSection.isCompleted
                      ? 'This section is complete.'
                      : 'Finished reading? Mark the section complete to unlock the next one.'}
                  </span>
                  <Button
                    variant={activeSection.isCompleted ? 'secondary' : 'primary'}
                    icon={activeSection.isCompleted ? 'check' : 'done'}
                    disabled={activeSection.isCompleted}
                    loading={markingSection === activeSection.id}
                    onClick={() => void markSectionRead(activeSection)}
                  >
                    {activeSection.isCompleted ? 'Section complete' : 'Mark section as read'}
                  </Button>
                </div>
              )}
            </Card>
          ) : null}

          {/* Section navigation */}
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <Button
              variant="secondary"
              icon="chevron_left"
              disabled={activeIndex <= 0}
              onClick={() => {
                const previous = payload.sections[activeIndex - 1];
                if (previous) goToSection(previous);
              }}
            >
              Previous section
            </Button>
            <Button
              variant="ghost"
              iconRight="chevron_right"
              disabled={
                activeIndex >= payload.sections.length - 1 || !payload.sections[activeIndex + 1]?.isUnlocked
              }
              onClick={() => {
                const next = payload.sections[activeIndex + 1];
                if (next) goToSection(next);
              }}
            >
              Next section
            </Button>
          </div>

          {/* Lesson completion */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-space-md p-space-lg">
              <div className="flex flex-col gap-0.5">
                <span className="font-label-md text-label-md text-on-surface">
                  {isContentCompleted
                    ? 'This lesson is complete'
                    : payload.completion.complete
                      ? 'Every section and knowledge check is complete'
                      : 'Complete every section to finish this lesson'}
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {isContentCompleted
                    ? 'Progress has been recorded against your course attempt.'
                    : payload.completion.complete
                      ? 'Mark the lesson complete to unlock the next item in the course.'
                      : `Outstanding: ${payload.completion.pendingSections.slice(0, 3).join(', ')}${
                          payload.completion.pendingSections.length > 3 ? '…' : ''
                        }`}
                </span>
              </div>
              <Button
                iconRight="check"
                loading={completing}
                disabled={isContentCompleted || !payload.completion.complete}
                onClick={onComplete}
              >
                {isContentCompleted ? 'Lesson complete' : 'Mark lesson complete'}
              </Button>
            </div>
          </Card>

          {payload.lesson.references.length > 0 ? (
            <Card>
              <CardHeader title="References" subtitle="Further reading suggested by the instructor" />
              <Divider />
              <ul className="flex flex-col gap-space-sm px-space-lg py-space-md">
                {payload.lesson.references.map((reference) => (
                  <li key={`${reference.label}-${reference.url}`} className="flex flex-col">
                    <a
                      href={reference.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-label-md text-label-md text-primary hover:underline"
                    >
                      {reference.label}
                    </a>
                    {reference.note ? (
                      <span className="font-body-sm text-body-sm text-on-surface-variant">{reference.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </article>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Checkpoint form                                                             */
/* -------------------------------------------------------------------------- */

function CheckpointForm({
  checkpoint,
  answers,
  onChange,
  disabled,
}: {
  checkpoint: NonNullable<ReadingSectionView['checkpoint']>;
  answers: Record<string, string[]>;
  onChange: (questionId: string, optionIds: string[]) => void;
  disabled: boolean;
}) {
  return (
    <ol className="mt-space-md flex flex-col gap-space-md">
      {checkpoint.questions.map((question, index) => {
        const selected = answers[question.id] ?? [];
        const multi = question.type === 'MULTI_CHOICE';

        return (
          <li key={question.id} className="rounded border border-outline-variant bg-surface-container-lowest p-space-md">
            <p className="font-body-md text-body-md text-on-surface">
              <span className="mr-1 font-mono text-label-xs text-on-surface-variant">{index + 1}.</span>
              {question.prompt}
            </p>
            <div className="mt-space-sm flex flex-col gap-1">
              {question.options.map((option) => {
                const isSelected = selected.includes(option.id);
                const isCorrectOption = option.isCorrect === true;

                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-space-sm rounded px-space-sm py-1.5 text-body-sm transition-colors',
                      isSelected ? 'bg-primary-fixed/40' : 'hover:bg-surface-container-low',
                      disabled && 'cursor-not-allowed opacity-80',
                      option.isCorrect !== undefined && (isCorrectOption ? 'text-secondary' : ''),
                    )}
                  >
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`checkpoint-${checkpoint.id}-${question.id}`}
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => {
                        if (multi) {
                          onChange(
                            question.id,
                            isSelected ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                          );
                        } else {
                          onChange(question.id, [option.id]);
                        }
                      }}
                      className="mt-0.5 h-4 w-4 accent-[#4338CA]"
                    />
                    <span className="flex flex-col">
                      <span className="text-on-surface">{option.label}</span>
                      {option.isCorrect !== undefined && isCorrectOption ? (
                        <span className="font-label-xs text-label-xs text-secondary">correct answer</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {question.explanation ? (
              <p className="mt-space-sm rounded bg-secondary-fixed/20 px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface-variant">
                {question.explanation}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
