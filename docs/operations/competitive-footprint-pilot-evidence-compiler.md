# Competitive Footprint Pilot Evidence Compiler

The pilot evidence compiler reads protected monitoring-only pilot artifacts and emits repository-safe aggregate evidence. It performs no network requests, CRM access, state writes, delivery attempts, or Slack delivery.

## Command

```bash
npm run evidence:competitive-footprint:pilot -- \
  --pilot-evidence \
  --state-file /absolute/path/to/state.json \
  --run-record-dir /absolute/path/to/runs \
  --backup-dir /absolute/path/to/backups \
  --expected-windows 5 \
  --max-attempts 3
```

The explicit `--pilot-evidence` gate is required exactly once. All paths must be absolute and distinct. The command rejects network, state-write, delivery, webhook, and CRM arguments.

## Input controls

The compiler fails closed unless:

- the state path is a regular file with no group or other access;
- the run-record and backup paths are regular directories with no group or other access;
- no accepted file or directory is a symbolic link;
- each run-record filename uses the immutable digest form;
- each run record is bounded, valid, stateful, aggregate-only, and uniquely identified;
- each backup window contains only `state.json` and `run-record.json` with restricted permissions; and
- each backed-up run record exactly matches one immutable record in the run-record directory.

The compiler opens the signal state store in read-only mode and inspects outbox aggregates with the reviewed lifetime attempt cap. It never lists pending transition contents.

## Output

The JSON report contains only:

- completed, expected, and remaining window counts;
- aggregate selected, processed, changed, unchanged, skipped, and failed totals;
- aggregate failure-category totals;
- verified backup count and completeness;
- aggregate outbox counts; and
- boolean completion and monitoring-only safety controls.

It does not include company identities, domains, detector IDs, operation keys, endpoints, filesystem paths, state contents, record identities, credentials, or provider payloads.

## Status and exit behavior

| Status | Meaning | Exit code |
| --- | --- | ---: |
| `in_progress` | Safety controls pass, but fewer than the expected windows are complete | 0 |
| `ready_for_review` | Expected windows are complete and all compiler controls pass | 0 |
| `attention` | A run failed, a backup is incomplete, or delivery-safety evidence is not clean | 1 |

Malformed, unsafe, ambiguous, missing, or unreadable input also exits nonzero with a sanitized error. A successful `ready_for_review` result does not itself pass the pilot or approve production operation. Copy only reviewed aggregates into the [pilot evidence template](./competitive-footprint-pilot-evidence-template.md), then obtain separate owner and reviewer decisions.
