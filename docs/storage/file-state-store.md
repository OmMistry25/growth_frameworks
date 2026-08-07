# File Signal State Store

The file state store is a single-host persistence adapter for the Competitive Footprint Monitor. It implements the canonical `SignalStateStore` port and is intended for controlled CLI or worker deployments that do not yet require a database.

## Safety contract

- Construction requires `allowWrite: true`; callers must obtain explicit operator authorization before creating the adapter.
- The adapter rejects symbolic-link state targets.
- Each update acquires a same-directory lock, writes a mode-`0600` temporary file, flushes it, and atomically renames it over the target.
- A competing writer receives a retryable `conflict` error. The adapter does not silently merge stale snapshots.
- Invalid JSON or an unsupported schema fails closed without replacing the existing file.

## Stored data

Schema version 1 contains the latest state for each account/detector pair plus the observation and optional transition for every accepted operation. Operation identities survive process restarts, so replaying the same observation returns `duplicate`.

The file can contain account identifiers, detector evidence, and transition history. Treat it as sensitive operational data: keep it outside the repository, restrict filesystem access, and include it in backup and retention policy.

## Operational limits

This adapter supports one host and short write transactions. Lock directories are intentionally not auto-expired because deleting a live writer's lock can corrupt coordination. After an abnormal process termination, an operator must confirm no writer is active before removing `<state-file>.lock`.

Use a transactional database adapter before running multiple hosts or requiring stronger durability, querying, retention, or migration guarantees.
