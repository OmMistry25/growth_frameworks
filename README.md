# Growth Frameworks

Growth Frameworks is a collection of reusable, company-agnostic growth engineering tools. Each framework operates on shared GTM data contracts and supports replaceable source, storage, and destination connectors.

The project has completed Phase 1 implementation validation for its first vertical slice, the Competitive Footprint Monitor. The framework has not been released for unattended production use.

## Reference implementations

The initial framework designs are based on private reference implementations:

- `growth_at_console`
- `spy`

Reference repositories remain separate from this repository. Production data, credentials, and company-specific configuration must not be copied into this project.

## Repository status

Phase 0 established the architecture and transfer boundaries. Phase 1 implemented and validated the Competitive Footprint core, public probes, persistent state, durable transition outbox, bounded dispatcher, guarded CLIs, and Slack delivery through a synthetic non-production canary.

The [Phase 1 exit review](./docs/phase-1-exit-review.md) records the evidence and remaining production gates. Current work is the Phase 2 read-only source-integration checkpoint, beginning with a HubSpot connector backed by synthetic contract tests and a sandbox dry run.

## License

No open-source license has been selected. All rights are reserved until a license is added explicitly.
