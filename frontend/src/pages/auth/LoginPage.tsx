import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Divider } from '../../components/ui/core';
import { Alert } from '../../components/ui/data';
import { Input } from '../../components/ui/forms';
import { useAuth } from '../../context/AuthContext';
import { useDocumentTitle } from '../../hooks';
import { errorMessage } from '../../services/api';
import { homePathFor, isPathAllowedForRole, pathnameOf } from '../../router/routeAccess';

interface LocationState {
  from?: string;
}

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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(email, password);
      /*
       * Honour the route the user was originally trying to reach, but only if
       * the role that just signed in can actually open it. The guard captures
       * `from` on every unauthenticated hit — including the redirect that
       * follows a sign-out — so without this check, signing in as a different
       * role landed on the previous role's page and rendered "Back to safety".
       */
      const requested = state?.from;
      const destination =
        requested && isPathAllowedForRole(pathnameOf(requested), user.role) ? requested : homePathFor(user.role);
      navigate(destination, { replace: true });
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

      <form className="flex flex-col gap-space-md" onSubmit={(event) => void submit(event)}>
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
