# Competitive Footprint Network Dry Run

The network dry-run CLI loads validated configuration and account files, performs configured public DNS, HTTP subdomain, and TCP probes, and returns persistence and delivery intents without executing any write.

## Required authorization

The command refuses to run unless both safety flags are present:

- `--dry-run` guarantees the framework does not call storage or destination writes.
- `--allow-network` confirms that public network reads are intentional.

There is no write-enabled mode.

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
4. Uses no-write state and destination adapters.
5. Prints structured JSON without account domains or raw probe responses.

Exit code `0` indicates a successful run. Partial or failed runs and invalid input return exit code `1` with a concise error.

## Data handling

Account identifiers can appear in structured intents and failures. Raw account domains, DNS records, HTTP bodies, socket data, and credentials are not printed. Review account identifiers before sharing output.
