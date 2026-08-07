# Transition Outbox Dispatcher

The runtime dispatcher coordinates a canonical transition outbox with exactly one authorized destination. It is intentionally independent of the Competitive Footprint framework and Slack connector.

## Processing order

For each pending transition, the dispatcher:

1. skips the item when its durable attempt count has reached the configured cap;
2. persists a new attempt with the current time;
3. invokes the destination once;
4. persists a delivered receipt only after destination success.

Each invocation has a pending-item limit from 1 to 100 and a lifetime attempt cap from 1 to 10. The dispatcher makes no immediate retry and performs no sleeping. A worker or scheduler owns later invocations and provider-specific backoff.

Attempt acquisition uses the pending item's expected durable attempt count as an optimistic concurrency check. If another dispatcher acquires the item first, the stale dispatcher skips it without calling the destination.

## Outcomes

The result separately counts successful deliveries, retryable failures, terminal failures, exhausted items, and items skipped because another actor already changed their outbox state. Failures identify their stage without including destination credentials.

A receipt-write failure is marked with `duplicateRisk: true`: the destination already returned success, but the outbox remains pending. This is the unavoidable at-least-once crash window for destinations such as Slack incoming webhooks that do not accept an idempotency key.

## Safety limits

- Dry-run contexts are rejected.
- Bounds are validated before the outbox is read.
- Attempts are persisted before side effects.
- Non-`PortOperationError` failures are classified as retryable transient failures without exposing their original message.
- The dispatcher does not own credentials, network clients, scheduling, or framework state decisions.

This package is not yet composed into an executable application path.
