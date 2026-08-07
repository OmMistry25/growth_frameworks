# Framework Catalog

This catalog defines the planned implementation order. Only one framework may be in active transfer at a time.

| Order | Framework | Primary reference | Status |
| --- | --- | --- | --- |
| 1 | Competitive Footprint Monitor | `spy` | Active transfer |
| 2 | Conversation Ingestion | `growth_at_console` | Planned |
| 3 | Call Qualification | `growth_at_console` | Planned |
| 4 | Deal Briefs and Signal Extraction | `growth_at_console` | Planned |
| 5 | CRM Gap Detection | `growth_at_console` | Planned |
| 6 | Conversation Insights | `growth_at_console` | Planned |
| 7 | Competitor Intelligence and Battlecards | `growth_at_console` | Planned |
| 8 | GEO and Market Language Analysis | `growth_at_console` | Planned |
| 9 | Website and Funnel Analytics | `growth_at_console` | Planned |

## Shared platform capabilities

The framework implementations will introduce shared capabilities only when required by the active framework:

- Canonical GTM contracts
- Validated configuration
- Source and destination connector contracts
- Storage contracts
- Framework runtime
- Structured logs and run records
- Retry, timeout, and rate-limit policies
- Synthetic fixtures and connector contract tests
- CLI, worker, API, and dashboard entry points

## Transfer rule

The next framework does not begin until the active framework satisfies its specification, parity, configuration, operations, documentation, and release gates.
