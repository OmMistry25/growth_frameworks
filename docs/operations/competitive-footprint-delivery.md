# Competitive Footprint Transition Delivery

The delivery-only CLI drains pending transitions from an existing file-state outbox into one Slack incoming webhook. It does not scan accounts, perform probes, or create transitions.

## Required authorization

The command refuses to run unless all three flags are present:

- `--allow-network` authorizes the Slack HTTPS request;
- `--allow-state-write` authorizes durable attempt and receipt updates;
- `--allow-delivery` authorizes the external message side effect.

The Slack webhook URL is accepted only through the `SLACK_WEBHOOK_URL` environment variable. It cannot be supplied in command arguments or configuration files. Prefer injecting it from a secret manager rather than placing it directly in shell history.

## Preflight

Before the first delivery, inspect and back up the state file. Schema v1 transitions are conservatively treated as pending after migration and may represent historical items.

Run the read-only aggregate preflight with the same attempt cap planned for delivery:

```text
npm run preflight:competitive-footprint -- \
  --state-file /secure/operations/competitive-footprint-state.json \
  --max-attempts 3
```

The report contains counts only and identifies both the interpreted schema and source schema. `ready` means at least one pending item is deliverable, `empty` means none are currently deliverable, and `attention` means the source is legacy schema v1 or one or more items have reached the attempt cap. The command exits nonzero for `attention`, invalid or corrupted state, and a missing file.

Use a webhook connected to a non-production Slack channel for initial validation. The connector itself validates only the endpoint shape; invoking this command can send real messages.

## Run

```text
SLACK_WEBHOOK_URL="<injected-secret>" npm run deliver:competitive-footprint -- \
  --state-file /secure/operations/competitive-footprint-state.json \
  --allow-network \
  --allow-state-write \
  --allow-delivery \
  --limit 25 \
  --max-attempts 3
```

The command makes at most one attempt per selected transition in an invocation. It exits `0` only when there are no retryable failures, terminal failures, or exhausted items. A receipt failure reports `duplicateRisk: true` because Slack may have accepted the message while the transition remains pending.

Stop after any nonzero result. Follow the [delivery failure policy](./competitive-footprint-delivery-failure-policy.md) before another invocation. Terminal failures remain pending, exhausted items are not sent, and duplicate-risk items must not be replayed automatically.

## Secret and output handling

The structured report never includes the webhook URL. It can include account IDs, detector IDs, transition idempotency keys, and failure messages. Treat it as operational data.

Rotate the webhook immediately if it appears in logs, shell history, a committed file, or shared output.
