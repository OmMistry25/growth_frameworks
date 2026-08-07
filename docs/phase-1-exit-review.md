# Phase 1 Exit Review

Phase 1 implemented and validated the reusable core of the Competitive Footprint Monitor. This exit approves entry into source integration; it does not approve unattended production operation or the transfer of another framework.

Review date: August 7, 2026

Reference baseline: `spy` at `44e5d95e1df903f22fa401f02eb7c8bd58d6838e`

## Exit decision

- [x] Phase 1 implementation validation is complete.
- [x] Phase 2 may begin with a read-only HubSpot account-source connector.
- [ ] Competitive Footprint Monitor is approved for unattended production use.
- [ ] The next framework may begin transfer.

Competitive Footprint Monitor remains the only active framework. Production release and the next framework transfer require the remaining gates in this review.

## Completed implementation evidence

### Contracts and framework

- [x] Canonical account, observation, state, transition, run, destination, and outbox contracts are implemented.
- [x] Configuration and external account files are validated before adapter construction.
- [x] State transitions, cadence selection, dry-run intents, idempotent operations, and failure isolation are covered by deterministic tests.
- [x] Sanitized parity fixtures remain traceable to the pinned reference commit.
- [x] Company names, production records, credentials, and provider-specific policy remain outside framework code and fixtures.

### Public probe connectors

- [x] DNS, HTTP subdomain, and TCP detectors implement bounded timeouts and canonical observations.
- [x] HTTP and TCP targets are constrained by public-address policy.
- [x] Redirect, TLS, response-size, retry, and fixed-host configuration safeguards are tested.
- [x] Network execution is deny-by-default and requires explicit authorization.

### Persistence and delivery

- [x] The atomic single-host file store persists state and operation identities with mode `0600` files.
- [x] The versioned state format supports backward-compatible schema v1 reads and schema v2 delivery metadata.
- [x] Transitions enter a durable outbox in the same atomic replacement as state changes.
- [x] Attempt acquisition uses optimistic concurrency to suppress stale duplicate dispatch.
- [x] The bounded dispatcher records attempts before side effects and receipts after success.
- [x] Slack webhook delivery validates endpoints, redacts secrets, bounds payload fields, and maps retry categories.
- [x] At-least-once semantics and the receipt crash window are documented without an exactly-once claim.

### Operator controls

- [x] Synthetic dry run performs no network or writes.
- [x] Network dry run requires explicit network authorization and performs no writes.
- [x] Stateful scanning requires explicit network and state-write authorization and has no delivery destination.
- [x] Delivery is a separate command requiring network, state-write, and delivery authorization.
- [x] Webhook credentials are accepted only through the environment, not files or arguments.
- [x] Read-only preflight reports aggregate outbox readiness and fails closed for missing or invalid state.

## Verification record

The Phase 1 exit baseline contains 100 passing automated tests with TypeScript typechecking and dependency audit enforcement in CI.

The automated suite covers:

- canonical validation and normalization;
- parity transitions and cadence boundaries;
- DNS, HTTP, TCP, and public-address behavior;
- synthetic and network CLI authorization gates;
- atomic file persistence, migration, locking, idempotency, and read-only access;
- durable outbox attempts, receipts, concurrency, and exhaustion;
- Slack endpoint, payload, failure, and secret-safety behavior;
- dispatcher ordering and failure classification;
- delivery and preflight CLI composition.

On August 7, 2026, an explicitly authorized synthetic canary completed this path against a non-production Slack channel:

```text
synthetic transition
  -> schema v2 file state
  -> read-only preflight: ready
  -> bounded dispatch with limit 1
  -> Slack HTTP success
  -> durable receipt
  -> read-only preflight: empty
```

The test webhook was retrieved from macOS Keychain without being printed, then deleted. The temporary canary state directory was also removed. No credential, webhook URL, or canary state remains in the repository.

## Remaining production gates

These items are intentionally not represented as complete:

- [ ] Read canonical accounts from a HubSpot sandbox through a read-only connector.
- [ ] Prove pagination, bounded retries, rate-limit translation, and field mapping with synthetic contract fixtures.
- [ ] Keep HubSpot lifecycle stages and ownership fields in connector configuration rather than framework policy.
- [ ] Complete a HubSpot-backed dry run without CRM writes.
- [ ] Define whether the initial release requires HubSpot signal writes or remains notification-only.
- [ ] Add an operator policy for terminal delivery failures and exhausted outbox items.
- [ ] Add durable run records or an operational event sink appropriate to the selected execution environment.
- [ ] Complete a limited account-cohort pilot with documented rollback and retention procedures.
- [ ] Select scheduling, hosting, and multi-host storage only after pilot evidence establishes those requirements.

## Phase 2 entry checklist

The next pull requests must proceed in this order:

1. Define sanitized HubSpot company fixtures and canonical mapping configuration.
2. Implement a read-only HubSpot account-source connector behind an injected HTTP port.
3. Cover pagination, authorization, rate limits, transient failures, invalid records, and secret-safe errors.
4. Add a HubSpot-backed dry-run composition that performs no state, CRM, or delivery writes.
5. Validate against a HubSpot sandbox only after the connector and CLI checks pass in CI.

HubSpot credentials are not required for the first connector checkpoint. All CI tests must remain synthetic and offline.

## Deferred decisions

Phase 1 does not select a production database, scheduler, queue, hosting platform, authentication product, or dashboard framework. Those choices remain deferred until the active vertical slice demonstrates a requirement that cannot be met safely by the current single-host operator flow.

Conversation Ingestion remains next in the framework catalog, but its transfer may not begin until the Competitive Footprint production release gates are resolved or explicitly re-scoped in a reviewed decision.
