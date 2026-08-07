# Probe Connector

Status: DNS implemented; TXT, subdomain, and TCP expansion planned

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
