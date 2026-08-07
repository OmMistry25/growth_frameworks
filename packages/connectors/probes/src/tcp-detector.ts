import { createHash } from "node:crypto";

import {
  confidenceLevels,
  ContractValidationError,
  type Confidence,
  type SignalDetector,
  type SignalObservation,
} from "@growth-frameworks/contracts/competitive-footprint";

export interface TcpProbeRequest {
  readonly hostname: string;
  readonly port: number;
  readonly tls: boolean;
  readonly timeoutMs: number;
}

export type TcpProbeResult =
  | { readonly status: "connected"; readonly family: 4 | 6 }
  | { readonly status: "timeout" | "refused" | "unreachable" | "tls_error" };

export interface TcpProbeClientPort {
  probe(request: TcpProbeRequest): Promise<TcpProbeResult>;
}

export interface TcpProbeRule {
  readonly hostnameTemplate: string;
  readonly port: number;
  readonly tls: boolean;
  readonly evidenceCode: string;
  readonly confidence: Confidence;
}

export interface TcpDetectorConfig {
  readonly id: string;
  readonly rules: readonly TcpProbeRule[];
  readonly timeoutMs: number;
  readonly negativeEvidenceCode: string;
  readonly timeoutEvidenceCode: string;
  readonly negativeConfidence: Confidence;
}

export class TcpSignalDetector implements SignalDetector {
  readonly id: string;
  readonly kind = "tcp" as const;
  readonly #config: TcpDetectorConfig;
  readonly #client: TcpProbeClientPort;

  constructor(configInput: TcpDetectorConfig, client: TcpProbeClientPort) {
    this.#config = validateTcpDetectorConfig(configInput);
    this.id = this.#config.id;
    this.#client = client;
  }

  async observe(
    account: Parameters<SignalDetector["observe"]>[0],
    context: Parameters<SignalDetector["observe"]>[1],
  ): Promise<SignalObservation> {
    const matches: Array<{ readonly evidenceCode: string; readonly confidence: Confidence }> = [];
    let timedOut = false;
    let concluded = 0;

    for (const rule of this.#config.rules) {
      const result = await this.#client.probe({
        hostname: renderHostname(rule.hostnameTemplate, account.domain),
        port: rule.port,
        tls: rule.tls,
        timeoutMs: this.#config.timeoutMs,
      });
      if (result.status === "timeout") {
        timedOut = true;
        continue;
      }
      concluded += 1;
      if (result.status === "connected") {
        matches.push({ evidenceCode: rule.evidenceCode, confidence: rule.confidence });
      }
    }

    if (matches.length > 0) {
      const evidenceCodes = [...new Set(matches.map(({ evidenceCode }) => evidenceCode))].sort();
      return observation(
        account.id,
        this.id,
        context.startedAt,
        "positive",
        highestConfidence(matches.map(({ confidence }) => confidence)),
        evidenceCodes,
        { rulesChecked: this.#config.rules.length, rulesMatched: matches.length },
      );
    }
    if (timedOut || concluded === 0) {
      return observation(
        account.id,
        this.id,
        context.startedAt,
        "indeterminate",
        "low",
        [this.#config.timeoutEvidenceCode],
        { rulesChecked: this.#config.rules.length, rulesConcluded: concluded },
      );
    }
    return observation(
      account.id,
      this.id,
      context.startedAt,
      "negative",
      this.#config.negativeConfidence,
      [this.#config.negativeEvidenceCode],
      { rulesChecked: this.#config.rules.length, rulesConcluded: concluded },
    );
  }
}

export function validateTcpDetectorConfig(input: TcpDetectorConfig): TcpDetectorConfig {
  const issues: string[] = [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.id)) issues.push("TCP detector id is invalid");
  if (input.rules.length === 0 || input.rules.length > 20) issues.push("TCP detector requires between 1 and 20 rules");
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30_000) issues.push("TCP timeout is invalid");
  if (!isEvidenceCode(input.negativeEvidenceCode)) issues.push("TCP negative evidence code is invalid");
  if (!isEvidenceCode(input.timeoutEvidenceCode)) issues.push("TCP timeout evidence code is invalid");
  if (!confidenceLevels.includes(input.negativeConfidence)) issues.push("TCP negative confidence is invalid");

  for (const [index, rule] of input.rules.entries()) {
    if (!isHostnameTemplate(rule.hostnameTemplate)) issues.push(`TCP rule ${index} hostname template is invalid`);
    if (!Number.isInteger(rule.port) || rule.port < 1 || rule.port > 65_535) issues.push(`TCP rule ${index} port is invalid`);
    if (typeof rule.tls !== "boolean") issues.push(`TCP rule ${index} TLS setting is invalid`);
    if (!isEvidenceCode(rule.evidenceCode)) issues.push(`TCP rule ${index} evidence code is invalid`);
    if (!confidenceLevels.includes(rule.confidence)) issues.push(`TCP rule ${index} confidence is invalid`);
  }
  if (issues.length > 0) throw new ContractValidationError(issues);
  return input;
}

function observation(
  accountId: string,
  detectorId: string,
  observedAt: string,
  status: SignalObservation["status"],
  confidence: Confidence,
  evidenceCodes: readonly string[],
  metadata: Readonly<Record<string, number>>,
): SignalObservation {
  return {
    accountId,
    detectorId,
    detectorKind: "tcp",
    observedAt,
    status,
    confidence,
    evidenceCodes,
    fingerprint: createHash("sha256").update(JSON.stringify([status, ...evidenceCodes])).digest("hex"),
    metadata,
  };
}

function renderHostname(template: string, domain: string): string {
  return template.replace("{domain}", domain).toLowerCase();
}

function highestConfidence(values: readonly Confidence[]): Confidence {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  return "low";
}

function isEvidenceCode(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

function isHostnameTemplate(value: string): boolean {
  if (!value.endsWith("{domain}") || value.match(/\{domain\}/g)?.length !== 1) return false;
  const prefix = value.slice(0, -"{domain}".length);
  if (prefix.length === 0) return true;
  return prefix.endsWith(".") && prefix.slice(0, -1).split(".").every((label) => /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/.test(label));
}
