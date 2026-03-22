/**
 * TimeoutManager — per-operation timeout enforcement (PRD §5.6).
 */

export interface TimeoutManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  register(entry: TimeoutEntry): string;
  cancel(timeoutId: string): boolean;
  extend(timeoutId: string, additionalMs: number): boolean;
  getActive(): TimeoutEntry[];
}

export interface TimeoutEntry {
  id?: string;
  name: string;
  durationMs: number;
  onTimeout: () => void | Promise<void>;
  createdAt?: Date;
}
