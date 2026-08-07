import type {
  SignalObservation,
  SignalState,
  SignalStateStore,
  SignalTransition,
  TransitionDestination,
} from "@growth-frameworks/contracts/competitive-footprint";

export class NoWriteStateStore implements SignalStateStore {
  async get(): Promise<SignalState | null> {
    return null;
  }

  async record(
    _observation: SignalObservation,
    _next: SignalState,
    _transition: SignalTransition | null,
  ): Promise<"created" | "duplicate"> {
    throw new Error("Dry run attempted to persist state");
  }
}

export class NoWriteDestination implements TransitionDestination {
  async deliver(): Promise<void> {
    throw new Error("Dry run attempted external delivery");
  }
}
