# Phase 0 Exit Review

Phase 0 establishes the evidence and boundaries required to begin the first framework transfer. It does not include production framework code.

## Completed evidence

- [x] Repository purpose and implementation order are documented.
- [x] Engineering, branch, commit, pull request, and transfer standards are documented.
- [x] Reference repositories are pinned to reviewed commits.
- [x] Relevant source areas are classified with planned destinations or exclusions.
- [x] Company, vendor, data, credential, generated-output, and local-state exclusions are explicit.
- [x] Required parity cases for the first framework are listed.
- [x] Target architecture and dependency direction are documented.
- [x] Package responsibilities and public boundary rules are documented.

## Approved review decisions

The following decisions were approved on August 7, 2026:

- [x] The pinned `spy` commit remains the accepted parity baseline.
- [x] Competitive Footprint Monitor is the only active transfer.
- [x] The target architecture and package boundary plan are approved.
- [x] The first slice starts with an in-memory storage adapter. Persistent storage is deferred until its contract is exercised.
- [x] DNS, TXT, subdomain, and TCP probes begin in one connector package. They may separate when their operational requirements diverge.
- [x] The repository retains Node.js 24 and npm 11 as its minimum toolchain.

## Implementation-entry checklist

The first implementation change may begin now that the review decisions above are recorded. Its scope must include:

- sanitized golden fixtures for the listed parity cases;
- a framework specification with inputs, outputs, states, and failure behavior;
- canonical account, observation, transition, and run contracts;
- an in-memory adapter for deterministic tests;
- validated configuration with no embedded Serval or HubSpot policy;
- dry-run semantics and an idempotency strategy before any external write;
- a traceability link from each parity fixture to the pinned reference commit.

## Deferred decisions

The following decisions are intentionally deferred until demanded by a vertical slice:

- queue and scheduler products;
- cloud and deployment platform;
- web application framework and shared UI system;
- model provider and prompt management platform;
- authentication and authorization product;
- packages for frameworks after Competitive Footprint Monitor.

Deferral prevents infrastructure choices from becoming framework requirements without implementation evidence.
