/** Last-write-wins: accept when nothing exists or incoming is strictly newer (tie keeps existing). */
export function shouldAccept(
  incoming: { updatedAt: number },
  existing?: { updatedAt: number },
): boolean {
  return !existing || incoming.updatedAt > existing.updatedAt;
}
