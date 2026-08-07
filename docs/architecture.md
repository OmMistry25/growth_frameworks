# Target Architecture

This document defines the target architecture for reusable growth frameworks. It describes dependency direction and runtime responsibilities without selecting infrastructure that a framework does not require.

## Design goals

- Keep framework behavior independent from any company, vendor, model provider, database, queue, or deployment platform.
- Make all external reads and writes replaceable through explicit ports.
- Validate company and connector assumptions at process boundaries.
- Support deterministic tests with synthetic fixtures and in-memory adapters.
- Record enough execution state to retry safely and explain an outcome.
- Add shared capabilities only when the active framework requires them.

## System layers

The system has four layers. Dependencies point inward.

```text
apps
  -> framework packages
       -> contract and runtime packages
connectors
  -> contract packages
```

### Contracts

Contracts define canonical data, ports, error categories, and execution records. They contain no vendor SDK imports, network calls, storage clients, or framework policy.

### Frameworks

Each framework owns one reusable growth capability. A framework contains domain policy, state transitions, orchestration, and configuration schemas. It consumes source, destination, storage, clock, and other external behavior through contracts.

Framework packages must not import connector packages or application code.

### Connectors

Connectors translate between external systems and canonical contracts. A source connector reads or receives external data. A destination connector performs an external write. A connector may implement both roles, but each role must remain separately testable.

Vendor pagination, authentication, retry hints, rate-limit metadata, and payload mapping belong in connectors. Business priority, framework state, and cross-vendor policy do not.

### Applications

Applications are composition roots. They load configuration, select adapters, construct a framework, expose an entry point, and manage process lifecycle. CLI, worker, API, scheduler, and dashboard code belongs here.

Applications may depend on frameworks and connectors. No package may depend on an application.

## Execution model

A framework run follows the same high-level lifecycle:

1. Accept a validated command and run context.
2. Read canonical input through a source port.
3. Select eligible work using framework policy.
4. Execute domain behavior with bounded concurrency.
5. Persist state and an idempotency record through storage ports.
6. Deliver selected results through destination ports.
7. Return a structured run result with counts, warnings, and failures.

The framework owns the order of these steps. An application owns invocation and shutdown. A connector owns external protocol behavior.

## Data and configuration boundaries

Canonical contracts contain normalized identifiers and domain values. Raw vendor payloads must not cross a connector boundary except in an explicitly typed diagnostic envelope that is disabled by default.

Configuration is divided into three scopes:

- Application configuration selects packages and operational limits.
- Connector configuration contains credentials, endpoints, and vendor mappings.
- Framework configuration contains company policy, labels, cadence, and thresholds.

Schemas must reject unknown or invalid values before external work begins. Secrets must be supplied at runtime and must not appear in framework configuration, fixtures, run records, or logs.

## Reliability rules

- Every external write requires an idempotency key or an equivalent reconciliation strategy.
- Retry policy distinguishes transient, rate-limited, permanent, validation, and authorization failures.
- Retries are bounded and preserve the original operation identity.
- Time-dependent behavior uses an injected clock.
- A partial failure is represented explicitly. It must not be reported as a successful run.
- Logs use stable event names and structured fields. Sensitive values are redacted at the boundary that receives them.
- Dry-run mode executes reads and decisions but replaces external writes with recorded intents.

## Testing strategy

Testing proceeds from the center outward:

- Contract tests validate canonical schemas and port behavior.
- Framework unit tests use deterministic in-memory adapters.
- Golden parity tests encode sanitized behavior from a pinned reference commit.
- Connector tests use synthetic payloads and provider sandboxes or recorded fixtures when permitted.
- Application smoke tests prove configuration, composition, dry-run behavior, and clean shutdown.

Reference behavior is evidence, not an architectural dependency. A parity fixture records the reference commit and the behavior it protects.

## Initial vertical slice

The Competitive Footprint Monitor is the first vertical slice. It will introduce only the contracts, runtime behavior, connectors, storage, and entry points required to:

- read accounts from a replaceable source;
- normalize and probe account domains;
- evaluate current signals against prior state;
- persist observations and transitions;
- route idempotent CRM updates and notifications;
- run safely in dry-run mode.

Capabilities needed only by later frameworks remain deferred.
