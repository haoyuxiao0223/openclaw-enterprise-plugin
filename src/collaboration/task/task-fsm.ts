/**
 * Task FSM — enforces legal state transitions (PRD §5.3.1).
 *
 * Legal transition table:
 *   pending   → queued, killed
 *   queued    → running, killed
 *   running   → completed, failed, paused, killed, timeout
 *   paused    → running, killed
 *   failed    → queued (retry)
 *   timeout   → queued (retry)
 *   completed → (terminal)
 *   killed    → (terminal)
 */

import type { TaskState, TaskStateTransition } from "./task-types.ts";

export type TaskEvent =
  | "enqueue"
  | "start"
  | "complete"
  | "fail"
  | "pause"
  | "resume"
  | "kill"
  | "timeout_trigger"
  | "retry";

const TRANSITION_TABLE: Record<TaskState, Partial<Record<TaskEvent, TaskState>>> = {
  pending: { enqueue: "queued", kill: "killed" },
  queued: { start: "running", kill: "killed" },
  running: {
    complete: "completed",
    fail: "failed",
    pause: "paused",
    kill: "killed",
    timeout_trigger: "timeout",
  },
  paused: { resume: "running", kill: "killed" },
  failed: { retry: "queued" },
  timeout: { retry: "queued" },
  completed: {},
  killed: {},
};

const TERMINAL_STATES: Set<TaskState> = new Set(["completed", "killed"]);

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly fromState: TaskState,
    public readonly event: TaskEvent,
    public readonly availableEvents: TaskEvent[],
  ) {
    const available = availableEvents.length > 0 ? availableEvents.join(", ") : "none";
    super(
      `Cannot handle event "${event}" in state "${fromState}". Available events: [${available}]`,
    );
    this.name = "IllegalStateTransitionError";
  }
}

export class TaskFSM {
  private _state: TaskState;
  private _history: TaskStateTransition[] = [];

  constructor(initialState: TaskState = "pending", history?: TaskStateTransition[]) {
    this._state = initialState;
    if (history) this._history = [...history];
  }

  get currentState(): TaskState {
    return this._state;
  }

  get history(): ReadonlyArray<TaskStateTransition> {
    return this._history;
  }

  get isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  canTransition(event: TaskEvent): boolean {
    return TRANSITION_TABLE[this._state]?.[event] !== undefined;
  }

  availableEvents(): TaskEvent[] {
    const transitions = TRANSITION_TABLE[this._state];
    return transitions ? (Object.keys(transitions) as TaskEvent[]) : [];
  }

  transition(event: TaskEvent, actor: string, reason?: string): TaskState {
    const nextState = TRANSITION_TABLE[this._state]?.[event];
    if (nextState === undefined) {
      throw new IllegalStateTransitionError(
        this._state,
        event,
        this.availableEvents(),
      );
    }

    const transition: TaskStateTransition = {
      from: this._state,
      to: nextState,
      reason: reason ?? event,
      timestamp: new Date(),
      actor,
    };

    this._history.push(transition);
    this._state = nextState;
    return nextState;
  }

  serialize(): { state: TaskState; history: TaskStateTransition[] } {
    return { state: this._state, history: [...this._history] };
  }

  static restore(snapshot: { state: TaskState; history: TaskStateTransition[] }): TaskFSM {
    return new TaskFSM(snapshot.state, snapshot.history);
  }
}
