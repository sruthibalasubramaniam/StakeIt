import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Avatar, Divider, MaterialIcon } from '../../components/ui/core';
import { Card, CardHeader, ErrorBlock, LoadingBlock, MetricRow, SectionHeader } from '../../components/ui/data';
import { SkillList } from '../../components/ui/SkillList';
import { CourseCard, ReputationBadge } from '../../components/domain/CourseCard';
import { formatDate, formatPercent } from '../../utils/format';

/** Public instructor profile: reputation, badges and published courses. */
export function InstructorProfilePage() {
  const { instructorId = '' } = useParams<{ instructorId: string }>();
  useDocumentTitle('Instructor profile');

  const profile = useAsync(() => publicApi.instructor(instructorId), [instructorId]);

  if (profile.loading) return <LoadingBlock label="Loading instructor…" rows={4} />;
  if (profile.error || !profile.data) {
    return <ErrorBlock title="Could not load this instructor" message={profile.error} onRetry={() => void profile.refetch()} />;
  }

  const { instructor, reputation, badges, courses } = profile.data;

  return (
    <div className="flex flex-col gap-space-lg">
      <Link
        to="/courses"
        className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
      >
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to catalogue
      </Link>

      <SectionHeader
        eyebrow="Instructor"
        title={instructor.fullName}
        meta={<ReputationBadge tier={reputation.tier} />}
      />

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="About" subtitle={instructor.headline ?? undefined} />
          <Divider />
          <div className="flex flex-col gap-space-md p-space-lg">
            <div className="flex items-center gap-space-md">
              <Avatar name={instructor.fullName} url={instructor.avatarUrl} className="h-12 w-12" />
              <div className="flex flex-col">
                <span className="font-label-md text-label-md text-on-surface">{instructor.fullName}</span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  Teaching since {formatDate(instructor.createdAt)}
                </span>
              </div>
            </div>
            {instructor.bio ? (
              <p className="font-body-md text-body-md leading-relaxed text-on-surface-variant">{instructor.bio}</p>
            ) : null}
            {instructor.expertise.length > 0 ? <SkillList skills={instructor.expertise} /> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Reputation" subtitle="Computed from settled learner outcomes" />
          <Divider />
          <div className="p-space-lg">
            <MetricRow label="Tier" value={reputation.tier} />
            <MetricRow label="Composite score" value={String(reputation.compositeScore)} />
            <MetricRow
              label="Completion rate"
              value={reputation.learnerOutcomes > 0 ? formatPercent(reputation.completionRate * 100) : '—'}
            />
            <MetricRow
              label="Average score"
              value={reputation.averageScore > 0 ? formatPercent(reputation.averageScore, 1) : '—'}
            />
            <MetricRow
              label="Average rating"
              value={reputation.averageRating > 0 ? `${reputation.averageRating.toFixed(1)}/5` : '—'}
            />
            <MetricRow label="Settled outcomes" value={String(reputation.learnerOutcomes)} />
            {reputation.awardedAt ? <MetricRow label="Badge awarded" value={formatDate(reputation.awardedAt)} /> : null}
          </div>
        </Card>
      </div>

      {badges.length > 0 ? (
        <Card>
          <CardHeader title="Badge history" subtitle="Reputation tiers over time" />
          <Divider />
          <ul className="divide-y divide-outline-variant">
            {badges.map((badge) => (
              <li key={badge.id} className="flex items-center justify-between gap-space-md px-space-lg py-space-sm">
                <span className="flex items-center gap-space-sm">
                  <ReputationBadge tier={badge.tier} />
                  {badge.isActive ? (
                    <span className="font-label-xs text-label-xs text-secondary">current</span>
                  ) : (
                    <span className="font-label-xs text-label-xs text-on-surface-variant">superseded</span>
                  )}
                </span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(badge.awardedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="flex flex-col gap-space-md">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">
          Published courses <span className="font-mono text-label-md text-on-surface-variant">({courses.length})</span>
        </h2>
        {courses.length === 0 ? (
          <Card>
            <p className="p-space-lg font-body-sm text-body-sm text-on-surface-variant">
              This instructor has no published courses yet.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-space-lg md:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        )}
      </section>

      <p className="font-label-xs text-label-xs text-on-surface-variant">
        Reputation affects course visibility and trust indicators only. It never changes the stake required for a course.
      </p>
    </div>
  );
}
