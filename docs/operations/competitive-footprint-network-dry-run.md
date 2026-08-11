# Competitive Footprint Network Scan

The network scan CLI loads validated configuration and account files and performs configured public DNS, HTTP subdomain, and TCP probes. It supports a no-write dry run and an explicitly authorized stateful mode. Neither mode performs external delivery.

## Required authorization

The command refuses to run unless both safety flags are present:

- `--dry-run` guarantees the framework does not call storage or destination writes.
- `--allow-network` confirms that public network reads are intentional.

Stateful mode instead requires `--allow-state-write`, `--state-file FILE`, and `--run-record-dir DIRECTORY`. The modes are mutually exclusive.

## Run

Start with the synthetic examples:

```text
npm run scan:competitive-footprint -- \
  --config examples/competitive-footprint/config.json \
  --accounts examples/competitive-footprint/accounts.json \
  --dry-run \
  --allow-network
```

Use a fixed time for reproducible operation identifiers:

```text
npm run scan:competitive-footprint -- \
  --config examples/competitive-footprint/config.json \
  --accounts examples/competitive-footprint/accounts.json \
  --dry-run \
  --allow-network \
  --at 2026-08-07T12:00:00.000Z
```

## Behavior

The command:

1. Validates both files completely before constructing probe adapters.
2. Performs only the configured public network reads.
3. Applies public-address, timeout, redirect, response-size, port, and TLS safeguards.
4. Uses a no-write state adapter in dry-run mode or the atomic file store in stateful mode.
5. Configures no destinations, so stateful execution cannot deliver transitions externally.
6. Prints structured JSON without account domains or raw probe responses.

## Stateful run

Keep the state file outside the repository and restrict access to it:

```text
npm run scan:competitive-footprint -- \
  --config examples/competitive-footprint/config.json \
  --accounts examples/competitive-footprint/accounts.json \
  --allow-network \
  --allow-state-write \
  --state-file /secure/operations/competitive-footprint-state.json \
  --run-record-dir /secure/operations/competitive-footprint-runs
```

The command validates all inputs before creating network or storage adapters. A stateful report includes `deliveryEnabled: false` and whether its immutable aggregate run record was created or already existed. See the [file state store runbook](../storage/file-state-store.md) for state locking and recovery limits and the [file run record store](../storage/file-run-record-store.md) for the record schema, retention boundary, and failure semantics.

Exit code `0` indicates a successful run. Partial or failed runs and invalid input return exit code `1` with a concise error.

## Data handling

Account identifiers can appear in structured intents and failures. Raw account domains, DNS records, HTTP bodies, socket data, and credentials are not printed. Review account identifiers before sharing output.
