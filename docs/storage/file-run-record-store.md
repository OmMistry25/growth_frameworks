# File Run Record Store

The file run record store persists one immutable, aggregate record for each completed stateful Competitive Footprint scan. It is the initial single-host operational record sink and does not replace framework state or the transition outbox.

## Record boundary

Schema version 1 contains only:

- the framework and stateful execution mode;
- the canonical run ID and logical start and record time;
- dry-run and completion status;
- selected, processed, changed, unchanged, skipped, and failed counts; and
- aggregate counts for canonical failure categories.

Records exclude account IDs, company names, domains, detector IDs, evidence, observations, transitions, intents, operation keys, failure codes, failure messages, endpoints, provider payloads, and credentials.

## Persistence behavior

The store derives the filename from a SHA-256 digest of the validated run ID. It writes a same-directory temporary file with mode `0600`, syncs it, then creates the final file through an atomic no-overwrite link. The record directory is mode `0700` and symbolic-link directories or targets are rejected.

Writing the same run ID and exact content returns `duplicate`. Reusing the run ID with different content fails with a non-retryable conflict. Existing records are never overwritten.

Each stateful scan requires `--run-record-dir` together with `--allow-state-write`. The run record is written after framework state processing completes. A run-record failure makes the CLI fail, but it does not roll back framework state already committed during the scan.

## Operator use

Keep the run-record directory on the same protected single-host boundary as the state file. Back it up under the operational retention policy. Do not commit records to the repository or treat aggregate records as proof that an external notification was observed.

The record time is the command's canonical logical run time, which makes repeated invocation with the same run ID deterministic. Operators must use a unique logical time for a distinct invocation.

## Current limits

- Only completed stateful scan results are recorded. Startup, configuration, and process-level failures that occur before a result exists are not yet persisted.
- Scan state and the run record are separate durable writes, not one transaction.
- Delivery-only run records and a query or retention CLI remain follow-up work.
- The adapter is single-host storage and does not provide multi-host coordination.
