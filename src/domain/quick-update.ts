export const DEFAULT_QUICK_STOP_THRESHOLD = 15;
export const MIN_QUICK_STOP_THRESHOLD = 3;
export const MAX_QUICK_STOP_THRESHOLD = 50;
export const MAX_QUICK_CHECKPOINTS = MAX_QUICK_STOP_THRESHOLD;

export function isQuickStopThreshold(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= MIN_QUICK_STOP_THRESHOLD &&
    value <= MAX_QUICK_STOP_THRESHOLD
  );
}

export function sanitizeQuickStopThreshold(
  value: unknown,
  fallback = DEFAULT_QUICK_STOP_THRESHOLD,
): number {
  return isQuickStopThreshold(value) ? value : fallback;
}
