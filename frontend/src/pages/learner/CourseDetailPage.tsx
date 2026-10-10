import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { courseApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Avatar, Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Card, CardHeader, ErrorBlock, LoadingBlock } from '../../components/ui/data';
import { SkillList } from '../../components/ui/SkillList';
import { ReputationBadge, DifficultyChip } from '../../components/domain/CourseCard';
import { StakeRewardPanel } from '../../components/domain/AccountabilityPanels';
import { ReviewList } from '../../components/domain/ReviewPanel';
import { useAuth } from '../../context/AuthContext';
import { courseAreaBaseFor } from '../../router/routeAccess';
import { formatDate, formatPercent, formatPoints } from '../../utils/format';
import { ReviewModal } from '../../components/domain/ReviewPanel';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';

export function CourseDetailPage() {
  const { idOrSlug = '' } = useParams<{ idOrSlug: string }>();
  const { user } = useAuth();
  const toast = useToast();

  const course = useAsync(() => courseApi.detail(idOrSlug), [idOrSlug]);
  const reviews = useAsync(() => courseApi.reviews(idOrSlug), [idOrSlug]);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useDocumentTitle(course.data?.title ?? 'Course');

  if (course.loading) {
    return (
      <div className="flex flex-col gap-space-lg">
        <LoadingBlock label="Loading course…" rows={5} />
      </div>
    );
  }

  if (course.error || !course.data) {
    return <ErrorBlock title="Could not load this course" message={course.error} onRetry={() => void course.refetch()} />;
  }

  const detail = course.data;
  const enrollment = detail.enrollment;
  const totalContent = detail.modules.reduce((sum, module) => sum + module.contents.length, 0);
  const isOwner = user?.id === detail.instructor.id;
  const alreadyCompleted = enrollment?.status === 'COMPLETED';
  const isLearner = user?.role === 'LEARNER';
  // `/admin/courses` for administrators, `/instructor/courses` for instructors.
  const authoringBase = user ? courseAreaBaseFor(user.role) : null;

  const submitReview = async (input: {
    rating: number;
    difficultyRating: number;
    wouldRecommend: boolean;
    reviewText: string;
  }) => {
    setSubmittingReview(true);
    setReviewError(null);
    try {
      await courseApi.createReview(detail.id, {
        rating: input.rating,
        difficultyRating: input.difficultyRating,
        wouldRecommend: input.wouldRecommend,
        reviewText: input.reviewText.trim() || null,
      });
      toast.success('Review submitted', 'Thank you — your rating feeds instructor reputation.');
      setReviewOpen(false);
      await Promise.all([reviews.refetch(), course.refetch()]);
    } catch (caught) {
      setReviewError(errorMessage(caught));
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <Link to="/courses" className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface">
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to catalogue
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
          <span className="micro-label">Curriculum</span>
          <span className="text-outline-variant">/</span>
          <span className="font-mono">{detail.code}</span>
          <DifficultyChip difficulty={detail.difficulty} />
          {alreadyCompleted ? <Chip tone="earned" icon="check">completed</Chip> : null}
          {enrollment && enrollment.status === 'ACTIVE' ? <Chip tone="stake">enrolled</Chip> : null}
        </div>

        <div className="flex flex-col gap-space-md lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-space-sm lg:max-w-3xl">
            <h1 className="font-headline-xl text-headline-xl-mobile tracking-tight text-on-surface md:text-headline-xl">
              {detail.title}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">{detail.shortDescription}</p>
          </div>

          {/*
            The primary action follows the signed-in role. Enrolment is
            learner-only; instructors and administrators are sent to the
            authoring tools of their *own* area rather than into another
            role's routes.
          */}
          <div className="flex shrink-0 flex-col items-start gap-space-sm lg:items-end">
            {isLearner ? (
              enrollment && enrollment.status === 'ACTIVE' ? (
                <Link to={`/learn/${enrollment.id}`}>
                  <Button size="lg" iconRight="arrow_forward">
                    Resume course
                  </Button>
                </Link>
              ) : alreadyCompleted ? (
                <Link to={`/learn/${enrollment!.id}/completion`}>
                  <Button size="lg" variant="secondary" iconRight="receipt_long">
                    View completion receipt
                  </Button>
                </Link>
              ) : (
                <Link to={`/courses/${detail.slug}/enroll`}>
                  <Button size="lg" iconRight="arrow_forward">
                    Enrol &amp; stake {formatPoints(detail.baseStake, { suffix: false })} pts
                  </Button>
                </Link>
              )
            ) : isOwner && authoringBase ? (
              <Link to={`${authoringBase}/${detail.id}/builder`}>
                <Button size="lg" variant="secondary" iconRight="edit">
                  Open course builder
                </Button>
              </Link>
            ) : user?.role === 'ADMIN' ? (
              <Link to="/admin/courses">
                <Button size="lg" variant="secondary" iconRight="settings">
                  Manage courses
                </Button>
              </Link>
            ) : (
              <span className="rounded border border-outline-variant bg-surface-container-low px-space-md py-space-sm font-label-xs text-label-xs text-on-surface-variant">
                Enrolment is for learner accounts — you are viewing this course as an instructor.
              </span>
            )}
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              {detail.durationDays} days · {detail.modules.length} modules · {totalContent} items
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        {/* Left: description, curriculum, reviews */}
        <div className="flex flex-col gap-space-lg lg:col-span-2">
          <Card>
            <CardHeader title="About this course" />
            <Divider />
            <div className="whitespace-pre-line px-space-lg py-space-md font-body-md text-body-md leading-relaxed text-on-surface-variant">
              {detail.description}
            </div>
            {detail.tags.length > 0 ? (
              <div className="flex flex-wrap gap-space-sm px-space-lg pb-space-lg">
                {detail.tags.map((tag) => (
                  <Chip key={tag} tone="info">
                    {tag}
                  </Chip>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Curriculum"
              subtitle={`${detail.modules.length} modules · ${totalContent} content items${
                detail.finalAssessment ? ' + final assessment' : ''
              }`}
              action={
                <div className="hidden items-center gap-space-sm sm:flex">
                  <span className="font-mono text-label-xs tabular text-on-surface-variant">
                    {detail.moduleWeight}% / {detail.finalTestWeight}%
                  </span>
                  <span className="micro-label text-on-surface-variant">module / final weighting</span>
                </div>
              }
            />
            <Divider />

            <div className="flex flex-col divide-y divide-outline-variant">
              {detail.modules.map((module, index) => (
                <div key={module.id} className="flex flex-col gap-space-xs px-space-lg py-space-md">
                  <div className="flex items-start justify-between gap-space-md">
                    <div className="flex items-start gap-space-md">
                      <span className="font-mono text-label-sm tabular text-on-surface-variant">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="flex flex-col">
                        <span className="font-label-md text-label-md text-on-surface">{module.title}</span>
                        {module.summary ? (
                          <span className="font-body-sm text-body-sm text-on-surface-variant">{module.summary}</span>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 font-label-xs text-label-xs text-on-surface-variant">
                      {module.contents.length} items
                    </span>
                  </div>

                  <ul className="flex flex-col gap-1 pl-8">
                    {module.contents.map((content) => (
                      <li key={content.id} className="flex items-center justify-between gap-space-md">
                        <span className="flex items-center gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
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
                            className="text-[15px]"
                          />
                          {content.title}
                        </span>
                        <span className="shrink-0 font-label-xs text-label-xs text-on-surface-variant">
                          {content.type === 'VIDEO' && content.durationSeconds
                            ? `${Math.round(content.durationSeconds / 60)} min`
                            : content.quiz
                              ? `${content.quiz.questionCount ?? '?'} questions`
                              : content.assessment
                                ? `${content.assessment.passingScore}% to pass`
                                : content.estimatedMinutes
                                  ? `${content.estimatedMinutes} min`
                                  : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {detail.finalAssessment ? (
                <div className="flex items-start justify-between gap-space-md px-space-lg py-space-md">
                  <div className="flex items-start gap-space-md">
                    <span className="font-mono text-label-sm tabular text-on-surface-variant">
                      {String(detail.modules.length + 1).padStart(2, '0')}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface">{detail.finalAssessment.title}</span>
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        Locked until every required module assessment is passed.
                        {detail.minFinalTestScore !== null
                          ? ` Minimum final-test score: ${detail.minFinalTestScore}%.`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 font-label-xs text-label-xs text-on-surface-variant">
                    {detail.finalAssessment.passingScore}% to pass
                  </span>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Learner reviews"
              subtitle={
                reviews.data
                  ? `${reviews.data.count} review(s)${reviews.data.average ? ` · average ${reviews.data.average.toFixed(1)}/5` : ''}`
                  : 'Reviews come from verified graduates'
              }
              action={
                // The API only accepts reviews from verified graduates, so the
                // control is not offered speculatively.
                alreadyCompleted ? (
                  <Button size="sm" variant="secondary" icon="rate_review" onClick={() => setReviewOpen(true)}>
                    Write a review
                  </Button>
                ) : null
              }
            />
            <Divider />
            <div className="px-space-lg">
              {reviews.loading ? (
                <LoadingBlock label="Loading reviews…" rows={2} />
              ) : reviews.error ? (
                <ErrorBlock message={reviews.error} onRetry={() => void reviews.refetch()} />
              ) : (
                <ReviewList
                  reviews={(reviews.data?.reviews ?? []) as never[]}
                />
              )}
            </div>
          </Card>
        </div>

        {/* Right: stake, instructor, stats */}
        <div className="flex flex-col gap-space-lg">
          <StakeRewardPanel
            baseStake={detail.baseStake}
            completionReward={detail.completionReward}
            commitmentBonus={detail.commitmentBonus}
            performanceBonus={detail.performanceBonus}
            performanceThreshold={detail.performanceThreshold}
          />

          <Card>
            <CardHeader title="Instructor" />
            <Divider />
            <div className="flex flex-col gap-space-md px-space-lg py-space-md">
              <div className="flex items-center gap-space-md">
                <Avatar name={detail.instructor.fullName} url={detail.instructor.avatarUrl} className="h-10 w-10" />
                <div className="flex flex-col">
                  <Link to={`/instructors/${detail.instructor.id}`} className="font-label-md text-label-md text-on-surface hover:text-primary">
                    {detail.instructor.fullName}
                  </Link>
                  {detail.instructor.headline ? (
                    <span className="font-body-sm text-body-sm text-on-surface-variant">{detail.instructor.headline}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-space-sm">
                <ReputationBadge tier={detail.instructor.badge} />
                {detail.instructor.courseCount !== undefined ? (
                  <Chip tone="info">{detail.instructor.courseCount} course(s)</Chip>
                ) : null}
              </div>

              {detail.instructor.bio ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">{detail.instructor.bio}</p>
              ) : null}

              {detail.instructor.expertise.length > 0 ? <SkillList skills={detail.instructor.expertise} /> : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="At a glance" />
            <Divider />
            <dl className="flex flex-col divide-y divide-outline-variant">
              {[
                { label: 'Category', value: detail.category },
                { label: 'Difficulty', value: detail.difficulty.charAt(0) + detail.difficulty.slice(1).toLowerCase() },
                { label: 'Duration', value: `${detail.durationDays} days` },
                { label: 'Grace period', value: `${detail.gracePeriodHours} hours` },
                { label: 'Max attempts', value: String(detail.maxAttempts) },
                { label: 'Modules', value: String(detail.modules.length) },
                { label: 'Required watch', value: formatPercent(detail.requiredWatchPercent) },
                { label: 'Performance bonus', value: `≥ ${detail.performanceThreshold}%` },
                { label: 'Learners', value: detail.learnerCount !== undefined ? String(detail.learnerCount) : '—' },
                { label: 'Published', value: formatDate(detail.publishedAt) },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-space-md px-space-lg py-space-sm">
                  <dt className="font-body-sm text-body-sm text-on-surface-variant">{row.label}</dt>
                  <dd className="font-mono text-label-sm tabular text-on-surface">{row.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onSubmit={(input) => void submitReview(input)}
        courseTitle={detail.title}
        submitting={submittingReview}
        error={reviewError}
      />
    </div>
  );
}


