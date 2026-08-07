# Growth at Console Reference Inventory

Reference commit: `d446d04fdf654bdbba253ae9615d37581523c99c`

## Capability summary

`growth_at_console` ingests recorded sales calls, normalizes conversations, runs extraction and qualification pipelines, enriches accounts, delivers findings, and provides dashboards for call, CRM, competitor, GEO, and website analysis.

## Domain package mapping

| Source area | Responsibility | Classification | Planned destination |
| --- | --- | --- | --- |
| `packages/core/src/types` | Normalized call contracts | shared | Canonical conversation contracts |
| `packages/core/src/ingestion` | Fathom ingestion, normalization, identity, no-show, and webhook verification | framework and source connector | Conversation ingestion framework plus Fathom connector |
| `packages/core/src/ingestion/gong` | Gong client, payload, verification, retry, and normalization | source connector | Gong connector |
| `packages/core/src/extraction` | Structured transcript extraction | framework | Call qualification framework extraction stage |
| `packages/core/src/evaluation` | Evaluation, rubric, and rules engine | framework | Call qualification framework |
| `packages/core/src/dealBrief` | Deal brief extraction | framework | Deal Briefs and Signal Extraction framework |
| `packages/core/src/consoleUseCases` | Closed taxonomy and evidence controls | framework and configuration | Generic signal taxonomy with company configuration |
| `packages/core/src/analysis` | GEO phrase extraction, clustering, and qualified-call selection | framework | GEO and Market Language Analysis framework |
| `packages/core/src/competitors` | Competitor research, pain extraction, scoring, and battlecards | framework | Competitor Intelligence and Battlecards framework |
| `packages/core/src/hubspot` | Qualified-stage gap detection | framework and connector | CRM Gap Detection framework plus HubSpot mapping |
| `packages/core/src/enrichment` | Apollo and HubSpot enrichment | source connector | Apollo and HubSpot connector packages |
| `packages/core/src/formatting` | HubSpot notes and Slack output | destination connector | HubSpot and Slack destinations |
| `packages/core/src/llm` | OpenAI retry wrapper | shared | Provider-neutral model execution contract and provider adapter |
| `packages/core/src/storage` | Supabase access and repositories | shared and connector | Storage contracts plus Postgres adapter |
| `packages/core/src/stack` | Prospect catalog matching and enrichment | framework candidate | Defer until its product boundary is specified |
| `packages/core/src/config` | Feature flags | shared | Validated framework configuration |
| `packages/core/src/pipeline` | No-show artifacts | framework | Conversation ingestion or qualification workflow |
| `packages/core/src/prompts` | Versioned LLM instructions | framework and configuration | Versioned framework prompt assets |
| `packages/core/src/scripts` | Imports, reprocessing, sync, and analysis commands | operations | Framework CLI and operational commands |
| `packages/worker` | Queue polling, locking, routing, and processing | shared | Framework runtime worker |

## Web application mapping

| Source area | Responsibility | Classification | Planned destination |
| --- | --- | --- | --- |
| `apps/web/app/api/webhooks` | Gong and Fathom webhook entry points | source connector | Connector API handlers |
| `apps/web/app/api/pipeline` | Pipeline control routes | framework and operations | Framework APIs with authorization policy |
| `apps/web/app/api/call-insights` | Citation-backed conversation query | framework | Conversation Insights framework API |
| `apps/web/app/api/competitors` | Competitor analysis control | framework | Competitor Intelligence API |
| `apps/web/app/api/geo-analysis` | Scheduled and manual GEO analysis | framework | GEO framework API and scheduler |
| `apps/web/app/api/hubspot` | CRM note and gap actions | destination connector | HubSpot destination API |
| `apps/web/app/api/admin` | Import and reprocess actions | operations | Framework administration API |
| `apps/web/app/dashboard/calls` | Call list and detail views | framework UI | Conversation and qualification UI module |
| `apps/web/app/dashboard/hubspot-qualified-gap` | CRM gap dashboard | framework UI | CRM gap UI module |
| `apps/web/app/dashboard/battlecards` | Battlecard dashboard | framework UI | Competitor intelligence UI module |
| `apps/web/app/dashboard/geo-analysis` | GEO analysis dashboard | framework UI | GEO UI module |
| `apps/web/app/dashboard/website-analytics` | Website metrics dashboard | framework UI | Website and Funnel Analytics UI module |
| `apps/web/app/dashboard/interactive-demos` | Console demo links | excluded | Company-specific content |
| `apps/web/lib/callInsights` | Conversation query tools | framework | Conversation Insights core tools |
| `apps/web/lib/hubspotGap.ts` | HubSpot gap page data access | connector | HubSpot connector or framework query layer |
| `apps/web/lib/websiteAnalytics.ts` | Website analytics data access | framework and connector | Website analytics framework plus provider connector |
| `apps/web/lib/supabase` | Web database clients | connector | Postgres and authentication adapters |
| `apps/web/components` | Dashboard components | framework UI and shared UI | Framework-specific or shared web packages |

## Schema and operations mapping

| Source area | Responsibility | Classification | Planned destination |
| --- | --- | --- | --- |
| `supabase/migrations` | Calls, evaluations, GEO, workflows, Gong, CRM gaps, and battlecards | shared and framework | New framework-owned migrations after schema review |
| `scripts` | Bulk ingestion and requeue operations | operations | Framework CLI commands |
| `.env.example` | Deployment and integration variables | configuration | Split validated configuration by connector and framework |
| `architecture.md` | Current system design | example | Architecture source material |
| `docs` | Product, pipeline, and deal brief documentation | example | Framework specifications and decisions |
| `tasks.md` | Historical implementation plan | excluded | Preserve only as reference history |
| `skill-creator-master-*.zip` | Unrelated archive | excluded | Do not transfer |
| `package-lock.json` | Reference dependency lock | excluded | Create a new lock from target dependencies |

## Company assumptions to remove

- Console qualification criteria and terminology
- Console product use-case taxonomy
- Console-specific prompts and examples
- Fixed HubSpot pipeline and property mappings
- Fixed Gong and Fathom assumptions
- Console dashboard branding and navigation
- Navattic demo links
- Fixed Slack messages and destinations
- Supabase, Vercel, and Railway as mandatory infrastructure
- Provider and model names embedded in framework behavior

## Data exclusions

- Credentials and local environment files
- Production transcripts
- Customer, contact, account, and opportunity data
- Production prompt outputs and evaluations
- Database exports
- Logs containing company or user data
- Generated archives and local state

## Transfer order

This reference will be processed after the Competitive Footprint Monitor reaches its release gate. Conversation Ingestion will be the first framework transferred from this repository.
