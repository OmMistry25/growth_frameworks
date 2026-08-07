import type { RunResult } from "@growth-frameworks/contracts/competitive-footprint";

export interface RedactedCanaryResult {
  readonly status: RunResult["status"];
  readonly selected: number;
  readonly processed: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failureCategories: readonly string[];
  readonly detectors: readonly RedactedDetectorOutcome[];
}

export interface RedactedDetectorOutcome {
  readonly detectorId: string;
  readonly status: "completed" | "failed" | "not_completed";
  readonly category?: string;
  readonly code?: string;
  readonly retryable?: boolean;
}

export function redactCanaryResult(
  result: RunResult,
  detectorIds: readonly string[],
): RedactedCanaryResult {
  const completed = new Set(result.intents.map(({ detectorId }) => detectorId));
  const failures = new Map(
    result.failures.flatMap((failure) => {
      if (!failure.operation.startsWith("detect:")) return [];
      const detectorId = failure.operation.slice("detect:".length);
      return detectorIds.includes(detectorId) ? [[detectorId, failure] as const] : [];
    }),
  );
  return {
    status: result.status,
    selected: result.selected,
    processed: result.processed,
    changed: result.changed,
    unchanged: result.unchanged,
    skipped: result.skipped,
    failed: result.failed,
    failureCategories: [...new Set(result.failures.map(({ category }) => category))],
    detectors: detectorIds.map((detectorId) => {
      const failure = failures.get(detectorId);
      if (failure !== undefined) {
        return {
          detectorId,
          status: "failed",
          category: failure.category,
          ...(failure.failureCode === undefined ? {} : { code: failure.failureCode }),
          retryable: failure.retryable,
        };
      }
      return { detectorId, status: completed.has(detectorId) ? "completed" : "not_completed" };
    }),
  };
}
