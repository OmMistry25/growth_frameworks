import type {
  SignalObservation,
  SignalState,
  SignalStateStore,
  SignalTransition,
} from "@growth-frameworks/contracts/competitive-footprint";

export class InMemorySignalStateStore implements SignalStateStore {
  readonly #states = new Map<string, SignalState>();
  readonly #operationKeys = new Set<string>();
  readonly #transitions: SignalTransition[] = [];

  constructor(initialStates: readonly SignalState[] = []) {
    for (const state of initialStates) this.#states.set(stateKey(state.accountId, state.detectorId), state);
  }

  async get(accountId: string, detectorId: string): Promise<SignalState | null> {
    return this.#states.get(stateKey(accountId, detectorId)) ?? null;
  }

  async record(
    observation: SignalObservation,
    next: SignalState,
    transition: SignalTransition | null,
  ): Promise<"created" | "duplicate"> {
    const operationKey = operationIdentity(observation);
    if (this.#operationKeys.has(operationKey)) return "duplicate";
    assertRecordIdentity(observation, next, transition);

    this.#operationKeys.add(operationKey);
    this.#states.set(stateKey(next.accountId, next.detectorId), next);
    if (transition !== null) this.#transitions.push(transition);
    return "created";
  }

  listTransitions(): readonly SignalTransition[] {
    return [...this.#transitions];
  }
}

function stateKey(accountId: string, detectorId: string): string {
  return `${accountId}\u0000${detectorId}`;
}

function operationIdentity(observation: SignalObservation): string {
  return `${stateKey(observation.accountId, observation.detectorId)}\u0000${observation.observedAt}\u0000${observation.fingerprint}`;
}

function assertRecordIdentity(
  observation: SignalObservation,
  next: SignalState,
  transition: SignalTransition | null,
): void {
  if (observation.accountId !== next.accountId || observation.detectorId !== next.detectorId) {
    throw new Error("Stored state identity does not match observation identity");
  }
  if (
    transition !== null &&
    (transition.accountId !== observation.accountId || transition.detectorId !== observation.detectorId)
  ) {
    throw new Error("Transition identity does not match observation identity");
  }
}
