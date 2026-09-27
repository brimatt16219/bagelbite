/** Injected time source — lets tests move across days for FSRS scheduling and mastery. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-09-01T09:00:00Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  set(date: Date | string): void {
    this.current = new Date(date)
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000)
  }
}
