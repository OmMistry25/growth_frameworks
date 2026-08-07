# Package Boundaries

This document reserves package responsibilities and dependency rules. A directory should be created only when the active framework needs executable code in it.

## Planned workspace layout

```text
apps/
  cli/
  worker/
  api/
  web/
packages/
  contracts/
  runtime/
  frameworks/
    competitive-footprint/
  connectors/
    hubspot/
    slack/
  storage/
    memory/
    postgres/
  testing/
```

The layout is a namespace plan, not a requirement to create empty packages.

## Ownership table

| Package area | Owns | Must not own |
| --- | --- | --- |
| `packages/contracts` | Canonical schemas, port interfaces, shared result and error types | Vendor payloads, orchestration, network behavior |
| `packages/runtime` | Run context, cancellation, retry primitives, structured events, concurrency controls | Framework decisions, vendor policy, process entry points |
| `packages/frameworks/*` | Domain models, policy, state transitions, orchestration, framework configuration | Vendor SDKs, environment access, UI, deployment configuration |
| `packages/connectors/*` | Vendor clients, payload mapping, pagination, authentication, provider error translation | Cross-vendor business logic, framework state transitions |
| `packages/storage/*` | Implementations of canonical persistence ports and migrations owned by the adapter | Framework policy, source ingestion, notification formatting |
| `packages/testing` | Synthetic builders, contract suites, fake clock, in-memory test utilities | Production data, credentials, framework-specific assertions |
| `apps/*` | Configuration loading, dependency composition, transport handlers, lifecycle | Reusable domain behavior |

## Dependency rules

- `contracts` has no internal workspace dependencies.
- `runtime` may depend on `contracts`.
- A framework may depend on `contracts` and `runtime`.
- A connector may depend on `contracts` and narrowly scoped runtime primitives.
- A storage adapter may depend on `contracts` and its database client.
- `testing` may depend on `contracts` and `runtime`, but production packages must not depend on `testing`.
- An application may depend on any packages it composes.
- Framework-to-framework imports are prohibited. Shared behavior must earn a contract or runtime boundary through demonstrated use.
- Connector-to-connector imports are prohibited. Composition belongs in an application or framework orchestration layer.
- Cyclic workspace dependencies are prohibited.

## Public API rules

Each package exposes a deliberate public API through its package exports. Imports from another package's internal file paths are prohibited.

Public types must not expose vendor SDK types. Values that cross package boundaries must be serializable unless a port explicitly represents a process-local capability such as a clock or logger.

Breaking contract changes require a migration note and coordinated updates to every implementation and contract test.

## Competitive Footprint Monitor allocation

| Reference responsibility | Target owner |
| --- | --- |
| Domain normalization and signal interpretation | `packages/frameworks/competitive-footprint` |
| Probe interfaces and observation contracts | `packages/contracts` or the framework public API, based on reuse evidence |
| DNS, TXT, subdomain, and TCP probe implementations | A probe connector package created by the vertical slice |
| State, history, transitions, and due selection | `packages/frameworks/competitive-footprint` |
| HubSpot account reads and writes | `packages/connectors/hubspot` |
| Slack delivery | `packages/connectors/slack` |
| Persistent observation and run storage | A `packages/storage/*` adapter selected during implementation |
| CLI and scheduled execution | `apps/cli` and `apps/worker` when required |
| Synthetic parity fixtures | Framework tests with utilities from `packages/testing` |

## Boundary review questions

Before creating a new shared package, document:

1. Which active framework requires it?
2. Which two or more consumers need the same stable behavior?
3. What is its public contract?
4. Which layer owns its failures and configuration?
5. Can the active vertical slice remain simpler with the behavior local?

If there is only one consumer and no stable abstraction, keep the behavior in that consumer until evidence supports extraction.
