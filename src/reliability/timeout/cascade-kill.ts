export interface CascadeHandle {
  cancel(): void;
}

type Timer = ReturnType<typeof setTimeout>;

type Callbacks = {
  onSignal: () => void;
  onAbort: () => void;
  onKill: () => void;
};

export class CascadeKillManager {
  constructor(
    private readonly config: {
      signalDelayMs: number;
      abortDelayMs: number;
      killDelayMs: number;
    },
  ) {}

  private readonly callbacks = new Map<string, Callbacks>();
  private readonly signalTimers = new Map<string, Timer>();
  private readonly abortTimers = new Map<string, Timer>();
  private readonly killTimers = new Map<string, Timer>();

  private clearTimers(taskId: string): void {
    const s = this.signalTimers.get(taskId);
    const a = this.abortTimers.get(taskId);
    const k = this.killTimers.get(taskId);
    if (s !== undefined) clearTimeout(s);
    if (a !== undefined) clearTimeout(a);
    if (k !== undefined) clearTimeout(k);
    this.signalTimers.delete(taskId);
    this.abortTimers.delete(taskId);
    this.killTimers.delete(taskId);
  }

  register(
    taskId: string,
    onSignal: () => void,
    onAbort: () => void,
    onKill: () => void,
  ): CascadeHandle {
    this.callbacks.set(taskId, { onSignal, onAbort, onKill });
    return {
      cancel: () => {
        this.clearTimers(taskId);
        this.callbacks.delete(taskId);
      },
    };
  }

  trigger(taskId: string): void {
    const cb = this.callbacks.get(taskId);
    if (!cb) return;
    this.clearTimers(taskId);
    const { signalDelayMs, abortDelayMs, killDelayMs } = this.config;
    const signalTimer = setTimeout(() => {
      cb.onSignal();
      const abortTimer = setTimeout(() => {
        cb.onAbort();
        const killTimer = setTimeout(() => {
          cb.onKill();
          this.clearTimers(taskId);
          this.callbacks.delete(taskId);
        }, killDelayMs);
        this.killTimers.set(taskId, killTimer);
      }, abortDelayMs);
      this.abortTimers.set(taskId, abortTimer);
    }, signalDelayMs);
    this.signalTimers.set(taskId, signalTimer);
  }
}
