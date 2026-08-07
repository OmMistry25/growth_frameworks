import { Resolver } from "node:dns/promises";

import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import type { DnsQuery, DnsResolution, DnsResolverPort } from "./dns-detector.ts";

export interface NodeDnsResolverConfig {
  readonly timeoutMs: number;
  readonly tries: number;
  readonly servers?: readonly string[];
}

export class NodeDnsResolver implements DnsResolverPort {
  readonly #config: NodeDnsResolverConfig;

  constructor(config: NodeDnsResolverConfig) {
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000) {
      throw new TypeError("DNS timeout must be an integer between 100 and 30000 milliseconds");
    }
    if (!Number.isInteger(config.tries) || config.tries < 1 || config.tries > 5) {
      throw new TypeError("DNS tries must be an integer between 1 and 5");
    }
    this.#config = config;
  }

  async resolve(query: DnsQuery): Promise<DnsResolution> {
    const resolver = new Resolver({
      timeout: this.#config.timeoutMs,
      maxTimeout: this.#config.timeoutMs,
      tries: this.#config.tries,
    });
    if (this.#config.servers !== undefined) resolver.setServers([...this.#config.servers]);

    try {
      const values = await resolveRecords(resolver, query);
      return { status: "answered", values };
    } catch (error) {
      const code = getErrorCode(error);
      if (code === "ENOTFOUND" || code === "ENODATA") return { status: "not_found" };
      if (code === "ETIMEOUT" || code === "ECANCELLED") return { status: "timeout" };
      throw new PortOperationError("DNS resolution failed", "transient", true, { cause: error });
    }
  }
}

async function resolveRecords(resolver: Resolver, query: DnsQuery): Promise<readonly string[]> {
  if (query.recordType === "A") return resolver.resolve4(query.hostname);
  if (query.recordType === "AAAA") return resolver.resolve6(query.hostname);
  if (query.recordType === "CNAME") return resolver.resolveCname(query.hostname);
  const records = await resolver.resolveTxt(query.hostname);
  return records.map((parts) => parts.join(""));
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
