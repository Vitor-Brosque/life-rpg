/**
 * Tab pattern keys: arrows move (wrapping), Home and End jump to the ends.
 * Returns the index to select, or -1 when the key is not one of them.
 */
export function tabKeyTarget(key: string, index: number, count: number): number {
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}
