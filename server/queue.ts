// queue.ts — a first-come, first-served line for the shared free model.
//
// The free Gemini tier allows only a few requests per minute for the whole site.
// Instead of failing when visitors arrive together, model calls wait their turn:
// at most PER_MINUTE calls start in any rolling minute. Each browser tab sends a
// random ticket id, so the page can ask "where am I in line, and how long?".
// Ticket ids are random per tab and hold no personal data; nothing is stored.

type Waiter = { ticket: string; since: number; start: () => void; cancel: (err: Error) => void };

export class ModelQueue {
  private started: number[] = []; // start times within the last window
  private line: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private perMinute = Number(process.env.DESK_RPM || 14),
    private maxWaitMs = 240_000,
    private maxLine = 200,
    private windowMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.started.length && this.started[0] <= cutoff) this.started.shift();
  }

  /** Milliseconds until the n-th waiter (1-based) can start, if nobody else joins ahead. */
  private etaFor(position: number): number {
    this.prune();
    const free = this.perMinute - this.started.length;
    if (position <= free) return 0;
    const k = position - free - 1; // which future slot this position takes
    if (k < this.started.length) return Math.max(0, this.started[k] + this.windowMs - this.now());
    // Further back than one window: each full window adds another minute.
    const rounds = Math.floor(k / this.perMinute);
    const base = this.started[k % this.perMinute] ?? this.now();
    return Math.max(0, base + this.windowMs * (rounds + 1) - this.now());
  }

  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.prune();
    while (this.line.length && this.started.length < this.perMinute) {
      const w = this.line.shift()!;
      this.started.push(this.now());
      w.start();
    }
    if (this.line.length) {
      const wait = Math.max(50, this.started[0] + this.windowMs - this.now());
      this.timer = setTimeout(() => this.pump(), wait);
      this.timer.unref?.();
    }
  }

  /** Waits for a turn. Rejects with a clear message if the line is too long. */
  acquire(ticket = ""): Promise<void> {
    const position = this.line.length + 1;
    if (this.line.length >= this.maxLine || this.etaFor(position) > this.maxWaitMs) {
      return Promise.reject(new Error("The line for the free model is too long right now. Try again in a few minutes, or add your own key in AI model settings (the gear icon)."));
    }
    return new Promise<void>((start, cancel) => {
      this.line.push({ ticket, since: this.now(), start, cancel });
      this.pump();
    });
  }

  /** Line status, for everyone and for one tab's ticket. Positions are 1-based; 0 = not waiting. */
  status(ticket = ""): { waiting: number; position: number; eta_seconds: number; per_minute: number } {
    const idx = ticket ? this.line.findIndex((w) => w.ticket === ticket) : -1;
    const position = idx >= 0 ? idx + 1 : 0;
    return {
      waiting: this.line.length,
      position,
      eta_seconds: Math.ceil(this.etaFor(position || this.line.length + 1) / 1000),
      per_minute: this.perMinute,
    };
  }
}
