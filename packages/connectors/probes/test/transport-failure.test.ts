import assert from "node:assert/strict";
import test from "node:test";

import { createSanitizedTransportError } from "../src/transport-failure.ts";

test("maps an allowlist of Node transport codes to safe stable reasons", () => {
  for (const testCase of [
    { nodeCode: "EPERM", code: "network_permission_denied", category: "permanent", retryable: false },
    { nodeCode: "EACCES", code: "network_permission_denied", category: "permanent", retryable: false },
    { nodeCode: "EADDRNOTAVAIL", code: "local_address_unavailable", category: "transient", retryable: true },
    { nodeCode: "EAI_AGAIN", code: "hostname_resolution_temporary", category: "transient", retryable: true },
    { nodeCode: "ENETDOWN", code: "network_unavailable", category: "transient", retryable: true },
    { nodeCode: "ECONNABORTED", code: "connection_aborted", category: "transient", retryable: true },
    { nodeCode: "EPIPE", code: "connection_broken", category: "transient", retryable: true },
    { nodeCode: "ERR_SOCKET_CLOSED", code: "socket_closed", category: "transient", retryable: true },
  ] as const) {
    const cause = Object.assign(new Error("private target detail"), { code: testCase.nodeCode });
    const error = createSanitizedTransportError("safe", cause, "tcp");
    assert.equal(error.failureCode, testCase.code);
    assert.equal(error.category, testCase.category);
    assert.equal(error.retryable, testCase.retryable);
    assert.doesNotMatch(error.message, /private target detail/);
  }
});

test("maps TLS-library codes without copying the raw code", () => {
  for (const nodeCode of ["ERR_SSL_WRONG_VERSION_NUMBER", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED"]) {
    const cause = Object.assign(new Error("private certificate detail"), { code: nodeCode });
    const error = createSanitizedTransportError("safe", cause, "tls");
    assert.equal(error.failureCode, "tls_protocol_failed");
    assert.equal(error.category, "permanent");
    assert.equal(error.retryable, false);
    assert.doesNotMatch(JSON.stringify(error), new RegExp(nodeCode));
  }
});

test("uses generic protocol codes for unknown errors", () => {
  const cause = Object.assign(new Error("private unknown detail"), { code: "UNKNOWN_PRIVATE_CODE" });
  assert.equal(createSanitizedTransportError("safe", cause, "http").failureCode, "http_request_failed");
  assert.equal(createSanitizedTransportError("safe", cause, "tcp").failureCode, "tcp_connection_failed");
});
