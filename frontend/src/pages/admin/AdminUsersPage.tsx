import { useState } from 'react';
import { adminApi } from '../../services/endpoints';
import { useAsync, useDebounced, useDocumentTitle } from '../../hooks';
import { Button, Chip } from '../../components/ui/core';
import { Alert, Card, ConfirmDialog, DataTable, EmptyState, ErrorBlock, Modal, Pagination, SectionHeader, Tabs } from '../../components/ui/data';
import { Input, Select } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDate, formatPoints } from '../../utils/format';
import type { PublicUser, Role, WalletSummary } from '../../types/api';

type AdminUserRow = PublicUser & {
  wallet: WalletSummary;
  counts: { enrollments: number; courses: number; stakes: number };
  badge: string | null;
};

type RoleFilter = 'ALL' | Role;

/** User administration: roles, activation, point adjustments. */
export function AdminUsersPage() {
  useDocumentTitle('Users');
  const toast = useToast();

  const [role, setRole] = useState<RoleFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 350);

  const users = useAsync(
    () =>
      adminApi.listUsers({
        role: role === 'ALL' ? undefined : role,
        q: debouncedSearch.trim() || undefined,
        page,
        pageSize: 15,
      }),
    [role, debouncedSearch, page],
  );

  const [pointsTarget, setPointsTarget] = useState<AdminUserRow | null>(null);
  const [pointsAmount, setPointsAmount] = useState(100);
  const [pointsReason, setPointsReason] = useState('');
  const [granting, setGranting] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<AdminUserRow | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const changeRole = async (row: AdminUserRow, nextRole: Role) => {
    try {
      await adminApi.updateUser(row.id, { role: nextRole });
      toast.success('Role updated', `${row.fullName} is now a ${nextRole}.`);
      await users.refetch();
    } catch (caught) {
      toast.error('Could not update role', errorMessage(caught));
    }
  };

  const toggleActive = async (row: AdminUserRow) => {
    setDeactivating(true);
    try {
      await adminApi.updateUser(row.id, { isActive: !row.isActive });
      toast.success(row.isActive ? 'Account deactivated' : 'Account reactivated', row.fullName);
      setDeactivateTarget(null);
      await users.refetch();
    } catch (caught) {
      toast.error('Could not change account status', errorMessage(caught));
    } finally {
      setDeactivating(false);
    }
  };

  const grantPoints = async () => {
    if (!pointsTarget || !pointsReason.trim() || pointsAmount === 0) return;
    setGranting(true);
    try {
      await adminApi.grantPoints(pointsTarget.id, { amount: pointsAmount, reason: pointsReason.trim() });
      toast.success('Points adjusted', `${pointsAmount > 0 ? '+' : ''}${pointsAmount} points for ${pointsTarget.fullName}.`);
      setPointsTarget(null);
      setPointsReason('');
      await users.refetch();
    } catch (caught) {
      toast.error('Could not adjust points', errorMessage(caught));
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Platform administration"
        title="Users"
        meta={
          <span className="flex items-baseline gap-1.5">
            <span className="micro-label text-on-surface-variant">Total:</span>
            <span className="font-mono text-label-md tabular text-on-surface">{users.data?.pagination.total ?? 0}</span>
          </span>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <Tabs
          tabs={[
            { id: 'ALL', label: 'All' },
            { id: 'LEARNER', label: 'Learners' },
            { id: 'INSTRUCTOR', label: 'Instructors' },
            { id: 'ADMIN', label: 'Admins' },
          ]}
          active={role}
          onChange={(id) => {
            setRole(id as RoleFilter);
            setPage(1);
          }}
        />
        <Input
          icon="search"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-72"
        />
      </div>

      <Card>
        {users.error ? (
          <ErrorBlock message={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <>
            <DataTable<AdminUserRow>
              loading={users.loading}
              rows={users.data?.items ?? []}
              keyFor={(row) => row.id}
              empty={<EmptyState icon="person_off" title="No users match" description="Try another search or role filter." />}
              columns={[
                {
                  key: 'user',
                  header: 'Account',
                  render: (row) => (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-label-md text-label-md text-on-surface">{row.fullName}</span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">{row.email}</span>
                      <span className="flex items-center gap-space-xs">
                        {!row.isActive ? <Chip tone="risk">deactivated</Chip> : null}
                        {row.badge ? <Chip tone={row.badge === 'GOLD' ? 'earned' : 'info'}>{row.badge.toLowerCase()}</Chip> : null}
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'role',
                  header: 'Role',
                  render: (row) => (
                    <Select
                      value={row.role}
                      onChange={(event) => void changeRole(row, event.target.value as Role)}
                      options={[
                        { value: 'LEARNER', label: 'Learner' },
                        { value: 'INSTRUCTOR', label: 'Instructor' },
                        { value: 'ADMIN', label: 'Admin' },
                      ]}
                      className="w-32"
                    />
                  ),
                },
                {
                  key: 'wallet',
                  header: 'Wallet',
                  align: 'right',
                  render: (row) => (
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-label-md tabular text-on-surface">
                        {formatPoints(row.wallet.availableBalance, { suffix: false })}
                      </span>
                      <span className="font-label-xs text-label-xs text-on-surface-variant">
                        {row.wallet.lockedBalance} locked
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'activity',
                  header: 'Activity',
                  align: 'right',
                  render: (row) => (
                    <div className="flex flex-col items-end font-label-xs text-label-xs text-on-surface-variant">
                      <span>{row.counts.enrollments} enrolment(s)</span>
                      <span>{row.counts.courses} course(s) · {row.counts.stakes} stake(s)</span>
                    </div>
                  ),
                },
                {
                  key: 'created',
                  header: 'Joined',
                  align: 'right',
                  render: (row) => <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(row.createdAt)}</span>,
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <div className="flex items-center justify-end gap-space-xs">
                      <Button size="sm" variant="secondary" icon="toll" onClick={() => setPointsTarget(row)}>
                        Points
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={row.isActive ? 'block' : 'check_circle'}
                        className={row.isActive ? 'text-error' : 'text-secondary'}
                        onClick={() => (row.isActive ? setDeactivateTarget(row) : void toggleActive(row))}
                        title={row.isActive ? 'Deactivate' : 'Reactivate'}
                      >
                        {''}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />

            {users.data ? (
              <Pagination
                page={users.data.pagination.page}
                totalPages={users.data.pagination.totalPages}
                total={users.data.pagination.total}
                onPageChange={setPage}
                className="border-t border-outline-variant"
              />
            ) : null}
          </>
        )}
      </Card>

      <Alert tone="info" icon="info">
        Role changes take effect immediately: the API reads the role from the database on every request, so a token issued before
        the change cannot retain elevated access.
      </Alert>

      {/* Points adjustment */}
      <Modal
        open={Boolean(pointsTarget)}
        onClose={() => setPointsTarget(null)}
        title="Adjust wallet balance"
        description={pointsTarget ? `${pointsTarget.fullName} · current balance ${pointsTarget.wallet.availableBalance} pts` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPointsTarget(null)} disabled={granting}>
              Cancel
            </Button>
            <Button loading={granting} disabled={!pointsReason.trim() || pointsAmount === 0} onClick={() => void grantPoints()}>
              Apply adjustment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-md">
          <Input
            label="Amount (negative to debit)"
            type="number"
            value={pointsAmount}
            onChange={(event) => setPointsAmount(Number(event.target.value))}
            hint="Positive credits the wallet, negative debits it. Zero is rejected."
          />
          <Input
            label="Reason"
            value={pointsReason}
            onChange={(event) => setPointsReason(event.target.value)}
            placeholder="Compensation for a platform outage"
            hint="Recorded on the ledger entry for auditability."
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => deactivateTarget && void toggleActive(deactivateTarget)}
        title="Deactivate this account?"
        message="Deactivation blocks sign-in but keeps the account, wallet and ledger intact so the audit trail remains complete."
        confirmLabel="Deactivate account"
        destructive
        pending={deactivating}
      />
    </div>
  );
}

