# Competitive Footprint Monitor Specification

Status: Active transfer

Reference baseline: `spy` at `44e5d95e1df903f22fa401f02eb7c8bd58d6838e`

## Purpose

The Competitive Footprint Monitor observes public technical signals for configured account domains, compares each observation with prior state, and produces destination-neutral transition intents. It does not require a specific CRM, notification provider, storage product, or competitor identity.

## Inputs

A run receives:

- a validated framework configuration;
- a run identifier, start time, and dry-run flag;
- canonical accounts from an account source;
- the latest stored signal state for each account and detector;
- observations from configured detectors.

An account has a stable canonical identifier, display name, normalized domain, segment, and optional external references. CRM stages and owner identifiers remain connector metadata unless configuration maps them into canonical segments.

## Domain normalization

Domain input is normalized before account identity or probing:

1. Trim surrounding whitespace.
2. Parse a URL or hostname without using its path, query, fragment, credentials, or port.
3. Convert the hostname to lowercase ASCII.
4. Remove a single trailing dot.
5. Remove a leading `www.` label.
6. Reject IP addresses, localhost names, invalid labels, and names without a registrable-looking suffix.

Normalization does not perform DNS resolution and does not infer a different registrable domain from a supplied subdomain.

## Observations

Each detector emits one observation for an account and observation time. An observation contains:

- detector identifier and detector kind;
- status: `positive`, `negative`, or `indeterminate`;
- confidence: `low`, `medium`, or `high`;
- sanitized evidence codes;
- optional non-sensitive metadata.

`indeterminate` represents an incomplete or unreliable probe. It does not erase a prior positive signal and cannot create a loss transition.

## State

The stored signal state is one of:

- `unknown`: no conclusive observation has been recorded;
- `possible`: a low-confidence positive signal exists;
- `confirmed`: a medium- or high-confidence positive signal exists;
- `historical`: a prior confirmed signal is no longer observed, but historical evidence remains;
- `lost`: configured loss criteria have been satisfied;

The framework stores the last conclusive observation time, last checked time, current confidence, evidence summary, and state version. State versions increase only when a conclusive observation changes stored state.

## Transition rules

| Prior state | Observation | Result | Transition kind |
| --- | --- | --- | --- |
| Any | `indeterminate` | Preserve prior state | `none` |
| `unknown` | Low positive | `possible` | `detected` |
| `unknown` or `possible` | Medium or high positive | `confirmed` | `detected` or `confidence_upgraded` |
| `confirmed`, `historical`, or `lost` | Positive | `confirmed` | `restored` when prior state was not confirmed |
| `confirmed` | Negative with historical-only evidence | `historical` | `signal_changed` |
| `confirmed` | Negative satisfying configured loss criteria | `lost` | `lost` |
| `possible` | Negative | `unknown` | `cleared` |
| `historical` or `lost` | Negative | Preserve prior state | `none` |

A detector-specific policy decides whether negative evidence is conclusive and whether historical-only evidence prevents a lost classification. The default policy must not classify TXT-only history as churn.

## Due selection

Cadence is configuration, not a fixed constant. The framework selects an account when it has never been checked or when `lastCheckedAt + cadence` is at or before the run time. Cadence may vary by canonical account segment and current signal state.

All due calculations use an injected clock and UTC timestamps.

## Outputs

A processed account produces:

- its normalized observation;
- the previous and next state;
- zero or one transition;
- persistence intents;
- destination-neutral delivery intents selected by transition policy.

A run result reports selected, processed, changed, unchanged, skipped, and failed counts. It includes structured failures by account and operation. A run with any failed account has status `partial_failure` unless the run itself cannot continue, in which case it has status `failed`.

## Idempotency and dry-run behavior

The operation identity is derived from the framework, account, detector, observation time, and observation fingerprint. Reprocessing the same operation must not create another state version or delivery intent.

Dry-run mode performs normalization, due selection, detection, comparison, and intent generation. It does not persist state or call external destinations. The run result marks all generated writes as dry-run intents.

## Ports

The framework depends on these replaceable ports:

- `AccountSource`: lists canonical accounts.
- `SignalDetector`: observes one detector for one account.
- `SignalStateStore`: reads state and atomically records an idempotent transition.
- `TransitionDestination`: delivers a destination-neutral transition intent.
- `Clock`: supplies the current time.
- `EventSink`: records structured operational events.

Port implementations translate their own provider errors into canonical error categories. The framework determines whether an operation may retry; applications enforce the retry schedule and process lifecycle.

## Failure behavior

- Invalid framework configuration fails before account reads.
- An invalid source record is rejected with a validation failure and does not enter a detector.
- A detector timeout or transient failure affects its account operation and preserves prior state.
- An authorization failure stops further calls to the affected port.
- A persistence failure prevents destination delivery for that transition.
- A destination failure leaves committed state intact and records a retryable delivery operation with the same idempotency key.
- Logs and results exclude credentials, raw provider payloads, and sensitive evidence.

## Initial non-goals

- Selecting a production database, scheduler, queue, or hosting platform.
- Encoding HubSpot stages as framework policy.
- Encoding Serval names, signals, labels, or alert copy.
- Building a dashboard.
- Supporting later growth frameworks through speculative abstractions.

## Parity evidence

Sanitized fixtures in `packages/frameworks/competitive-footprint/test/fixtures` encode domain and transition behavior. Connector pagination, retries, reconciliation, and delivery formatting will receive separate contract fixtures when those connectors are implemented.
