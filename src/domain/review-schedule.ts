const FULL_REVIEW_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;

export function isFullReviewDue(
  lastSuccessfulSyncAt: string | null,
  now = new Date(),
): boolean {
  if (lastSuccessfulSyncAt === null) return false;
  const completedAt = Date.parse(lastSuccessfulSyncAt);
  if (!Number.isFinite(completedAt)) return false;
  return now.valueOf() - completedAt >= FULL_REVIEW_INTERVAL_MS;
}
