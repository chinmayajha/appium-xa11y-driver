interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (e: Error) => void;
}

/** Requests that wait for their replies on one socket, by serial number. */
export class Replies<T> {
  private pending = new Map<number, Waiter<T>>();

  constructor(private timeoutMs: number) {}

  wait(serial: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new Error(`${what} timed out`));
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(serial, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  /** Hands the outcome to the request with this serial; false when none waits for it. */
  settle(serial: number, outcome: { value: T } | { error: Error }): boolean {
    const waiter = this.pending.get(serial);
    if (!waiter) {
      return false;
    }
    this.pending.delete(serial);
    if ('error' in outcome) {
      waiter.reject(outcome.error);
    } else {
      waiter.resolve(outcome.value);
    }
    return true;
  }

  failAll(e: Error): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(e);
    }
    this.pending.clear();
  }
}
