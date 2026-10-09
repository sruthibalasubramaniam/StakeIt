import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Divider, MaterialIcon } from '../../components/ui/core';
import { Alert } from '../../components/ui/data';
import { Input } from '../../components/ui/forms';
import { useAuth } from '../../context/AuthContext';
import { useDocumentTitle } from '../../hooks';
import { errorMessage } from '../../services/api';
import { homePathFor } from '../../layouts/AppShell';

interface LocationState {
  from?: string;
}

const DEMO_ACCOUNTS = [
  { label: 'Learner', email: 'learner@stakeit.demo' },
  { label: 'Instructor', email: 'instructor@stakeit.demo' },
  { label: 'Admin', email: 'admin@stakeit.demo' },
];

const DEMO_PASSWORD = 'Password123';
const demoLoginEnabled = import.meta.env.VITE_ENABLE_DEMO_LOGIN !== 'false';

export function LoginPage() {
  useDocumentTitle('Sign in');

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (loginEmail: string, loginPassword: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(loginEmail, loginPassword);
      // Honour the route the user was originally trying to reach.
      navigate(state?.from ?? homePathFor(user.role), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="surface-card flex flex-col gap-space-lg px-space-lg py-space-lg">
      <div className="flex flex-col gap-space-xs">
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Sign in</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Stake platform points on structured courses and earn them back through verified completion.
        </p>
      </div>

      {state?.from ? (
        <Alert tone="info" icon="lock">
          Sign in to continue to <span className="font-mono text-on-surface">{state.from}</span>.
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="error" title="Could not sign in">
          {error}
        </Alert>
      ) : null}

      <form
        className="flex flex-col gap-space-md"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(email, password);
        }}
      >
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
        />

        <Button type="submit" block size="lg" iconRight="arrow_forward" loading={submitting}>
          Sign in
        </Button>
      </form>

      {demoLoginEnabled ? (
        <>
          <div className="flex items-center gap-space-md">
            <Divider className="flex-1" />
            <span className="micro-label text-on-surface-variant">Demo accounts</span>
            <Divider className="flex-1" />
          </div>

          <div className="flex flex-col gap-space-sm">
            <div className="grid grid-cols-3 gap-space-sm">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.email}
                  size="sm"
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => void submit(account.email, DEMO_PASSWORD)}
                >
                  {account.label}
                </Button>
              ))}
            </div>
            <p className="flex items-start gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
              <MaterialIcon name="info" className="mt-0.5 text-[13px]" />
              Seeded demo data. Password for every account is <span className="font-mono">{DEMO_PASSWORD}</span>. These accounts
              only exist after <span className="font-mono">npm run db:seed</span>.
            </p>
          </div>
        </>
      ) : null}

      <Divider />

      <p className="text-center font-body-sm text-body-sm text-on-surface-variant">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
