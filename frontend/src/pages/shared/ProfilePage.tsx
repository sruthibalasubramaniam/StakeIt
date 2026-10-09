import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../../services/endpoints';
import { useDocumentTitle } from '../../hooks';
import { Avatar, Button, Chip, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert, Card, CardHeader, MetricRow, SectionHeader } from '../../components/ui/data';
import { Input, Textarea } from '../../components/ui/forms';
import { SkillList } from '../../components/ui/SkillList';
import { WalletBalanceCard } from '../../components/domain/AccountabilityPanels';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { formatDate } from '../../utils/format';

/**
 * Profile for every role. Instructors additionally get a link to their public
 * profile and their reputation summary; learners see their wallet.
 */
export function ProfilePage() {
  useDocumentTitle('Profile');
  const { user, updateUser } = useAuth();
  const toast = useToast();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [headline, setHeadline] = useState(user?.headline ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user) return null;

  const dirty =
    fullName !== user.fullName || headline !== (user.headline ?? '') || bio !== (user.bio ?? '');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await authApi.updateProfile({
        fullName,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
      });
      updateUser(updated);
      toast.success('Profile updated');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setChanging(true);
    setPasswordError(null);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed', 'Use your new password next time you sign in.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (caught) {
      setPasswordError(errorMessage(caught));
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader eyebrow="Account" title="Profile" />

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <div className="flex flex-col gap-space-lg lg:col-span-2">
          <Card>
            <CardHeader
              title="Identity"
              subtitle="Shown on your enrolments and, for instructors, on course pages."
            />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              <div className="flex items-center gap-space-md">
                <Avatar name={user.fullName} url={user.avatarUrl} className="h-12 w-12" />
                <div className="flex flex-col">
                  <span className="font-headline-sm text-headline-sm text-on-surface">{user.fullName}</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">{user.email}</span>
                  <span className="mt-0.5 flex items-center gap-space-sm">
                    <Chip tone="info">{user.role}</Chip>
                    {!user.isActive ? <Chip tone="risk">deactivated</Chip> : null}
                  </span>
                </div>
              </div>

              <Divider />

              {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}

              <Input label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} />
              <Input
                label="Headline"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                maxLength={160}
                placeholder="Backend engineer · Learning distributed systems"
                hint="A one-line summary shown next to your name."
              />
              <Textarea
                label="Bio"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="What are you working towards?"
              />

              {user.expertise.length > 0 ? <SkillList skills={user.expertise} /> : null}

              <div className="flex items-center justify-end gap-space-sm">
                {dirty ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFullName(user.fullName);
                      setHeadline(user.headline ?? '');
                      setBio(user.bio ?? '');
                    }}
                  >
                    Discard
                  </Button>
                ) : null}
                <Button loading={saving} disabled={!dirty} onClick={() => void save()} icon="save">
                  Save changes
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Password"
              subtitle="Only applies when this deployment uses local authentication (AUTH_PROVIDER=local)."
            />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              {passwordError ? <Alert tone="error" title="Could not change password">{passwordError}</Alert> : null}
              <Input
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                hint="At least 8 characters, including a letter and a number."
              />
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  loading={changing}
                  disabled={!currentPassword || newPassword.length < 8}
                  onClick={() => void changePassword()}
                  icon="key"
                >
                  Change password
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-space-lg">
          <WalletBalanceCard
            availableBalance={user.wallet.availableBalance}
            lockedBalance={user.wallet.lockedBalance}
            lifetimeEarned={user.wallet.lifetimeEarned}
            lifetimeForfeited={user.wallet.lifetimeForfeited}
          />

          <Card>
            <CardHeader title="Account" />
            <Divider />
            <div className="px-space-lg py-space-md">
              <MetricRow label="Role" value={user.role} />
              <MetricRow label="Member since" value={formatDate(user.createdAt)} />
              <MetricRow label="Last sign-in" value={user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'} />
            </div>
          </Card>

          {user.role === 'INSTRUCTOR' ? (
            <Card>
              <CardHeader title="Instructor tools" />
              <Divider />
              <div className="flex flex-col divide-y divide-outline-variant">
                <Link
                  to={`/instructors/${user.id}`}
                  className="flex items-center justify-between gap-space-md px-space-lg py-space-sm hover:bg-surface-container-low"
                >
                  <span className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface">
                    <MaterialIcon name="badge" className="text-on-surface-variant" />
                    Public profile
                  </span>
                  <MaterialIcon name="chevron_right" className="text-on-surface-variant" />
                </Link>
                <Link
                  to="/instructor/dashboard"
                  className="flex items-center justify-between gap-space-md px-space-lg py-space-sm hover:bg-surface-container-low"
                >
                  <span className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface">
                    <MaterialIcon name="insights" className="text-on-surface-variant" />
                    Reputation &amp; analytics
                  </span>
                  <MaterialIcon name="chevron_right" className="text-on-surface-variant" />
                </Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
