# Competitive Footprint Dry Run

The dry-run CLI composes the Competitive Footprint Monitor with one synthetic account, the DNS, HTTP subdomain, and TCP detectors, and in-memory read behavior. It performs no DNS lookup, HTTP request, TCP connection, persistence, or destination delivery.

## Run

```text
npm run dry-run:competitive-footprint
```

Use a fixed UTC timestamp for reproducible output:

```text
npm run dry-run:competitive-footprint -- --at 2026-08-07T12:00:00.000Z
```

## Output

The command prints a JSON report containing:

- the command, mode, and fixture identity;
- structured run status and counts;
- dry-run persistence and delivery intents;
- canonical detector and account identifiers;
- structured failures when a run does not succeed.

The synthetic adapters return positive observations for all three detectors. Guard storage and destination adapters throw if orchestration attempts a write, which makes the no-write guarantee executable in tests.

This command is an installation and composition check. It is not a live account scan and accepts no production domains or credentials.
