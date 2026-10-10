import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, MaterialIcon } from '../../components/ui/core';
import { Alert } from '../../components/ui/data';
import { Input, Radio } from '../../components/ui/forms';
import { useAuth } from '../../context/AuthContext';
import { useDocumentTitle } from '../../hooks';
import { errorMessage } from '../../services/api';
import { homePathFor } from '../../router/routeAccess';

type RegisterRole = 'LEARNER' | 'INSTRUCTOR';

export function RegisterPage() {
  useDocumentTitle('Create account');

  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<RegisterRole>('LEARNER');
  const [headline, setHeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordMismatch = confirm.length > 0 && password !== confirm;

  const submit = async () => {
    if (passwordMismatch) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const user = await register({
        fullName,
        email,
        password,
        role,
        headline: headline.trim() ? headline.trim() : undefined,
      });
      navigate(homePathFor(user.role), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="surface-card flex flex-col gap-space-lg px-space-lg py-space-lg">
      <div className="flex flex-col gap-space-xs">
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Create your account</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          New learner wallets are funded with a welcome grant of platform points so you can stake your first course.
        </p>
      </div>

      {error ? (
        <Alert tone="error" title="Could not create account">
          {error}
        </Alert>
      ) : null}

      <form
        className="flex flex-col gap-space-md"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Full name"
          icon="person"
          required
          minLength={2}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Alex Morgan"
        />

        <Input
          label="Email"
          type="email"
          icon="mail"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />

        <Input
          label="Password"
          type="password"
          icon="key"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="At least 8 characters, including a letter and a number."
        />

        <Input
          label="Confirm password"
          type="password"
          icon="key"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={passwordMismatch ? 'Passwords do not match.' : null}
        />

        <div className="flex flex-col gap-space-sm">
          <span className="font-label-sm text-label-sm text-on-surface">I am joining as</span>
          <div className="flex flex-col gap-space-xs rounded border border-outline-variant bg-surface-container-lowest p-space-xs">
            <Radio
              name="role"
              value="LEARNER"
              checked={role === 'LEARNER'}
              onChange={() => setRole('LEARNER')}
              label="Learner"
              detail="Enrol in courses, stake points and earn rewards for verified completion."
            />
            <Radio
              name="role"
              value="INSTRUCTOR"
              checked={role === 'INSTRUCTOR'}
              onChange={() => setRole('INSTRUCTOR')}
              label="Instructor"
              detail="Build courses, configure stakes and rewards, and track learner outcomes."
            />
          </div>
          <p className="flex items-start gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
            <MaterialIcon name="shield" className="mt-0.5 text-[13px]" />
            Administrator accounts are never self-assignable — the server only honours a learner or instructor request here.
          </p>
        </div>

        {role === 'INSTRUCTOR' ? (
          <Input
            label="Headline (optional)"
            icon="badge"
            maxLength={160}
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            placeholder="Distributed systems engineer · Ex-Principal Engineer"
          />
        ) : null}

        <Button type="submit" block size="lg" iconRight="arrow_forward" loading={submitting}>
          Create account
        </Button>
      </form>

      <p className="text-center font-body-sm text-body-sm text-on-surface-variant">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
