import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { enrollmentApi, learningApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip, Divider, MaterialIcon, ProgressBar } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock } from '../../components/ui/data';
import { Input } from '../../components/ui/forms';
import { VideoPlayer } from '../../components/domain/VideoPlayer';
import { ReadingLessonReader } from '../../components/domain/ReadingLessonReader';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatPercent } from '../../utils/format';

/**
 * Content player for video and reading items.
 *
 * Both content types report progress to the API in small increments; completion
 * is only ever granted by the server after it has verified the requirement, so
 * this page never marks content complete on its own authority.
 */
export function ContentPage() {
  const { enrollmentId = '', contentId = '' } = useParams<{ enrollmentId: string; contentId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const entry = useAsync(() => enrollmentApi.detail(enrollmentId), [enrollmentId]);
  const attemptId = entry.data?.attemptId ?? '';

  const content = useAsync(() => learningApi.content(attemptId, contentId), [attemptId, contentId], {
    enabled: Boolean(attemptId && contentId),
  });

  const [completing, setCompleting] = useState(false);
  const [watchState, setWatchState] = useState({
    watchedSeconds: 0,
    validWatchPercent: 0,
    requiredWatchPercent: 90,
    isWatchRequirementMet: false,
    suspicious: false,
    notice: undefined as string | undefined,
  });
  const [comprehensionAnswer, setComprehensionAnswer] = useState('');
  const [comprehensionResult, setComprehensionResult] = useState<{ passed: boolean; feedback: string } | null>(null);
  const [checkingComprehension, setCheckingComprehension] = useState(false);

  const readingRef = useRef<HTMLDivElement | null>(null);
  const [scrollPercent, setScrollPercent] = useState(0);

  useDocumentTitle(content.data?.content.title ?? 'Learning');

  // Seed the watch state from persisted progress so reopening resumes accurately.
  useEffect(() => {
    const payload = content.data;
    if (!payload) return;
    setWatchState({
      watchedSeconds: payload.content.progress.watchedSeconds,
      validWatchPercent: payload.content.progress.validWatchPercent,
      requiredWatchPercent:
        payload.content.requiredWatchPercent ??
        (payload.payload.kind === 'VIDEO' ? payload.payload.requiredWatchPercent : 90),
      isWatchRequirementMet: payload.content.isCompleted,
      suspicious: false,
      notice: undefined,
    });
    if (payload.payload.kind === 'READING' && payload.payload.structured === false) {
      setComprehensionResult(
        payload.content.progress.comprehensionPassed === null
          ? null
          : {
              passed: Boolean(payload.content.progress.comprehensionPassed),
              feedback: payload.content.progress.comprehensionPassed
                ? 'Comprehension check already passed.'
                : 'The comprehension check has not been passed yet.',
            },
      );
    }
  }, [content.data]);

  // Content that lives on another screen redirects there.
  useEffect(() => {
    const payload = content.data?.payload;
    if (!payload) return;
    if (payload.kind === 'QUIZ') navigate(`/learn/${enrollmentId}/quiz/${payload.quizId}`, { replace: true });
    if (payload.kind === 'MODULE_ASSESSMENT') {
      navigate(`/learn/${enrollmentId}/assessment/${payload.assessmentId}`, { replace: true });
    }
  }, [content.data, enrollmentId, navigate]);

  const heartbeat = useCallback(
    async (payload: {
      fromSeconds: number;
      positionSeconds: number;
      elapsedRealSeconds: number;
      durationSeconds: number;
      playbackRate: number;
      activeSeconds: number;
    }) => {
      try {
        const result = await learningApi.recordProgress(attemptId, contentId, payload);
        setWatchState((current) => ({
          ...current,
          watchedSeconds: result.watchedSeconds ?? current.watchedSeconds,
          validWatchPercent: result.validWatchPercent ?? current.validWatchPercent,
          requiredWatchPercent: result.requiredWatchPercent ?? current.requiredWatchPercent,
          isWatchRequirementMet: result.isWatchRequirementMet ?? current.isWatchRequirementMet,
          suspicious: result.suspicious ?? false,
          notice: result.notice,
        }));
      } catch {
        // A dropped heartbeat is recoverable — the next one covers the gap.
      }
    },
    [attemptId, contentId],
  );

  const complete = async () => {
    setCompleting(true);
    try {
      const result = await learningApi.complete(attemptId, contentId);
      const next = result.unlocked.nextContent;
      toast.success(
        'Content completed',
        result.unlocked.finalAssessmentUnlocked
          ? 'Every module is complete — the final test is now unlocked.'
          : next
            ? `Next up: ${next.title}`
            : 'Progress recorded.',
      );
      navigate(`/learn/${enrollmentId}`);
    } catch (caught) {
      toast.error('Could not complete this content', errorMessage(caught));
    } finally {
      setCompleting(false);
    }
  };

  const reportReading = useCallback(
    async (reachedEnd: boolean, percent: number) => {
      try {
        await learningApi.recordProgress(attemptId, contentId, {
          reachedEnd,
          scrollPercent: Math.round(percent),
          activeSeconds: 30,
        });
      } catch {
        /* recoverable */
      }
    },
    [attemptId, contentId],
  );

  const handleReadingScroll = () => {
    const element = readingRef.current;
    if (!element) return;
    const max = element.scrollHeight - element.clientHeight;
    const percent = max <= 0 ? 100 : (element.scrollTop / max) * 100;
    setScrollPercent(percent);
    if (percent >= 95) void reportReading(true, percent);
  };

  if (entry.error) return <ErrorBlock title="Could not load this enrolment" message={entry.error} onRetry={() => void entry.refetch()} />;
  if (content.loading || entry.loading) return <LoadingBlock label="Loading content…" rows={4} />;
  if (content.error || !content.data) {
    // Locked content returns 422 CONTENT_LOCKED — explain rather than showing a raw error.
    return (
      <div className="flex flex-col gap-space-md">
        <ErrorBlock
          title="This content is locked"
          message={
            content.error ??
            'Complete the previous required item to unlock this content. Locking is enforced by the API, not the interface.'
          }
          onRetry={() => void content.refetch()}
        />
        <Link to={`/learn/${enrollmentId}`} className="w-fit">
          <Button variant="secondary" icon="arrow_back">
            Back to course
          </Button>
        </Link>
      </div>
    );
  }

  const data = content.data;
  const payload = data.payload;

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <Link
          to={`/learn/${enrollmentId}`}
          className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" className="text-[16px]" />
          Back to course
        </Link>
        <Chip tone="info">
          {data.module.orderIndex + 1 < 10 ? '0' : ''}
          {data.module.orderIndex + 1} · {data.module.title}
        </Chip>
      </div>

      <div className="flex flex-col gap-space-xs">
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">{data.content.title}</h1>
        {data.content.description ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{data.content.description}</p>
        ) : null}
        <span className="font-label-xs text-label-xs text-on-surface-variant">
          Item {data.module.position} of {data.module.total} in this module · overall{' '}
          {formatPercent(data.progress.overallProgressPercent)}
        </span>
      </div>

      {payload.kind === 'VIDEO' ? (
        <VideoPlayer
          src={payload.videoUrl}
          title={data.content.title}
          durationSeconds={payload.durationSeconds}
          requiredWatchPercent={payload.requiredWatchPercent}
          initialState={{
            ...watchState,
            requiredWatchPercent: payload.requiredWatchPercent,
          }}
          onHeartbeat={(beat) => void heartbeat(beat)}
          onComplete={() => void complete()}
          canComplete={watchState.isWatchRequirementMet}
          completing={completing}
        />
      ) : null}

      {/* MOOC reader: sections, checkpoints, PDFs, resume */}
      {payload.kind === 'READING' && payload.structured ? (
        <ReadingLessonReader
          attemptId={attemptId}
          contentId={contentId}
          payload={payload}
          isContentCompleted={data.content.isCompleted}
          onRefresh={() => content.refetch()}
          onComplete={() => void complete()}
          completing={completing}
        />
      ) : null}

      {payload.kind === 'READING' && !payload.structured ? (
        <div className="flex flex-col gap-space-md">
          <div
            ref={readingRef}
            onScroll={handleReadingScroll}
            className="surface-card max-h-[60vh] overflow-y-auto px-space-lg py-space-lg"
          >
            <article className="whitespace-pre-line font-body-lg text-body-lg leading-relaxed text-on-surface">
              {payload.body}
            </article>
          </div>

          <div className="flex flex-col gap-space-sm">
            <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
              <span>Reading progress</span>
              <span className="metric">{Math.round(scrollPercent)}% scrolled</span>
            </div>
            <ProgressBar value={scrollPercent} tone={scrollPercent >= 95 ? 'success' : 'primary'} label="Reading progress" />
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              Reach the end of the reading to satisfy the completion point{payload.requiresComprehensionCheck ? ', then pass the comprehension check.' : '.'}
            </span>
          </div>

          {payload.requiresComprehensionCheck ? (
            <Card>
              <CardHeader title="Comprehension check" subtitle="A short answer keeps the reading honest." />
              <Divider />
              <div className="flex flex-col gap-space-md px-space-lg py-space-md">
                <p className="font-body-md text-body-md text-on-surface">{payload.comprehensionPrompt}</p>
                <div className="flex flex-col gap-space-sm sm:flex-row sm:items-end">
                  <Input
                    label="Your answer"
                    className="sm:flex-1"
                    value={comprehensionAnswer}
                    onChange={(event) => setComprehensionAnswer(event.target.value)}
                    disabled={comprehensionResult?.passed}
                    placeholder="Type your answer"
                  />
                  <Button
                    loading={checkingComprehension}
                    disabled={comprehensionResult?.passed || comprehensionAnswer.trim().length === 0}
                    onClick={() => {
                      void (async () => {
                        setCheckingComprehension(true);
                        try {
                          const result = await learningApi.submitComprehension(attemptId, contentId, comprehensionAnswer);
                          setComprehensionResult(result);
                          if (result.passed) toast.success('Comprehension check passed');
                        } catch (caught) {
                          toast.error('Could not check your answer', errorMessage(caught));
                        } finally {
                          setCheckingComprehension(false);
                        }
                      })();
                    }}
                  >
                    Check answer
                  </Button>
                </div>

                {comprehensionResult ? (
                  <Alert tone={comprehensionResult.passed ? 'success' : 'warning'}>
                    {comprehensionResult.feedback}
                  </Alert>
                ) : null}
              </div>
            </Card>
          ) : null}

          <div className="flex items-center justify-between gap-space-md">
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              The API verifies you reached the end before accepting completion.
            </span>
            <Button onClick={() => void complete()} loading={completing} iconRight="check">
              Mark reading complete
            </Button>
          </div>
        </div>
      ) : null}

      {payload.kind === 'UNSUPPORTED' ? (
        <Alert tone="info" title="Content type not yet playable">
          This item is a {data.content.type.toLowerCase().replace('_', ' ')}. The platform records submissions for this type, and
          a sandbox evaluator or rubric review can be attached without changing this screen.
        </Alert>
      ) : null}

      {/* Navigation */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-space-md p-space-lg">
          <div className="flex items-center gap-space-sm">
            {data.navigation.previousContentId ? (
              <Link to={`/learn/${enrollmentId}/content/${data.navigation.previousContentId}`}>
                <Button variant="secondary" icon="chevron_left">
                  Previous item
                </Button>
              </Link>
            ) : null}
            {data.navigation.nextContentId ? (
              <Link to={`/learn/${enrollmentId}/content/${data.navigation.nextContentId}`}>
                <Button variant="ghost" iconRight="chevron_right">
                  Next item
                </Button>
              </Link>
            ) : null}
          </div>
          <span className="font-label-xs text-label-xs text-on-surface-variant">
            {data.navigation.nextModuleUnlockHint}
          </span>
        </div>
      </Card>
    </div>
  );
}
