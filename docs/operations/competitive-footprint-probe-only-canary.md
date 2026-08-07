# Competitive Footprint Probe-Only Canary

The probe-only canary diagnoses one explicitly authorized public domain without contacting HubSpot or any other CRM. It constructs one in-memory canonical account and runs the configured DNS, HTTP, and TCP detectors.

The command requires `--dry-run`, `--allow-network`, and `--probe-only-canary`. It accepts no company ID, CRM credential, token argument, state file, or delivery configuration. State and destination adapters fail closed on writes.

Output uses the shared redacted canary contract: aggregate counts plus detector ID, completion status, canonical category, sanitized failure code, and retryability. It excludes the domain, derived endpoints, run IDs, operation keys, failure messages, evidence, and intents.

Do not execute the command from documentation alone. Record separate approval for the exact domain, derived probe targets, and one execution.
