# Competitive Footprint HubSpot Dry Run

This command composes the read-only HubSpot company source with the public signal detectors. It is intentionally dry-run only: state persistence and external delivery use fail-closed no-write adapters.

## Required authorization and secret

The command requires both `--dry-run` and `--allow-network`. It accepts no credential argument or credential field. The HubSpot bearer token must be supplied through `HUBSPOT_ACCESS_TOKEN` in the process environment.

The `--hubspot-config` file contains only mapping, request bounds, and retry policy. Secret-like keys and unknown fields are rejected recursively.

## Command

```text
HUBSPOT_ACCESS_TOKEN='<read-only token>' \
npm run scan:competitive-footprint:hubspot -- \
  --config examples/competitive-footprint/config.json \
  --hubspot-config /secure/operations/hubspot-source.json \
  --dry-run \
  --allow-network
```

Use a HubSpot sandbox or test account and a token restricted to company-read scope. Do not use the synthetic example mapping unchanged until its property names and segment values have been matched to the sandbox portal.

## Guarantees and output

The command validates the safety flags, environment token, framework configuration, and non-secret HubSpot configuration before starting the scan. It reads companies, maps them to canonical accounts, performs configured public probes, and emits structured aggregate results.

It does not persist signal state or deliver transitions. Reports include account identifiers in intents and failures but exclude domains, provider bodies, and the token. Exit code `0` means the dry run completed successfully; partial or failed runs return `1`.
