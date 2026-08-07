# Spy Reference Inventory

Reference commit: `44e5d95e1df903f22fa401f02eb7c8bd58d6838e`

## Capability summary

`spy` reads CRM company domains, probes external competitor signals, records signal history, identifies state changes, writes selected findings to HubSpot, and routes alerts to Slack.

## Source mapping

| Source | Responsibility | Classification | Planned destination |
| --- | --- | --- | --- |
| `check_serval_domains.py` | Domain parsing and DNS, TXT, subdomain, and TCP probes | framework | `packages/frameworks/competitive-footprint` detector modules |
| `registry.py` | State, cadence, transition, history, and diff behavior | framework | Competitive footprint signal and state engine |
| `run_daily.py` | Source ingestion, due selection, execution, routing, and CLI behavior | shared and framework | Framework runtime plus competitive footprint runner |
| `sources/hubspot.py` | HubSpot companies, opportunities, owners, stages, pagination, and retries | source connector | `packages/connectors/hubspot` |
| `routing/hubspot_writer.py` | HubSpot property setup and signal writes | destination connector | HubSpot destination package with mapped properties |
| `routing/slack.py` | Immediate alerts, digest, and heartbeat | destination connector | `packages/connectors/slack` |
| `demo_registry.py` | State transition walkthrough | example | Sanitized parity fixtures and example runner |
| `demo_sources.py` | Source behavior demonstration | example | Connector test fixtures |
| `demo_writer.py` | Writer behavior demonstration | example | Destination test fixtures |
| `build_fixture.py` | Local fixture generation | example | Shared testing utilities if still needed |
| `KICKOFF.md` | Original product and architecture specification | example | Framework specification source material |
| `KICKOFF_v1_1.md` | Revised churn and signal interpretation | example | Parity requirements and decision history |
| `requirements.txt` | Python runtime dependencies | excluded | Re-evaluate dependencies in the target runtime |
| `env.example` and `.env.example` | Integration configuration | configuration | Validated connector and framework configuration |
| `serval_detection_methods_detected_only_clean.csv` | Detected domains | excluded | Never transfer production or company data |
| `state.json` | Production monitoring state | excluded | Never transfer production state |

## Company and vendor assumptions to remove

- Serval identity and detection templates
- HubSpot as the only account source
- HubSpot stages as the priority model
- Fixed `spy_*` property names
- Slack webhook as the only notification route
- JSON file storage
- Fixed daily, three-day, fourteen-day, and thirty-day cadences
- Fixed confirmed, historical, possible, and lost labels
- Serval-specific alert copy

## Required parity cases

- Domain normalization
- New positive detection
- Confidence upgrade
- Subdomain responsiveness loss
- TXT-only history without false churn classification
- Signal restoration
- Low-confidence subdomain-only observation
- Due-date calculation by account segment and state
- Repeated run idempotency
- Missing CRM match handling
- HubSpot pagination, retries, property reconciliation, and writes
- Slack immediate alert, digest, quiet run, and rate limiting

## Exclusion decision

No contents from `state.json` or the detected-domain CSV may enter this repository, fixtures, logs, tests, documentation, commits, or pull requests.
