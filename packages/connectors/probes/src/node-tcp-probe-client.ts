import { connect as connectTcp, type LookupFunction, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import type { PublicAddressResolverPort } from "./public-address.ts";
import type { TcpProbeClientPort, TcpProbeRequest, TcpProbeResult } from "./tcp-detector.ts";

export class NodeTcpProbeClient implements TcpProbeClientPort {
  readonly #addressResolver: PublicAddressResolverPort;

  constructor(addressResolver: PublicAddressResolverPort) {
    this.#addressResolver = addressResolver;
  }

  async probe(input: TcpProbeRequest): Promise<TcpProbeResult> {
    validateRequest(input);
    const addresses = await this.#addressResolver.resolve(input.hostname);
    const deadline = Date.now() + input.timeoutMs;
    let lastResult: TcpProbeResult = { status: "unreachable" };

    for (const address of addresses) {
      if (address.family !== 4 && address.family !== 6) {
        throw new PortOperationError("TCP probe received an invalid address family", "permanent", false);
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { status: "timeout" };
      const result = await connectOnce(input, address.address, address.family, remainingMs);
      if (result.status === "connected") return result;
      if (result.status === "timeout") return result;
      lastResult = result;
    }
    return lastResult;
  }
}

function connectOnce(
  input: TcpProbeRequest,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
): Promise<TcpProbeResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: TcpProbeResult, socket: Socket | TLSSocket) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const lookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, address, family);
    };
    const socket = input.tls
      ? connectTls({
          host: input.hostname,
          port: input.port,
          lookup,
          servername: input.hostname,
          rejectUnauthorized: true,
        })
      : connectTcp({ host: input.hostname, port: input.port, lookup });
    const connectedEvent = input.tls ? "secureConnect" : "connect";

    socket.setTimeout(timeoutMs, () => finish({ status: "timeout" }, socket));
    socket.once(connectedEvent, () => finish({ status: "connected", family }, socket));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      if (error.code === "ECONNREFUSED") return finish({ status: "refused" }, socket);
      if (["EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND"].includes(error.code ?? "")) {
        return finish({ status: "unreachable" }, socket);
      }
      if (["ETIMEDOUT", "ECONNRESET"].includes(error.code ?? "")) {
        return finish({ status: "timeout" }, socket);
      }
      if (input.tls && isTlsError(error)) return finish({ status: "tls_error" }, socket);
      socket.destroy();
      reject(new PortOperationError("TCP probe connection failed", "transient", true, { cause: error }));
    });
  });
}

function validateRequest(input: TcpProbeRequest): void {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new TypeError("TCP probe port must be between 1 and 65535");
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30_000) {
    throw new TypeError("TCP probe timeout must be between 100 and 30000 milliseconds");
  }
}

function isTlsError(error: NodeJS.ErrnoException): boolean {
  return (error.code ?? "").startsWith("ERR_TLS_") || (error.code ?? "").startsWith("CERT_") || error.code === "DEPTH_ZERO_SELF_SIGNED_CERT";
}
