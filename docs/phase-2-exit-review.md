# Phase 2 Exit Review

Phase 2 implemented and validated the read-only HubSpot source-integration checkpoint for the Competitive Footprint Monitor. This exit approves production-readiness work and a limited-cohort pilot; it does not approve unattended production operation or the transfer of another framework.

Review date: August 10, 2026

## Exit decision

- [x] Phase 2 read-only source integration is complete.
- [x] Production-readiness policy and limited-cohort pilot preparation may begin.
- [x] The initial release is notification-only; HubSpot signal writes are out of scope.
- [ ] Competitive Footprint Monitor is approved for unattended production use.
- [ ] The next framework may begin transfer.

Competitive Footprint Monitor remains the only active framework. The production gates below must be resolved before unattended operation or another framework transfer.

## Completed implementation evidence

### HubSpot source integration

- [x] Sanitized HubSpot company fixtures and canonical mapping configuration are defined.
- [x] A read-only HubSpot account-source connector is implemented behind an injected HTTP port.
- [x] Synthetic tests cover pagination, authorization, bounded retries, rate limits, transient failures, invalid records, and secret-safe errors.
- [x] Lifecycle-stage and ownership mapping remain connector configuration rather than framework policy.
- [x] The HubSpot-backed dry-run composition prohibits state, CRM, and delivery writes.
- [x] An exact-ID production canary permits one explicitly authorized company read with bounded attempts and emits redacted output only.

### Production probe diagnostics

- [x] The probe-only canary accepts one exact domain and cannot accept CRM credentials, state files, or delivery configuration.
- [x] Canary output is limited to aggregate results, detector status, canonical failure categories, and sanitized transport codes.
- [x] DNS, HTTPS, and TLS probes preserve public-address checks, bounded timeouts, redirect limits, and response-size limits.
- [x] Shared pinned lookup behavior supports both traditional and Node.js 24 `{ all: true }` lookup callbacks.
- [x] Regression tests cover traditional and Node.js 24 all-address lookup semantics used by the HTTP and TLS clients.

### Safety controls

- [x] Network access remains deny-by-default and requires explicit per-run authorization.
- [x] Production canaries expose no company ID, domain, endpoint, credential, evidence, operation key, or failure message in their output.
- [x] CRM access is read-only and excluded entirely from probe-only diagnostics.
- [x] State writes and Slack delivery are disabled for source and probe canaries.
- [x] Temporary credentials and local canary configuration are removed after authorized runs.

## Verification record

The Phase 2 exit baseline contains 140 passing automated tests, TypeScript typechecking, and dependency-audit enforcement in CI.

The automated suite covers:

- HubSpot mapping, pagination, authorization, retry, rate-limit, validation, and secret-safety behavior;
- dry-run and exact-ID canary authorization gates;
- CRM-, state-, and delivery-write denial;
- redacted aggregate and per-detector reporting;
- DNS, HTTP, TLS, public-address, pinned-lookup, and transport-code behavior; and
- the Phase 1 framework, persistence, outbox, and Slack-delivery baseline.

On August 10, 2026, explicitly authorized production diagnostics completed the following redacted validation sequence:

```text
exact-ID company read
  -> canonical account mapping verified
  -> no CRM, state, or delivery writes

exact-domain probe-only confirmation
  -> DNS CNAME detector completed
  -> HTTPS detector completed
  -> TLS detector completed
  -> zero detector failures
```

The CRM credential was retrieved from macOS Keychain without being printed and was deleted after the authorized CRM run. The final probe-only confirmation used no CRM credential. Its temporary local configuration was deleted and verified absent. No production identifier, domain, credential, or canary output has been committed to the repository.

## Initial release policy

The initial release remains notification-only. The framework may read canonical company data from HubSpot, observe public signals, persist its own state, and deliver approved notifications. It must not create or modify HubSpot properties, records, associations, or activities.

HubSpot writes require a separate design review covering property ownership, write authorization, idempotency, rollback, auditability, and sandbox validation. They are not a prerequisite for the limited-cohort pilot.

## Remaining production gates

- [x] Define operator handling for terminal Slack-delivery failures and exhausted outbox items.
- [x] Add durable run records or an operational event sink appropriate to the selected execution environment.
- [x] Define pilot account selection, authorization, duration, success criteria, and stop conditions.
- [x] Document pilot rollback, state retention, credential removal, and notification cleanup procedures.
- [ ] Complete the limited-cohort pilot and record its evidence.
- [ ] Select scheduling, hosting, and multi-host storage only if pilot evidence establishes those requirements.
- [ ] Complete a production release review before enabling unattended operation.

## Phase 3 entry sequence

The next pull requests should proceed in this order:

1. Define terminal-delivery and exhausted-outbox operator policy. (Completed; see the [delivery failure policy](./operations/competitive-footprint-delivery-failure-policy.md).)
2. Add durable, secret-safe run records or an operational event sink. (Completed; see the [file run record store](./storage/file-run-record-store.md).)
3. Define the limited-cohort pilot plan, rollback procedure, and retention policy. (Completed; see the [limited-cohort pilot plan](./operations/competitive-footprint-limited-cohort-pilot.md).)
4. Execute the pilot only after its configuration and operating checks pass in CI.
5. Record pilot evidence and make a separate production release decision.

The active pilot is monitoring-only under its [reviewed amendment](./operations/competitive-footprint-monitoring-only-pilot-amendment.md). Live Slack delivery is excluded, and the final review must not claim production-cohort Slack validation or approve unattended Slack delivery from this pilot alone.

No additional CRM capability or credential is required for the first Phase 3 checkpoint.

## Deferred decisions

Phase 2 does not select a scheduler, hosting platform, multi-host database, queue, authentication product, or dashboard framework. Those choices remain deferred until pilot evidence demonstrates a concrete requirement.

Conversation Ingestion remains next in the framework catalog, but its transfer may not begin until the Competitive Footprint production release gates are resolved or explicitly re-scoped in a reviewed decision.
