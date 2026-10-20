// Fixed demo time: 2026-10-18T10:00:00+07:00
export const INITIAL_DEMO_NOW = '2026-10-18T10:00:00+07:00';

class DemoClock {
  private currentIso: string = INITIAL_DEMO_NOW;
  private listeners: Set<(now: string) => void> = new Set();

  public now(): string {
    return this.currentIso;
  }

  public nowDate(): Date {
    return new Date(this.currentIso);
  }

  public setNow(isoString: string): void {
    this.currentIso = isoString;
    this.notify();
  }

  public advanceHours(hours: number): void {
    const d = new Date(this.currentIso);
    d.setHours(d.getHours() + hours);
    this.currentIso = d.toISOString();
    this.notify();
  }

  public advanceDays(days: number): void {
    const d = new Date(this.currentIso);
    d.setDate(d.getDate() + days);
    this.currentIso = d.toISOString();
    this.notify();
  }

  public reset(): void {
    this.currentIso = INITIAL_DEMO_NOW;
    this.notify();
  }

  public subscribe(listener: (now: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this.currentIso));
  }
}

export const demoClock = new DemoClock();
