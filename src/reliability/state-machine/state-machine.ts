/**
 * Generic FSM — reusable state machine for sessions, tasks, workflows (PRD §5.6.1).
 */

export type TransitionGuard<S extends string, E extends string, C> = (
  from: S,
  event: E,
  context: C,
) => boolean;

export type TransitionAction<S extends string, E extends string, C> = (
  from: S,
  to: S,
  event: E,
  context: C,
) => void | Promise<void>;

export interface StateTransitionDef<S extends string, E extends string> {
  from: S;
  event: E;
  to: S;
}

export interface StateMachineDefinition<S extends string, E extends string, C = unknown> {
  initialState: S;
  terminalStates: S[];
  transitions: StateTransitionDef<S, E>[];
  guards?: Map<string, TransitionGuard<S, E, C>>;
  actions?: Map<string, TransitionAction<S, E, C>>;
}

export class StateMachine<S extends string, E extends string, C = unknown> {
  private _state: S;
  private _context: C;
  private readonly _def: StateMachineDefinition<S, E, C>;
  private readonly _history: Array<{ from: S; to: S; event: E; timestamp: Date }> = [];

  constructor(def: StateMachineDefinition<S, E, C>, context: C) {
    this._def = def;
    this._state = def.initialState;
    this._context = context;
  }

  get currentState(): S {
    return this._state;
  }

  get context(): C {
    return this._context;
  }

  get isTerminal(): boolean {
    return this._def.terminalStates.includes(this._state);
  }

  get history(): ReadonlyArray<{ from: S; to: S; event: E; timestamp: Date }> {
    return this._history;
  }

  canHandle(event: E): boolean {
    return this._def.transitions.some(
      (t) => t.from === this._state && t.event === event,
    );
  }

  availableEvents(): E[] {
    return this._def.transitions
      .filter((t) => t.from === this._state)
      .map((t) => t.event);
  }

  async send(event: E): Promise<S> {
    const transition = this._def.transitions.find(
      (t) => t.from === this._state && t.event === event,
    );
    if (!transition) {
      throw new Error(
        `No transition from "${this._state}" on event "${event}". Available: [${this.availableEvents().join(", ")}]`,
      );
    }

    const guardKey = `${transition.from}:${transition.event}`;
    const guard = this._def.guards?.get(guardKey);
    if (guard && !guard(this._state, event, this._context)) {
      throw new Error(`Guard rejected transition from "${this._state}" on "${event}"`);
    }

    const from = this._state;
    this._state = transition.to;
    this._history.push({ from, to: transition.to, event, timestamp: new Date() });

    const actionKey = `${from}:${transition.to}`;
    const action = this._def.actions?.get(actionKey);
    if (action) {
      await action(from, transition.to, event, this._context);
    }

    return this._state;
  }

  serialize(): { state: S; history: Array<{ from: S; to: S; event: E; timestamp: Date }> } {
    return { state: this._state, history: [...this._history] };
  }
}
