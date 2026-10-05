/** How many subscriptions "browse my subscriptions" remembers. */
export const MAX_RECENT_SUBSCRIPTIONS = 5;

/** `recent` with `subscriptionId` moved to the front, without duplicates and capped at `max`. */
export function pushRecent(recent: readonly string[], subscriptionId: string, max = MAX_RECENT_SUBSCRIPTIONS): string[] {
  return [subscriptionId, ...recent.filter((id) => id !== subscriptionId)].slice(0, max);
}

/**
 * Splits `subscriptions` into the recently used ones, most recent first, and the rest in their
 * original order. Recent ids the account no longer sees are dropped.
 */
export function splitByRecent<T extends { subscriptionId: string }>(
  subscriptions: readonly T[],
  recent: readonly string[],
): { recent: T[]; others: T[] } {
  const byId = new Map(subscriptions.map((s) => [s.subscriptionId, s]));
  const used = recent.map((id) => byId.get(id)).filter((s): s is T => s !== undefined);
  return { recent: used, others: subscriptions.filter((s) => !used.includes(s)) };
}
