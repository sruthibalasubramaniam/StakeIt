import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Chip } from '../../components/ui/core';
import { Alert, Card, CardHeader, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatCard, Tabs } from '../../components/ui/data';
import { Divider } from '../../components/ui/core';
import { ReputationBadge } from '../../components/domain/CourseCard';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDate } from '../../utils/format';

type TierFilter = 'ALL' | 'GOLD' | 'SILVER' | 'BRONZE';

/** Badge administration: award history plus the tier thresholds in force. */
export function AdminBadgesPage() {
  useDocumentTitle('Instructor badges');
  const toast = useToast();

  const [tier, setTier] = useState<TierFilter>('ALL');
  const badges = useAsync(() => adminApi.listBadges(), []);

  const recompute = async () => {
    try {
      const result = await adminApi.recomputeReputation();
      toast.success('Badges recomputed', `${result.instructorsProcessed} instructor(s) evaluated.`);
      await badges.refetch();
    } catch (caught) {
      toast.error('Could not recompute badges', errorMessage(caught));
    }
  };

  const rows = (badges.data ?? []).filter((badge) => tier === 'ALL' || badge.tier === tier);
  const countFor = (value: TierFilter) =>
    value === 'ALL' ? (badges.data?.length ?? 0) : (badges.data ?? []).filter((badge) => badge.tier === value).length;

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Instructor badges"
        meta={
          <div className="flex items-center gap-space-sm">
            <Link to="/admin/instructors">
              <Button variant="secondary" icon="group">
                Instructors
              </Button>
            </Link>
            <Button icon="refresh" onClick={() => void recompute()}>
              Recompute
            </Button>
          </div>
        }
      />

      {badges.error ? (
        <ErrorBlock message={badges.error} onRetry={() => void badges.refetch()} />
      ) : badges.loading || !badges.data ? (
        <LoadingBlock label="Loading badges…" rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
            <StatCard label="Gold" value={countFor('GOLD')} icon="military_tech" tone="success" />
            <StatCard label="Silver" value={countFor('SILVER')} icon="workspace_premium" />
            <StatCard label="Bronze" value={countFor('BRONZE')} icon="verified" />
            <StatCard label="Total awarded" value={countFor('ALL')} icon="badge" hint="Active and historic" />
          </div>

          <Tabs
            tabs={[
              { id: 'ALL', label: 'All', count: countFor('ALL') },
              { id: 'GOLD', label: 'Gold', count: countFor('GOLD') },
              { id: 'SILVER', label: 'Silver', count: countFor('SILVER') },
              { id: 'BRONZE', label: 'Bronze', count: countFor('BRONZE') },
            ]}
            active={tier}
            onChange={(id) => setTier(id as TierFilter)}
          />

          <Card>
            <CardHeader title="Badge history" subtitle="Automatic awards and manual overrides" />
            <Divider />
            <div className="flex flex-col divide-y divide-outline-variant">
              {rows.length === 0 ? (
                <EmptyState
                  icon="military_tech"
                  title={tier === 'ALL' ? 'No badges awarded yet' : `No ${tier.toLowerCase()} badges`}
                  description="Badges require a minimum number of settled learner outcomes, so a new instructor will not qualify immediately."
                />
              ) : (
                rows.map((badge) => (
                  <div key={badge.id} className="flex flex-wrap items-center justify-between gap-space-md px-space-lg py-space-sm">
                    <div className="flex items-center gap-space-md">
                      <ReputationBadge tier={badge.tier} />
                      <div className="flex flex-col">
                        <Link
                          to={`/instructors/${badge.instructor.id}`}
                          className="font-label-md text-label-md text-on-surface hover:text-primary"
                        >
                          {badge.instructor.fullName}
                        </Link>
                        <span className="font-label-xs text-label-xs text-on-surface-variant">{badge.instructor.email}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-space-md">
                      {badge.isActive ? <Chip tone="earned">active</Chip> : <Chip tone="locked">superseded</Chip>}
                      <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(badge.awardedAt)}</span>
                      {badge.notes ? (
                        <span className="max-w-xs truncate font-label-xs text-label-xs text-on-surface-variant" title={badge.notes}>
                          {badge.notes}
                        </span>
                      ) : null}
                      <Link to={`/instructors/${badge.instructor.id}`} className="font-label-sm text-label-sm text-primary hover:underline">
                        Profile
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Current tier requirements"
                subtitle="Configured centrally in backend/src/config/constants.ts"
              />
              <Divider />
              <div className="flex flex-col divide-y divide-outline-variant">
                {[
                  {
                    tier: 'GOLD',
                    detail: '40+ settled outcomes · 80% completion · 85% average score · 70% commitment success · 4.5/5 rating · composite ≥ 85',
                  },
                  {
                    tier: 'SILVER',
                    detail: '20+ settled outcomes · 65% completion · 75% average score · 55% commitment success · 4.0/5 rating · composite ≥ 72',
                  },
                  {
                    tier: 'BRONZE',
                    detail: '8+ settled outcomes · 50% completion · 65% average score · 40% commitment success · 3.5/5 rating · composite ≥ 58',
                  },
                ].map((entry) => (
                  <div key={entry.tier} className="flex flex-col gap-0.5 px-space-lg py-space-sm">
                    <span className="font-label-md text-label-md text-on-surface">{entry.tier}</span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">{entry.detail}</span>
                  </div>
                ))}
              </div>
            </Card>

            <div className="flex flex-col gap-space-lg">
              <Card>
                <CardHeader title="Gating rules" />
                <Divider />
                <ul className="flex flex-col gap-space-sm p-space-lg">
                  {[
                    'Every tier requires a minimum number of settled learner outcomes.',
                    'Completion rate, average score, commitment success rate and learner rating all contribute.',
                    'A composite score threshold must also be cleared.',
                    'Badges influence course visibility and trust indicators only — never stake pricing.',
                  ].map((rule) => (
                    <li key={rule} className="font-body-sm text-body-sm text-on-surface-variant">
                      · {rule}
                    </li>
                  ))}
                </ul>
              </Card>

              <Alert tone="warning" title="Reputation is earned, not granted">
                The badge selector on the instructors page is an explicit override. Automatic awards recompute nightly, and a
                manual badge can therefore be replaced by the next scheduled run unless the underlying metrics support it.
              </Alert>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

