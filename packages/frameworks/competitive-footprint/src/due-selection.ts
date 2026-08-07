import {
  ContractValidationError,
  type Account,
  type CadenceRule,
  type SignalState,
} from "@growth-frameworks/contracts/competitive-footprint";

export interface DueSelection {
  readonly due: boolean;
  readonly dueAt: string | null;
}

export function selectDue(
  account: Account,
  state: SignalState | null,
  cadence: readonly CadenceRule[],
  now: Date,
): DueSelection {
  if (Number.isNaN(now.getTime())) throw new ContractValidationError(["current time is invalid"]);
  if (state?.lastCheckedAt === null || state === null) return { due: true, dueAt: null };

  const rule = cadence.find(
    (candidate) => candidate.segment === account.segment && candidate.state === state.state,
  );
  if (rule === undefined) {
    throw new ContractValidationError([
      `cadence rule is missing for segment ${account.segment} and state ${state.state}`,
    ]);
  }

  const lastChecked = Date.parse(state.lastCheckedAt);
  if (Number.isNaN(lastChecked)) {
    throw new ContractValidationError(["last checked time is invalid"]);
  }

  const dueAt = new Date(lastChecked + rule.intervalHours * 60 * 60 * 1_000);
  return { due: dueAt.getTime() <= now.getTime(), dueAt: dueAt.toISOString() };
}
