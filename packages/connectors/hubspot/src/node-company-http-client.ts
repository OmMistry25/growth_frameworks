import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import type {
  HubSpotCompanyHttpPort,
  HubSpotCompanyHttpRequest,
  HubSpotCompanyHttpResponse,
} from "./company-account-source.ts";

export interface NodeHubSpotCompanyHttpClientOptions {
  readonly fetch?: typeof fetch;
  readonly maximumResponseBytes?: number;
}

const allowedOrigin = "https://api.hubapi.com";
const allowedPath = "/crm/objects/2026-03/companies";
const allowedQueryParameters = new Set(["after", "archived", "limit", "properties"]);

export class NodeHubSpotCompanyHttpClient implements HubSpotCompanyHttpPort {
  readonly #fetch: typeof fetch;
  readonly #maximumResponseBytes: number;

  constructor(options: NodeHubSpotCompanyHttpClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 2_000_000;
    if (!Number.isInteger(this.#maximumResponseBytes) || this.#maximumResponseBytes < 1_024 || this.#maximumResponseBytes > 10_000_000) {
      throw new TypeError("HubSpot maximum response size must be an integer from 1024 to 10000000 bytes");
    }
  }

  async request(input: HubSpotCompanyHttpRequest): Promise<HubSpotCompanyHttpResponse> {
    validateRequest(input);
    let response: Response;
    try {
      response = await this.#fetch(input.url, {
        method: "GET",
        headers: { accept: "application/json", authorization: input.authorization },
        redirect: "error",
        signal: AbortSignal.timeout(input.timeoutMs),
      });
    } catch (error) {
      throw new PortOperationError("HubSpot HTTPS request failed", "transient", true, { cause: error });
    }

    const body = await readBoundedJson(response, this.#maximumResponseBytes);
    const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
    return { status: response.status, body, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  }
}

function validateRequest(input: HubSpotCompanyHttpRequest): void {
  if (
    input.method !== "GET" ||
    input.url.origin !== allowedOrigin ||
    input.url.pathname !== allowedPath ||
    input.url.username !== "" ||
    input.url.password !== "" ||
    input.url.hash !== "" ||
    [...input.url.searchParams.keys()].some((name) => !allowedQueryParameters.has(name)) ||
    [...allowedQueryParameters].some((name) => input.url.searchParams.getAll(name).length > 1)
  ) {
    throw new PortOperationError("HubSpot HTTPS request target is not approved", "authorization", false);
  }
  if (!/^Bearer [^\s\u007f]{8,512}$/.test(input.authorization)) {
    throw new PortOperationError("HubSpot HTTPS authorization is invalid", "authorization", false);
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30_000) {
    throw new TypeError("HubSpot HTTPS timeout must be an integer from 100 to 30000 milliseconds");
  }
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    throw new PortOperationError("HubSpot response exceeded the size limit", "permanent", false);
  }
  if (response.body === null) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new PortOperationError("HubSpot response exceeded the size limit", "permanent", false);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PortOperationError) throw error;
    throw new PortOperationError("HubSpot response read failed", "transient", true, { cause: error });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length === 0 ? null : JSON.parse(text);
  } catch (error) {
    throw new PortOperationError("HubSpot response was not valid JSON", "permanent", false, { cause: error });
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400 ? seconds : undefined;
}
