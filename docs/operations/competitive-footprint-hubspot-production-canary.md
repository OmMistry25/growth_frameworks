# Competitive Footprint HubSpot Production Canary

The production canary is a dry-run-only command for one explicitly allowlisted HubSpot company. It exists for a narrowly authorized validation when a test portal is unavailable.

## Safeguards

The command requires `--dry-run`, `--allow-network`, and `--production-canary`. It uses HubSpot's single-company endpoint with a numeric record ID and requests only `name` and `domain`. Before any probe runs, the returned record ID and normalized domain must exactly match the supplied allowlist. The canonical segment is supplied locally and does not require modifying HubSpot.

State writes and external delivery use fail-closed no-write adapters. The report contains aggregate counts and failure categories only; it excludes company IDs, names, domains, tokens, intents, and provider bodies.

The bearer token must be supplied through `HUBSPOT_ACCESS_TOKEN` and should have only `crm.objects.companies.read`. Never put the token in arguments or configuration files.

## Authorization boundary

Do not run this command from documentation alone. Record separate approval for the exact company ID, expected domain, configured probes, and one execution. Delete or revoke the temporary credential after reviewing the sanitized result.
