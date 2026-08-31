/**
 * Applies an exponential moving average to values shown in the debug console.
 * Zero deliberately leaves the service values untouched. Non-zero values
 * use the same target-weight convention as the backend EMA helpers.
 */
export function smoothDisplayValues(values: number[], alpha: number): number[] {
  if (alpha <= 0 || values.length < 2) return values;

  const smoothed: number[] = [];
  let previous: number | undefined;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      smoothed.push(value);
      continue;
    }

    const next = previous === undefined ? value : alpha * value + (1 - alpha) * previous;
    smoothed.push(next);
    previous = next;
  }

  return smoothed;
}

export function displaySmoothingAlpha(input: string): number {
  const value = Number.parseFloat(input);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
