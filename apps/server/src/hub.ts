export class Hub {
  private subs = new Set<(rev: number) => void>();

  subscribe(send: (rev: number) => void): () => void {
    this.subs.add(send);
    return () => {
      this.subs.delete(send);
    };
  }

  publish(rev: number): void {
    for (const send of [...this.subs]) {
      try {
        send(rev);
      } catch {
        // a broken subscriber must not affect the others
      }
    }
  }

  size(): number {
    return this.subs.size;
  }
}
