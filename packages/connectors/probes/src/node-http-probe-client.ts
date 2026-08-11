import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import { createPinnedLookup } from "./pinned-lookup.ts";
import type { PublicAddressResolverPort } from "./public-address.ts";
import type { HttpProbeClientPort, HttpProbeRequest, HttpProbeResult } from "./subdomain-detector.ts";
import { createSanitizedTransportError } from "./transport-failure.ts";

export class NodeHttpProbeClient implements HttpProbeClientPort {
  readonly #addressResolver: PublicAddressResolverPort;

  constructor(addressResolver: PublicAddressResolverPort) {
    this.#addressResolver = addressResolver;
  }

  async probe(input: HttpProbeRequest): Promise<HttpProbeResult> {
    validateRequest(input);
    const deadline = Date.now() + input.timeoutMs;
    return this.#request(new URL(input.url), input, deadline, 0);
  }

  async #request(
    url: URL,
    input: HttpProbeRequest,
    deadline: number,
    redirects: number,
  ): Promise<HttpProbeResult> {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new PortOperationError("HTTP probe blocked a non-HTTP redirect", "permanent", false);
    }
    if (url.username !== "" || url.password !== "") {
      throw new PortOperationError("HTTP probe blocked URL credentials", "permanent", false);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { status: "timeout" };

    const addresses = await this.#addressResolver.resolve(url.hostname);
    const selected = addresses[0];
    if (selected === undefined) {
      throw new PortOperationError("HTTP probe hostname returned no public addresses", "transient", true, {
        failureCode: "hostname_no_public_addresses",
      });
    }
    if (selected.family !== 4 && selected.family !== 6) {
      throw new PortOperationError("HTTP probe received an invalid address family", "permanent", false);
    }
    const lookup = createPinnedLookup(selected.address, selected.family);

    const response = await requestOnce(url, remainingMs, input.maxResponseBytes, lookup);
    if (response.kind !== "response") return { status: response.kind };
    if (!isRedirect(response.statusCode) || response.location === undefined) {
      return {
        status: "responded",
        statusCode: response.statusCode,
        redirects,
        truncated: response.truncated,
      };
    }
    if (redirects >= input.maxRedirects) return { status: "redirect_limit" };
    const redirectUrl = new URL(response.location, url);
    if (url.protocol === "https:" && redirectUrl.protocol === "http:") {
      throw new PortOperationError("HTTP probe blocked an HTTPS downgrade", "permanent", false);
    }
    return this.#request(redirectUrl, input, deadline, redirects + 1);
  }
}

type SingleResponse =
  | { readonly kind: "timeout" }
  | { readonly kind: "unreachable" }
  | {
      readonly kind: "response";
      readonly statusCode: number;
      readonly location?: string;
      readonly truncated: boolean;
    };

function requestOnce(
  url: URL,
  timeoutMs: number,
  maxResponseBytes: number,
  lookup: LookupFunction,
): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: SingleResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester(
      url,
      {
        method: "GET",
        lookup,
        maxHeaderSize: 16_384,
        headers: {
          accept: "*/*",
          "user-agent": "growth-frameworks-probe/0.0.0",
        },
      },
      (response) => consumeResponse(response, maxResponseBytes, finish),
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish({ kind: "timeout" });
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      if (error.code === "ETIMEDOUT" || error.code === "ECONNRESET") {
        finish({ kind: "timeout" });
        return;
      }
      if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND"].includes(error.code ?? "")) {
        finish({ kind: "unreachable" });
        return;
      }
      reject(createSanitizedTransportError("HTTP probe request failed", error, "http"));
    });
    request.end();
  });
}

function consumeResponse(
  response: IncomingMessage,
  maxResponseBytes: number,
  finish: (response: SingleResponse) => void,
): void {
  let bytes = 0;
  let truncated = false;
  response.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > maxResponseBytes) {
      truncated = true;
      complete();
      response.destroy();
    }
  });
  const complete = () => {
    const base = {
      kind: "response" as const,
      statusCode: response.statusCode ?? 0,
      truncated,
    };
    const location = response.headers.location;
    finish(location === undefined ? base : { ...base, location });
  };
  response.once("end", complete);
  response.once("close", complete);
}

function validateRequest(input: HttpProbeRequest): void {
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30_000) {
    throw new TypeError("HTTP probe timeout must be between 100 and 30000 milliseconds");
  }
  if (!Number.isInteger(input.maxRedirects) || input.maxRedirects < 0 || input.maxRedirects > 5) {
    throw new TypeError("HTTP probe redirects must be between 0 and 5");
  }
  if (!Number.isInteger(input.maxResponseBytes) || input.maxResponseBytes < 0 || input.maxResponseBytes > 1_048_576) {
    throw new TypeError("HTTP probe response limit must be between 0 and 1048576 bytes");
  }
}

function isRedirect(statusCode: number): boolean {
  return statusCode >= 300 && statusCode <= 399;
}
