import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

export type TransportKind = "http" | "tcp" | "tls";

interface SafeTransportFailure {
  readonly category: "transient" | "permanent";
  readonly retryable: boolean;
  readonly failureCode: string;
}

const failuresByNodeCode: Readonly<Record<string, SafeTransportFailure>> = {
  EACCES: { category: "permanent", retryable: false, failureCode: "network_permission_denied" },
  EPERM: { category: "permanent", retryable: false, failureCode: "network_permission_denied" },
  EADDRNOTAVAIL: { category: "transient", retryable: true, failureCode: "local_address_unavailable" },
  EAI_AGAIN: { category: "transient", retryable: true, failureCode: "hostname_resolution_temporary" },
  ENETDOWN: { category: "transient", retryable: true, failureCode: "network_unavailable" },
  ECONNABORTED: { category: "transient", retryable: true, failureCode: "connection_aborted" },
  EPIPE: { category: "transient", retryable: true, failureCode: "connection_broken" },
  ERR_SOCKET_CLOSED: { category: "transient", retryable: true, failureCode: "socket_closed" },
};

export function createSanitizedTransportError(
  message: string,
  error: NodeJS.ErrnoException,
  kind: TransportKind,
): PortOperationError {
  const known = failuresByNodeCode[error.code ?? ""];
  if (known !== undefined) {
    return new PortOperationError(message, known.category, known.retryable, {
      cause: error,
      failureCode: known.failureCode,
    });
  }
  if (kind === "tls" && isTlsCode(error.code)) {
    return new PortOperationError(message, "permanent", false, {
      cause: error,
      failureCode: "tls_protocol_failed",
    });
  }
  return new PortOperationError(message, "transient", true, {
    cause: error,
    failureCode: kind === "http" ? "http_request_failed" : "tcp_connection_failed",
  });
}

function isTlsCode(code: string | undefined): boolean {
  return (
    code?.startsWith("ERR_SSL_") === true ||
    code?.startsWith("ERR_TLS_") === true ||
    code?.startsWith("CERT_") === true ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  );
}
