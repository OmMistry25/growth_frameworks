# Growth Frameworks

Growth Frameworks is a collection of reusable, company-agnostic growth engineering tools. Each framework operates on shared GTM data contracts and supports replaceable source, storage, and destination connectors.

The project has completed the Phase 2 read-only source-integration checkpoint for its first vertical slice, the Competitive Footprint Monitor. The framework has not been released for unattended production use.

## Reference implementations

The initial framework designs are based on private reference implementations:

- `growth_at_console`
- `spy`

Reference repositories remain separate from this repository. Production data, credentials, and company-specific configuration must not be copied into this project.

## Repository status

Phase 0 established the architecture and transfer boundaries. Phase 1 implemented and validated the Competitive Footprint core, public probes, persistent state, durable transition outbox, bounded dispatcher, guarded CLIs, and Slack delivery through a synthetic non-production canary. Phase 2 added and validated the read-only HubSpot company source and exact-domain production canaries without enabling CRM writes.

The [Phase 2 exit review](./docs/phase-2-exit-review.md) records the evidence and remaining production gates. The initial release is notification-only: HubSpot signal writes remain out of scope. Current work is production-readiness policy and a limited-cohort pilot.

## License

No open-source license has been selected. All rights are reserved until a license is added explicitly.
