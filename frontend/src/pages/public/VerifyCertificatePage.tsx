import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { certificateApi } from '../../services/endpoints';
import { errorMessage } from '../../services/api';
import { useDocumentTitle } from '../../hooks';
import { Button, MaterialIcon, Spinner } from '../../components/ui/core';
import { Alert, Card } from '../../components/ui/data';
import { Input } from '../../components/ui/forms';
import { formatDate } from '../../utils/format';
import type { CertificateVerification } from '../../types/api';

/**
 * Public certificate verification.
 *
 * Reachable without an account — that is the entire point of a verification
 * code — so it shows only what is printed on the certificate itself: name,
 * course, issuer, dates and revocation status. No email, no user id.
 */
export function VerifyCertificatePage() {
  const { code } = useParams<{ code?: string }>();
  const [input, setInput] = useState(code ?? '');
  const [result, setResult] = useState<CertificateVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useDocumentTitle('Verify a certificate');

  const lookup = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await certificateApi.verify(trimmed));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) void lookup(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-space-lg px-space-md py-space-xl">
      <header className="flex flex-col gap-space-xs">
        <span className="micro-label text-on-surface-variant">Stake It</span>
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Verify a certificate</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Enter the code printed on the certificate (for example <code>SI-2026-4F2C9A</code>).
        </p>
      </header>

      <Card>
        <form
          className="flex flex-col gap-space-sm p-space-lg sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void lookup(input);
          }}
        >
          <div className="flex-1">
            <Input
              label="Certificate code"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="SI-2026-XXXXXX"
              autoComplete="off"
            />
          </div>
          <Button type="submit" loading={loading} icon="verified">
            Verify
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="flex items-center gap-space-sm px-space-lg text-on-surface-variant">
          <Spinner /> Checking…
        </div>
      ) : null}

      {error ? <Alert tone="error" title="Could not verify">{error}</Alert> : null}

      {result && !result.valid && !result.learnerName ? (
        <Alert tone="warning" title="No certificate found">
          We could not find a certificate with the code <strong>{result.code}</strong>.
        </Alert>
      ) : null}

      {result && result.learnerName ? (
        <Card>
          <div className="flex flex-col gap-space-md p-space-lg">
            <div className="flex items-center gap-space-sm">
              <MaterialIcon
                name={result.valid ? 'verified' : 'gpp_bad'}
                className={result.valid ? 'text-primary' : 'text-error'}
              />
              <span className="font-title-md text-title-md text-on-surface">
                {result.valid ? 'Valid certificate' : 'Revoked certificate'}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
              <div>
                <dt className="font-label-xs text-label-xs text-on-surface-variant">Learner</dt>
                <dd className="font-body-md text-body-md text-on-surface">{result.learnerName}</dd>
              </div>
              <div>
                <dt className="font-label-xs text-label-xs text-on-surface-variant">Course</dt>
                <dd className="font-body-md text-body-md text-on-surface">{result.courseTitle}</dd>
              </div>
              <div>
                <dt className="font-label-xs text-label-xs text-on-surface-variant">Completed</dt>
                <dd className="font-body-md text-body-md text-on-surface">
                  {result.completionDate ? formatDate(result.completionDate) : '—'}
                </dd>
              </div>
              <div>
                <dt className="font-label-xs text-label-xs text-on-surface-variant">Issued by</dt>
                <dd className="font-body-md text-body-md text-on-surface">{result.issuer}</dd>
              </div>
              <div>
                <dt className="font-label-xs text-label-xs text-on-surface-variant">Certificate</dt>
                <dd className="metric font-body-md text-body-md text-on-surface">{result.code}</dd>
              </div>
            </dl>

            {result.revoked ? (
              <Alert tone="error" title="Revoked">
                {result.revokedReason ?? 'This certificate was revoked by the issuer.'}
              </Alert>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Link to="/" className="font-label-sm text-label-sm text-primary underline">
        Back to Stake It
      </Link>
    </div>
  );
}
