# Probe Connector

Status: DNS, HTTP subdomain, and TCP implemented

The probe connector implements public technical observations behind the Competitive Footprint Monitor's `SignalDetector` contract. It contains network protocol behavior and result normalization, not company or competitor policy.

## DNS detector

The DNS detector evaluates one to twenty configured rules. Each rule defines:

- a hostname template ending in `{domain}`;
- an `A`, `AAAA`, `CNAME`, or `TXT` record type;
- an exact, suffix, or substring matcher;
- a sanitized evidence code;
- the confidence assigned to a match.

Fixed customer or company domains are rejected. Examples of valid templates include `{domain}`, `_verify.{domain}`, and `status.{domain}`.

The detector returns:

- `positive` when at least one rule matches;
- `negative` when every rule concludes and no rule matches;
- `indeterminate` when a timeout prevents a conclusive negative result.

A positive result takes precedence over a timeout from another rule. Observations contain evidence codes, counts, and a SHA-256 fingerprint. They do not contain raw DNS records.

## Network bounds

The Node.js DNS adapter requires:

- a timeout from 100 to 30,000 milliseconds;
- one to five resolution attempts;
- optional explicit DNS servers.

`ENOTFOUND` and `ENODATA` are conclusive missing-record results. `ETIMEOUT` and `ECANCELLED` are indeterminate results. Other resolver failures become retryable canonical port errors without exposing provider payloads.

## Testing

Contract tests use a queue-backed synthetic resolver. They perform no live DNS requests and include positive, negative, timeout, mixed-result, configuration, and network-bound cases.

## HTTP subdomain detector

The subdomain detector checks configured account-relative hostnames and paths. Each rule defines:

- a hostname template ending in `{domain}`;
- an HTTP or HTTPS protocol and absolute path;
- accepted response status codes;
- a sanitized evidence code and confidence.

The Node.js adapter limits total request time, redirects, response bytes, and header size. Each initial hostname and redirect hostname is resolved through the public-address policy. The request socket is pinned to an address returned by that policy, preventing a second unvalidated DNS lookup during connection.

The shared pinned lookup implements both Node callback forms: a single address for traditional lookups and an address array when Node 24 requests `{ all: true }` for automatic family selection. This preserves address pinning without violating the socket API contract.

The public-address policy blocks loopback, private, link-local, carrier-grade NAT, documentation, benchmark, multicast, reserved, IPv4-mapped IPv6, and unique-local ranges. A redirect to a non-HTTP protocol, an HTTPS downgrade, a URL containing credentials, or a non-public destination produces a permanent port error.

Responsive accepted statuses produce positive observations. Conclusive non-matching statuses produce negative observations. Timeouts and redirect-limit exhaustion produce indeterminate observations so they cannot erase a prior positive state.

Subdomain contract tests use a synthetic HTTP client and open no sockets. Public-address and request-bound tests are deterministic and require no external network.

## TCP detector

The TCP detector checks configured account-relative hostnames and explicit ports. Each rule defines:

- a hostname template ending in `{domain}`;
- a port from 1 to 65,535;
- whether a verified TLS handshake is required;
- a sanitized evidence code and confidence.

The Node.js adapter resolves each hostname through the same public-address policy as the HTTP adapter. Each TCP or TLS socket is pinned to a validated address. TLS connections retain the configured hostname for Server Name Indication and certificate identity validation.

Connection attempts share a bounded deadline across resolved addresses. A successful connection produces a positive observation. Refused, unreachable, and TLS validation outcomes are conclusive negative evidence. Timeouts produce indeterminate observations so they cannot erase prior positive state.

TCP contract tests use a synthetic client and open no sockets. They cover connection, refusal, timeout, mixed-result, configuration, port, and request-bound behavior.

## Sanitized transport diagnostics

Unexpected Node transport errors are mapped through a closed allowlist before reaching run reports. Safe codes distinguish network permission denial, unavailable networks or local addresses, temporary hostname resolution, aborted or broken connections, closed sockets, and TLS protocol failures. Unknown errors retain generic `http_request_failed` or `tcp_connection_failed` codes. Raw operating-system codes, exception messages, addresses, and endpoints are never copied into the diagnostic field.
