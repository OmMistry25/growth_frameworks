# Competitive Footprint Pilot Evidence Template

Use this template after the monitoring-only pilot has completed or stopped. Replace every bracketed field, remove instructional text, and submit the completed aggregate record for review in a separate pull request.

Generate and validate the source aggregates with the read-only [pilot evidence compiler](./competitive-footprint-pilot-evidence-compiler.md). Compiler readiness does not replace the owner or reviewer decisions in this template.

Do not include company IDs, names, domains, detector IDs, operation keys, endpoints, credentials, raw state, manifests, backups, run-record contents, provider payloads, or local filesystem paths.

## Evidence identity

| Field | Aggregate value |
| --- | --- |
| Pilot mode | Monitoring-only |
| Reviewed implementation commit | `[commit]` |
| Protected CI result | `[pass or fail, with reviewed run link]` |
| Planned period | `[start UTC]` through `[end UTC]` |
| Actual period | `[first window UTC]` through `[final disposition UTC]` |
| Approved cohort size | `[count only]` |
| Authorized operating windows | `[count]` |
| Completed operating windows | `[count]` |
| Pilot owner | `[reviewed role or repository identity]` |
| Reviewer | `[reviewed role or repository identity]` |

## Window summary

Use one row per authorized window. Counts must come from the immutable aggregate run record and read-only outbox preflight. Do not copy record identifiers or detector-level details.

| Window | Authorized at UTC | Completed at UTC | Selected | Processed | Changed | Unchanged | Skipped | Failed | Run record | Backup | Pending | Never attempted | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| 1 | `[timestamp]` | `[timestamp]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[present or missing]` | `[verified or missing]` | `[count]` | `[count]` | `[pass, stop, or deviation]` |
| 2 | `[timestamp]` | `[timestamp]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[present or missing]` | `[verified or missing]` | `[count]` | `[count]` | `[pass, stop, or deviation]` |
| 3 | `[timestamp]` | `[timestamp]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[present or missing]` | `[verified or missing]` | `[count]` | `[count]` | `[pass, stop, or deviation]` |
| 4 | `[timestamp]` | `[timestamp]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[present or missing]` | `[verified or missing]` | `[count]` | `[count]` | `[pass, stop, or deviation]` |
| 5 | `[timestamp]` | `[timestamp]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[count]` | `[present or missing]` | `[verified or missing]` | `[count]` | `[count]` | `[pass, stop, or deviation]` |

Add rows only for separately authorized windows. Do not create a row for an informal check, a failed pre-execution gate, or a command that did not invoke the stateful scanner.

## Aggregate totals

| Measure | Total |
| --- | ---: |
| Selected detector operations | `[count]` |
| Processed detector operations | `[count]` |
| Changed observations | `[count]` |
| Unchanged observations | `[count]` |
| Cadence skips | `[count]` |
| Failed detector operations | `[count]` |
| Created run records | `[count]` |
| Verified backups | `[count]` |
| Pending transitions at completion | `[count]` |
| Never-attempted transitions at completion | `[count]` |
| Delivery attempts | `0` |
| Delivery receipts | `0` |
| Slack deliveries | `0` |
| CRM reads during daily windows | `0` |
| CRM writes | `0` |
| Stop events | `[count]` |
| Rollbacks | `[count]` |
| Incidents | `[count]` |

## Integrity and safety review

Record `pass`, `fail`, or `not applicable` with a concise aggregate explanation.

| Control | Result | Aggregate explanation |
| --- | --- | --- |
| Exact cohort size remained unchanged | `[result]` | `[explanation]` |
| Probe target set remained unchanged | `[result]` | `[explanation]` |
| Every completed scan has one immutable run record | `[result]` | `[explanation]` |
| State, run records, and backups remained access controlled | `[result]` | `[explanation]` |
| Every pending transition remained unattempted | `[result]` | `[explanation]` |
| No Slack credential was loaded | `[result]` | `[explanation]` |
| No Slack delivery occurred | `[result]` | `[explanation]` |
| No CRM write occurred | `[result]` | `[explanation]` |
| No operational artifact or secret entered the repository | `[result]` | `[explanation]` |
| Every nonzero result or deviation was reviewed | `[result]` | `[explanation]` |

## Failures, deviations, and incidents

For each event, include only its category, window number, effect, disposition, and reviewer outcome. Write `None` when there were no events.

`[aggregate event record or None]`

## Monitoring-only limitation

Live Slack notification delivery was excluded from this pilot. Synthetic Slack evidence remained separate. This pilot does not validate Slack delivery against the production cohort and cannot authorize unattended Slack delivery.

## Retention disposition

| Artifact class | Disposition | Completion date UTC | Verified by |
| --- | --- | --- | --- |
| Restricted cohort manifest and configuration | `[retain until date or deleted]` | `[timestamp]` | `[reviewer]` |
| State and backups | `[retain until date or deleted]` | `[timestamp]` | `[reviewer]` |
| Run records and detailed local reports | `[retain until date or deleted]` | `[timestamp]` | `[reviewer]` |
| Pilot credentials | `[absent or deleted]` | `[timestamp]` | `[reviewer]` |

## Owner decision

- Decision: `[pass, extend, or fail]`
- Rationale: `[aggregate rationale]`
- Decision time UTC: `[timestamp]`
- Pilot owner approval: `[recorded approval]`

## Reviewer decision

- Decision: `[concur, reject, or request changes]`
- Rationale: `[aggregate rationale]`
- Review time UTC: `[timestamp]`
- Reviewer approval: `[recorded approval]`

Pilot passage permits only a separate production release review. It does not enable scheduling, hosting, multi-host state, Slack delivery, CRM writes, or another framework transfer.
