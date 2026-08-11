# Competitive Footprint Monitoring-Only Pilot Amendment

This amendment changes the active seven-day limited-cohort pilot to monitoring-only operation. It overrides every Slack delivery requirement and delivery step in the [limited-cohort pilot plan](./competitive-footprint-limited-cohort-pilot.md) for this pilot. All other cohort, probe, storage, authorization, stop, backup, retention, and review controls remain in force.

## Decision and scope

- Decision date: August 10, 2026, America/Los_Angeles.
- Scope: the reviewed three-company cohort and its approved DNS, HTTPS, and TLS targets.
- Effective period: the remainder of the current seven-day pilot.
- Delivery status: disabled.
- CRM access during daily scans: prohibited.
- CRM writes: prohibited.
- Automation and unattended scheduling: prohibited.

No Slack webhook or token may be loaded. Do not invoke `deliver:competitive-footprint`, initialize a Slack adapter, send a notification, or create delivery attempt or receipt writes during this pilot. Read-only outbox preflight is allowed only to measure protected pending state.

## Existing pending transitions

The day 1 scan produced six pending transitions: three HTTPS transitions and three TLS transitions. Preserve them without modification for the duration of the pilot.

- Keep every pending transition unattempted.
- Do not change the delivery attempt cap to force a different status.
- Do not manually edit, acknowledge, exhaust, deliver, or remove an outbox item.
- Record only aggregate pending counts in pilot evidence.
- Continue protecting state and backups under the base plan.

Pending transitions are expected evidence in a monitoring-only pilot. They do not make a daily window fail and do not need to be drained before final review.

## Revised daily sequence

For each separately authorized window:

1. Follow steps 1 through 8 of the base daily operating sequence.
2. Confirm the outbox preflight is read-only and uses the existing lifetime attempt cap.
3. Record aggregate scan, run-record, state-integrity, backup, cadence-skip, and pending-outbox results in restricted pilot evidence.
4. Do not perform base-plan steps 9 through 11. No delivery review, delivery authorization, or delivery invocation is permitted.
5. Confirm no Slack secret was loaded and no attempt or receipt was written.

The first stateful scan completed at `2026-08-11T01:09:20.440Z`. The earliest next authorized scan is `2026-08-12T01:09:20.440Z`. The configured standard-segment cadence is 72 hours, so intermediate authorized windows may validly record cadence skips rather than repeat detector work. Do not override cadence to manufacture detector executions or transitions.

## Revised success criteria

The pilot may pass only when all of these criteria are met:

- at least five separately authorized operating windows complete within the seven-day period;
- every completed stateful scan has exactly one immutable aggregate run record;
- expected cadence skips are recorded and do not trigger compensating scans;
- the cohort and probe targets never exceed the approved exact set;
- there are zero HubSpot writes, customer-facing actions, Slack deliveries, delivery attempts, delivery receipts, credential exposures, or committed operational files;
- every observed transition is explainable from protected state evidence and public probe behavior;
- every nonzero command, probe failure, state error, run-record error, or operator deviation is resolved and reviewed before completion;
- the state file, run records, and backups remain readable, internally consistent, and access controlled;
- the six day 1 transitions remain pending and unattempted unless a later reviewed amendment explicitly changes the delivery prohibition; and
- the pilot owner and reviewer sign the aggregate evidence record.

The synthetic Slack canary completed before this pilot remains separate delivery-path evidence. It is not live-pilot notification evidence.

## Final review limitation

The final evidence record and production release review must state that live Slack notification delivery was excluded from this pilot. This pilot alone cannot approve unattended Slack delivery or claim that Slack delivery was validated against the production cohort.

Any future live delivery requires a new reviewed plan, a separately authorized destination, a fresh read-only outbox preflight, exact limits, and explicit delivery authorization. Completing this monitoring-only pilot does not provide that authorization.

## Stop, rollback, and retention

Use the base plan's stop conditions, rollback procedure, and retention schedule, with these clarifications:

- Slack credential removal, rotation, and message cleanup are not applicable because no Slack credential or delivery is permitted.
- If a Slack credential is unexpectedly present, stop immediately, remove it, investigate exposure, and record the incident.
- Preserve pending transitions in normal protected state and backups during the pilot. Do not edit state as a rollback mechanism.
- At final disposition, retain or securely delete state, run records, backups, configuration, and the cohort manifest according to the base retention schedule and any documented incident hold.
