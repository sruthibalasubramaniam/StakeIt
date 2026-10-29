import { useEffect, useState } from 'react';
import { certificateApi } from '../../services/endpoints';
import { errorMessage } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { Button, Divider, MaterialIcon } from '../ui/core';
import { Card, CardHeader } from '../ui/data';
import { formatDate } from '../../utils/format';
import type { CertificateView } from '../../types/api';

/**
 * Certificate panel for a completed course.
 *
 * Rendering nothing until the attempt is complete is deliberate: the backend
 * refuses to issue before then, so showing a disabled panel earlier would just
 * advertise a door that does not open.
 */
export function CertificateCard({ attemptId, completed }: { attemptId: string; completed: boolean }) {
  const toast = useToast();
  const [certificate, setCertificate] = useState<CertificateView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!completed) return;
    let cancelled = false;
    setLoading(true);
    certificateApi
      .forAttempt(attemptId)
      .then((result) => {
        if (!cancelled) setCertificate(result.certificate ?? null);
      })
      .catch(() => {
        /* No certificate yet is a normal state, not an error worth surfacing. */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId, completed]);

  if (!completed) return null;

  const download = async () => {
    setBusy(true);
    try {
      const issued = certificate ?? (await certificateApi.issue(attemptId)).certificate;
      setCertificate(issued);

      const blob = await certificateApi.download(attemptId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${issued.code}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast.success('Certificate downloaded', issued.code);
    } catch (caught) {
      toast.error('Could not download the certificate', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Certificate" />
      <Divider />
      <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
        {loading ? (
          <span className="font-body-md text-body-md text-on-surface-variant">Checking…</span>
        ) : certificate ? (
          <>
            <div className="flex items-center gap-space-sm">
              <MaterialIcon name="workspace_premium" className="text-primary" />
              <span className="font-body-md text-body-md text-on-surface">
                {certificate.revokedAt ? 'Certificate revoked' : 'Certificate available'}
              </span>
            </div>
            <span className="metric font-label-xs text-label-xs text-on-surface-variant">{certificate.code}</span>
            <span className="font-label-xs text-label-xs text-on-surface-variant">
              Issued {formatDate(certificate.issuedAt)} · {certificate.issuer}
            </span>
          </>
        ) : (
          <span className="font-body-md text-body-md text-on-surface-variant">
            Course complete — your certificate is ready to be issued.
          </span>
        )}

        <Button
          size="sm"
          variant="primary"
          icon="download"
          loading={busy}
          disabled={Boolean(certificate?.revokedAt)}
          onClick={() => void download()}
        >
          {certificate ? 'Download PDF' : 'Get certificate'}
        </Button>

        {certificate ? (
          <a
            href={certificate.verifyUrl}
            target="_blank"
            rel="noreferrer"
            className="font-label-xs text-label-xs text-primary underline"
          >
            Verification link
          </a>
        ) : null}
      </div>
    </Card>
  );
}
