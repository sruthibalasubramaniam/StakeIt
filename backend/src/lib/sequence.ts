/**
 * Strict sequential unlocking.
 *
 * The whole platform hinges on this: content unlocks only when every required
 * item before it has been completed. These helpers are pure so the rule can be
 * exhaustively unit tested and reused by both the learning service and the
 * frontend contract tests.
 */

export interface SequenceEntry {
  id: string;
  isRequired: boolean;
}

export interface UnlockResult {
  /** Ids of every currently accessible item. */
  unlocked: Set<string>;
  /** The first not-yet-completed required item — where "Resume" points. */
  firstIncompleteId: string | null;
  /** Every required id in order, regardless of state. */
  requiredOrder: string[];
}

/**
 * Walks the ordered list and unlocks an item only when all preceding
 * *required* items are complete. Optional items never block progress.
 */
export function computeUnlocks(orderedItems: SequenceEntry[], completedIds: Iterable<string>): UnlockResult {
  const completed = new Set(completedIds);
  const unlocked = new Set<string>();
  const requiredOrder: string[] = [];
  let firstIncompleteId: string | null = null;
  let blocked = false;

  for (const item of orderedItems) {
    if (item.isRequired) requiredOrder.push(item.id);

    if (!blocked) {
      unlocked.add(item.id);
      if (!completed.has(item.id)) {
        if (firstIncompleteId === null) firstIncompleteId = item.id;
        // A required item that is not finished blocks everything after it.
        if (item.isRequired) blocked = true;
      }
    }
  }

  return { unlocked, firstIncompleteId, requiredOrder };
}

export function progressPercent(requiredOrder: string[], completedIds: Iterable<string>): number {
  if (requiredOrder.length === 0) return 0;
  const completed = new Set(completedIds);
  const done = requiredOrder.filter((id) => completed.has(id)).length;
  return Math.round((done / requiredOrder.length) * 1000) / 10;
}
