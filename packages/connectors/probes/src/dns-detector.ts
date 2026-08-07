import { createHash } from "node:crypto";

import {
  confidenceLevels,
  ContractValidationError,
  type Confidence,
  type SignalDetector,
  type SignalObservation,
} from "@growth-frameworks/contracts/competitive-footprint";

export const dnsRecordTypes = ["A", "AAAA", "CNAME", "TXT"] as const;
export const dnsMatcherTypes = ["exact", "suffix", "contains"] as const;
export type DnsRecordType = (typeof dnsRecordTypes)[number];

export interface DnsQuery {
  readonly hostname: string;
  readonly recordType: DnsRecordType;
}

export type DnsResolution =
  | { readonly status: "answered"; readonly values: readonly string[] }
  | { readonly status: "not_found" | "timeout" };

export interface DnsResolverPort {
  resolve(query: DnsQuery): Promise<DnsResolution>;
}

export interface DnsMatchRule {
  readonly hostnameTemplate: string;
  readonly recordType: DnsRecordType;
  readonly matcher: {
    readonly type: "exact" | "suffix" | "contains";
    readonly value: string;
  };
  readonly evidenceCode: string;
  readonly confidence: Confidence;
}

export interface DnsDetectorConfig {
  readonly id: string;
  readonly rules: readonly DnsMatchRule[];
  readonly negativeEvidenceCode: string;
  readonly timeoutEvidenceCode: string;
  readonly negativeConfidence: Confidence;
}

export class DnsSignalDetector implements SignalDetector {
  readonly id: string;
  readonly kind = "dns" as const;
  readonly #config: DnsDetectorConfig;
  readonly #resolver: DnsResolverPort;

  constructor(configInput: DnsDetectorConfig, resolver: DnsResolverPort) {
    this.#config = validateDnsDetectorConfig(configInput);
    this.id = this.#config.id;
    this.#resolver = resolver;
  }

  async observe(
    account: Parameters<SignalDetector["observe"]>[0],
    context: Parameters<SignalDetector["observe"]>[1],
  ): Promise<SignalObservation> {
    const evidence: Array<{ readonly code: string; readonly confidence: Confidence }> = [];
    let timedOut = false;
    let answered = 0;

    for (const rule of this.#config.rules) {
      const query = {
        hostname: renderHostname(rule.hostnameTemplate, account.domain),
        recordType: rule.recordType,
      };
      const resolution = await this.#resolver.resolve(query);
      if (resolution.status === "timeout") {
        timedOut = true;
        continue;
      }
      answered += 1;
      if (
        resolution.status === "answered" &&
        resolution.values.some((value) => matches(value, rule.matcher))
      ) {
        evidence.push({ code: rule.evidenceCode, confidence: rule.confidence });
      }
    }

    const observedAt = context.startedAt;
    if (evidence.length > 0) {
      const evidenceCodes = [...new Set(evidence.map(({ code }) => code))].sort();
      return createObservation({
        accountId: account.id,
        detectorId: this.id,
        observedAt,
        status: "positive",
        confidence: highestConfidence(evidence.map(({ confidence }) => confidence)),
        evidenceCodes,
        fingerprintValues: ["positive", ...evidenceCodes],
        metadata: { rulesChecked: this.#config.rules.length, rulesMatched: evidence.length },
      });
    }

    if (timedOut || answered === 0) {
      return createObservation({
        accountId: account.id,
        detectorId: this.id,
        observedAt,
        status: "indeterminate",
        confidence: "low",
        evidenceCodes: [this.#config.timeoutEvidenceCode],
        fingerprintValues: ["indeterminate", this.#config.timeoutEvidenceCode],
        metadata: { rulesChecked: this.#config.rules.length, rulesAnswered: answered },
      });
    }

    return createObservation({
      accountId: account.id,
      detectorId: this.id,
      observedAt,
      status: "negative",
      confidence: this.#config.negativeConfidence,
      evidenceCodes: [this.#config.negativeEvidenceCode],
      fingerprintValues: ["negative", this.#config.negativeEvidenceCode],
      metadata: { rulesChecked: this.#config.rules.length, rulesAnswered: answered },
    });
  }
}

export function validateDnsDetectorConfig(input: DnsDetectorConfig): DnsDetectorConfig {
  const issues: string[] = [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.id)) issues.push("DNS detector id is invalid");
  if (input.rules.length === 0 || input.rules.length > 20) {
    issues.push("DNS detector requires between 1 and 20 rules");
  }
  if (!isEvidenceCode(input.negativeEvidenceCode)) issues.push("negative evidence code is invalid");
  if (!isEvidenceCode(input.timeoutEvidenceCode)) issues.push("timeout evidence code is invalid");
  if (!confidenceLevels.includes(input.negativeConfidence)) issues.push("negative confidence is invalid");

  for (const [index, rule] of input.rules.entries()) {
    if (!isHostnameTemplate(rule.hostnameTemplate)) issues.push(`DNS rule ${index} hostname template is invalid`);
    if (!dnsRecordTypes.includes(rule.recordType)) issues.push(`DNS rule ${index} record type is invalid`);
    if (!dnsMatcherTypes.includes(rule.matcher.type)) issues.push(`DNS rule ${index} matcher type is invalid`);
    if (rule.matcher.value.trim().length === 0 || rule.matcher.value.length > 256) {
      issues.push(`DNS rule ${index} match value is invalid`);
    }
    if (!isEvidenceCode(rule.evidenceCode)) issues.push(`DNS rule ${index} evidence code is invalid`);
    if (!confidenceLevels.includes(rule.confidence)) issues.push(`DNS rule ${index} confidence is invalid`);
  }

  if (issues.length > 0) throw new ContractValidationError(issues);
  return input;
}

function createObservation(input: {
  readonly accountId: string;
  readonly detectorId: string;
  readonly observedAt: string;
  readonly status: SignalObservation["status"];
  readonly confidence: Confidence;
  readonly evidenceCodes: readonly string[];
  readonly fingerprintValues: readonly string[];
  readonly metadata: Readonly<Record<string, number>>;
}): SignalObservation {
  return {
    accountId: input.accountId,
    detectorId: input.detectorId,
    detectorKind: "dns",
    observedAt: input.observedAt,
    status: input.status,
    confidence: input.confidence,
    evidenceCodes: input.evidenceCodes,
    fingerprint: createHash("sha256").update(JSON.stringify(input.fingerprintValues)).digest("hex"),
    metadata: input.metadata,
  };
}

function renderHostname(template: string, domain: string): string {
  return template.replace("{domain}", domain).toLowerCase();
}

function matches(
  input: string,
  matcher: DnsMatchRule["matcher"],
): boolean {
  const value = input.toLowerCase().replace(/\.$/, "");
  const expected = matcher.value.toLowerCase().replace(/\.$/, "");
  if (matcher.type === "exact") return value === expected;
  if (matcher.type === "suffix") return value === expected || value.endsWith(`.${expected}`);
  return value.includes(expected);
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
  if (!prefix.endsWith(".")) return false;
  return prefix
    .slice(0, -1)
    .split(".")
    .every((label) => /^(?!-)[a-zA-Z0-9_-]{1,63}(?<!-)$/.test(label));
}
