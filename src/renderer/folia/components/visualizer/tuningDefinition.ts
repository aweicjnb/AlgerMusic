/** A stored or patched value as a number between `min` and `max`: what is no finite number is the fallback. */
export const numberWithin = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);
