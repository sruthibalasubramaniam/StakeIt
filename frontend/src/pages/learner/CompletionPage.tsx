import { Link, useParams } from 'react-router-dom';
import { enrollmentApi, learningApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button } from '../../components/ui/core';
import { ErrorBlock, LoadingBlock } from '../../components/ui/data';
import { SettlementReceipt } from '../../components/domain/SettlementReceipt';

/**
 * Completion receipt.
 *
 * The settlement is produced by the backend when the final test passes; this
 * page only renders it. Requesting it again never re-credits points (the
 * service is idempotent), so refreshing is always safe.
 */
export function CompletionPage() {
  const { enrollmentId = '' } = useParams<{ enrollmentId: string }>();
  useDocumentTitle('Completion receipt');

  const entry = useAsync(() => enrollmentApi.detail(enrollmentId), [enrollmentId]);
  const attemptId = entry.data?.attemptId ?? '';
  const isCompleted = entry.data?.redirectToCompletion || entry.data?.attemptStatus === 'COMPLETED';

  const settlement = useAsync(() => learningApi.settlement(attemptId), [attemptId], {
    enabled: Boolean(attemptId && isCompleted),
  });

  if (entry.loading) return <LoadingBlock label="Loading your receipt…" rows={5} />;
  if (entry.error || !entry.data) {
    return <ErrorBlock title="Could not load this enrolment" message={entry.error} onRetry={() => void entry.refetch()} />;
  }

  if (!isCompleted) {
    return (
      <div className="flex flex-col gap-space-md">
        <ErrorBlock
          title="This course is not complete yet"
          message={`Your attempt is currently ${entry.data.attemptStatus.toLowerCase().replace('_', ' ')}. A settlement receipt is only issued after the final assessment is passed.`}
        />
        <Link to={`/learn/${enrollmentId}`} className="w-fit">
          <Button variant="secondary" icon="arrow_back">
            Back to course
          </Button>
        </Link>
      </div>
    );
  }

  if (settlement.loading) return <LoadingBlock label="Reconciling settlement…" rows={5} />;
  if (settlement.error || !settlement.data) {
    return (
      <ErrorBlock
        title="Could not load the settlement"
        message={settlement.error}
        onRetry={() => void settlement.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-space-lg pb-space-xl">
      <SettlementReceipt settlement={settlement.data} />
    </div>
  );
}
