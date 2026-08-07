import { createHash } from "node:crypto";

import {
  confidenceLevels,
  ContractValidationError,
  type Confidence,
  type SignalDetector,
  type SignalObservation,
} from "@growth-frameworks/contracts/competitive-footprint";

export interface HttpProbeRequest {
  readonly url: string;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly maxResponseBytes: number;
}

export type HttpProbeResult =
  | { readonly status: "responded"; readonly statusCode: number; readonly redirects: number; readonly truncated: boolean }
  | { readonly status: "timeout" | "unreachable" | "redirect_limit" };

export interface HttpProbeClientPort {
  probe(request: HttpProbeRequest): Promise<HttpProbeResult>;
}

export interface SubdomainProbeRule {
  readonly hostnameTemplate: string;
  readonly protocol: "https" | "http";
  readonly path: string;
  readonly acceptedStatusCodes: readonly number[];
  readonly evidenceCode: string;
  readonly confidence: Confidence;
}

export interface SubdomainDetectorConfig {
  readonly id: string;
  readonly rules: readonly SubdomainProbeRule[];
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly maxResponseBytes: number;
  readonly negativeEvidenceCode: string;
  readonly timeoutEvidenceCode: string;
  readonly negativeConfidence: Confidence;
}

export class SubdomainSignalDetector implements SignalDetector {
  readonly id: string;
  readonly kind = "subdomain" as const;
  readonly #config: SubdomainDetectorConfig;
  readonly #client: HttpProbeClientPort;

  constructor(configInput: SubdomainDetectorConfig, client: HttpProbeClientPort) {
    this.#config = validateSubdomainDetectorConfig(configInput);
    this.id = this.#config.id;
    this.#client = client;
  }

  async observe(
    account: Parameters<SignalDetector["observe"]>[0],
    context: Parameters<SignalDetector["observe"]>[1],
  ): Promise<SignalObservation> {
    const matches: Array<{ readonly evidenceCode: string; readonly confidence: Confidence }> = [];
    let inconclusive = false;
    let responded = 0;

    for (const rule of this.#config.rules) {
      const result = await this.#client.probe({
        url: `${rule.protocol}://${renderHostname(rule.hostnameTemplate, account.domain)}${rule.path}`,
        timeoutMs: this.#config.timeoutMs,
        maxRedirects: this.#config.maxRedirects,
        maxResponseBytes: this.#config.maxResponseBytes,
      });
      if (result.status !== "responded") {
        if (result.status === "timeout" || result.status === "redirect_limit") inconclusive = true;
        continue;
      }
      responded += 1;
      if (rule.acceptedStatusCodes.includes(result.statusCode)) {
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
    if (inconclusive || responded === 0) {
      return observation(
        account.id,
        this.id,
        context.startedAt,
        "indeterminate",
        "low",
        [this.#config.timeoutEvidenceCode],
        { rulesChecked: this.#config.rules.length, rulesResponded: responded },
      );
    }
    return observation(
      account.id,
      this.id,
      context.startedAt,
      "negative",
      this.#config.negativeConfidence,
      [this.#config.negativeEvidenceCode],
      { rulesChecked: this.#config.rules.length, rulesResponded: responded },
    );
  }
}

export function validateSubdomainDetectorConfig(input: SubdomainDetectorConfig): SubdomainDetectorConfig {
  const issues: string[] = [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.id)) issues.push("subdomain detector id is invalid");
  if (input.rules.length === 0 || input.rules.length > 20) issues.push("subdomain detector requires between 1 and 20 rules");
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30_000) issues.push("subdomain timeout is invalid");
  if (!Number.isInteger(input.maxRedirects) || input.maxRedirects < 0 || input.maxRedirects > 5) issues.push("subdomain redirect limit is invalid");
  if (!Number.isInteger(input.maxResponseBytes) || input.maxResponseBytes < 0 || input.maxResponseBytes > 1_048_576) issues.push("subdomain response limit is invalid");
  if (!isEvidenceCode(input.negativeEvidenceCode)) issues.push("subdomain negative evidence code is invalid");
  if (!isEvidenceCode(input.timeoutEvidenceCode)) issues.push("subdomain timeout evidence code is invalid");
  if (!confidenceLevels.includes(input.negativeConfidence)) issues.push("subdomain negative confidence is invalid");

  for (const [index, rule] of input.rules.entries()) {
    if (!isHostnameTemplate(rule.hostnameTemplate)) issues.push(`subdomain rule ${index} hostname template is invalid`);
    if (rule.protocol !== "https" && rule.protocol !== "http") issues.push(`subdomain rule ${index} protocol is invalid`);
    if (!rule.path.startsWith("/") || rule.path.includes("#") || rule.path.length > 512) issues.push(`subdomain rule ${index} path is invalid`);
    if (rule.acceptedStatusCodes.length === 0 || rule.acceptedStatusCodes.some((code) => !Number.isInteger(code) || code < 100 || code > 599)) issues.push(`subdomain rule ${index} status codes are invalid`);
    if (!isEvidenceCode(rule.evidenceCode)) issues.push(`subdomain rule ${index} evidence code is invalid`);
    if (!confidenceLevels.includes(rule.confidence)) issues.push(`subdomain rule ${index} confidence is invalid`);
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
    detectorKind: "subdomain",
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
