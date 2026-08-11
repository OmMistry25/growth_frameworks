# Competitive Footprint Delivery Failure Policy

This policy governs operator response to Slack delivery failures and pending transitions that reach the configured lifetime attempt cap. It applies to the single-host file-state deployment and does not authorize a delivery attempt, state mutation, credential change, or manual state-file edit.

## Safety baseline

- Stop after any delivery command exits nonzero. Do not place the command in an unconditional retry loop.
- Preserve the state file and a protected backup before investigation.
- Run read-only preflight with the same `--max-attempts` value used for delivery.
- Treat delivery reports as operational data because they may contain account IDs, detector IDs, and idempotency keys.
- Never paste the Slack webhook URL into a command argument, report, ticket, or chat.
- Never edit the state JSON by hand. Its operation identities, attempts, receipts, and optimistic-concurrency fields form one durable record.
- Do not lower `--max-attempts` between preflight and delivery. Changing the cap changes which pending items are eligible.

## Outcome policy

| Outcome | Meaning | Required operator action | Automatic retry |
| --- | --- | --- | --- |
| `retryableFailures > 0` | A transient destination or state operation failed. The durable attempt may already have increased. | Record the run time, failure stage, category, retryability, and idempotency key; resolve the dependency; rerun preflight before seeking approval for another delivery invocation. | Prohibited. |
| `terminalFailures > 0` | The reported operation is not expected to succeed unchanged. The item remains pending. | Stop delivery, protect the state file, diagnose configuration/authorization/payload cause, and escalate to the service owner. Do not retry until the cause is corrected and a new delivery is explicitly authorized. | Prohibited. |
| `exhausted > 0` | A pending item has reached the supplied lifetime cap and was not sent in this invocation. | Stop delivery and open an operator incident. Keep the item pending as evidence. Follow the exhausted-item decision below. | Prohibited. |
| `duplicateRisk: true` | Slack may have accepted the message, but the delivered receipt was not persisted. | Stop all replay for that key, inspect the destination and state evidence, and escalate for a replay-versus-suppress decision. | Prohibited. |
| `skipped > 0` | Another actor changed the outbox item or the receipt could not be newly recorded. | Rerun read-only preflight. If the item remains pending or the cause is unclear, stop and investigate concurrency before another delivery. | Prohibited. |

A successful delivery count does not cancel failures in the same report. Handle every failure entry and preserve its stage:

- `record_attempt`: the destination was not called by that item path; inspect state availability and concurrent writers.
- `deliver`: the attempt was persisted before the Slack request; another invocation consumes another lifetime attempt.
- `record_receipt`: Slack returned success before the state write failed; this is a duplicate-risk event.

## Triage sequence

1. Stop the delivery worker or scheduler for this state file.
2. Preserve the nonzero delivery report in the restricted operational record. Do not include the webhook URL.
3. Copy the state file to access-controlled backup storage without modifying the source.
4. Run read-only preflight with the same lifetime cap:

   ```text
   npm run preflight:competitive-footprint -- \
     --state-file /secure/operations/competitive-footprint-state.json \
     --max-attempts 3
   ```

5. Reconcile the aggregate `pending`, `deliverable`, `exhausted`, `neverAttempted`, and `attemptedPending` counts with the delivery report.
6. Diagnose the failure class without replaying:
   - authorization or permanent Slack errors: validate webhook ownership and channel policy through the secret manager and Slack administration;
   - rate limits or transient Slack errors: observe the provider retry window before requesting a later invocation;
   - state conflicts or write failures: verify file ownership, permissions, disk availability, and that only one writer is active;
   - duplicate risk: check the destination channel for the transition before any replay decision.
7. Record the decision, approver, exact state file, maximum-attempt cap, item count, and proposed limit before resuming.

## Exhausted-item decision

The current runtime has no dead-letter, reset, or administrative receipt command. Exhausted items therefore remain pending and visible to preflight.

Choose one reviewed outcome:

1. **Hold:** leave the item pending, keep delivery paused for it, and retain the state and incident evidence. This is the default.
2. **Authorized replay:** after correcting the cause, approve one bounded invocation with a higher lifetime cap, up to the CLI maximum of 10. Increasing the cap is a state-affecting replay decision, not routine retry policy; it may deliver every pending item below the new cap selected by `--limit`.
3. **Administrative resolution:** implement and review a dedicated dead-letter or suppression capability before changing the durable status. Manual JSON edits and restoring an old backup over newer state are prohibited.

An exhausted item must not be made eligible merely by changing scheduled command defaults. The approval must state the old cap, new cap, selection limit, expected item count, destination, and duplicate risk.

## Duplicate-risk decision

Slack incoming webhooks do not accept the transition idempotency key. When `duplicateRisk: true`, absence of a durable receipt cannot prove absence of delivery.

- If the message is confirmed in Slack, hold the pending item until an administrative resolution capability is reviewed. Do not replay it.
- If the message is confirmed absent and the cause is corrected, one bounded replay may be explicitly authorized.
- If delivery cannot be confirmed, default to hold and escalate. The service owner must explicitly accept duplicate notification risk before replay.

Do not infer delivery from an HTTP attempt alone, and do not infer non-delivery from a missing receipt.

## Resumption requirements

Delivery may resume only when all of the following are recorded:

- the failure cause and affected stage;
- the latest read-only preflight summary;
- remediation completed and independently reviewed;
- whether duplicate delivery is possible;
- the exact `--limit` and `--max-attempts` values;
- explicit authorization for network access, state writes, and Slack delivery; and
- a rollback instruction to stop after any new nonzero result.

Resume with the smallest practical `--limit`, run once, then repeat read-only preflight. A clean preflight is evidence of outbox status, not proof that every external notification was observed by a person.

## Retention and escalation

Delivery-only outcomes are not yet written to the durable scan run-record store. Retain the protected preflight report, delivery report, approval, and state backup under the organization's restricted incident-retention policy. Reports must not be committed to this repository.

Escalate terminal, exhausted, or duplicate-risk outcomes to the service owner. Escalate credential exposure immediately and rotate the webhook before any further delivery. Repeated state conflicts require pausing all writers until single-writer ownership is restored.

## Current limitations

- Failure classification is returned in the delivery report but is not persisted as a dead-letter reason.
- A terminal delivery failure remains pending and can be attempted by a later authorized invocation while below the cap.
- The preflight is aggregate-only and cannot select or suppress one idempotency key.
- Raising the cap can make multiple exhausted items eligible.
- Slack webhook delivery is at-least-once; exactly-once delivery is not claimed.

These limitations are release inputs for delivery run-record follow-up and the limited-cohort pilot.
