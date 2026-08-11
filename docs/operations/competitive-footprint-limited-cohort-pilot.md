# Competitive Footprint Limited-Cohort Pilot

This plan defines the first production pilot for the Competitive Footprint Monitor. It is a notification-only, manually operated evaluation. It does not approve unattended scheduling, HubSpot writes, broad CRM reads, automatic Slack delivery, or production release.

## Default pilot envelope

| Control | Default |
| --- | --- |
| Cohort size | 3 exact companies |
| Duration | 7 consecutive calendar days |
| Scan frequency | At most 1 manually authorized stateful scan per 24-hour window |
| Source | Access-controlled local cohort manifest, verified through exact-ID read-only HubSpot requests |
| Public probes | Only the configured DNS, HTTPS, and TLS targets derived from each approved domain |
| State | One dedicated pilot state file |
| Run records | One dedicated pilot run-record directory |
| Delivery | Dedicated non-production Slack pilot channel, reviewed and authorized separately after preflight |
| Delivery limit | Exact preflight deliverable count, capped at 9 |
| Lifetime delivery cap | 3 attempts |
| CRM writes | Prohibited |
| Automation | Prohibited |

Any change to the cohort, duration, frequency, probe targets, destination, limits, storage paths, or credential scope requires a reviewed plan amendment and new authorization.

## Roles

- **Pilot owner:** approves the exact cohort, accepts pilot risk, and makes stop, resume, and completion decisions.
- **Operator:** performs the checklist, protects credentials and local files, records aggregate evidence, and stops on any deviation.
- **Reviewer:** verifies configuration, preflight results, delivery limits, incidents, and the final evidence record independently of the operator action.
- **Service owner:** owns Slack and HubSpot configuration and responds to terminal, exhausted, duplicate-risk, or credential-exposure events.

One person may hold multiple roles, but the operator must obtain an explicit recorded approval before each side-effecting scan or delivery action.

## Cohort selection

Select exactly three companies that satisfy all criteria:

- the pilot owner is authorized to process the company record and public domain;
- the HubSpot company ID is exact, active, and maps to one canonical account;
- the company has one unambiguous normalized public domain;
- the configured public probe targets are expected and approved;
- the company is not under deletion, legal hold, security investigation, or active data-correction work;
- the company is not a test of sensitive or regulated-person data; and
- monitoring and pilot notifications will not create customer-facing communication.

Prefer a mixed cohort with at least one expected positive signal and one expected negative or quiet result. Do not select accounts merely to force a notification.

Exclude companies with ambiguous domains, shared domains, multiple conflicting CRM records, archived records, unreviewed lifecycle mappings, or probe targets that resolve to private or local addresses.

## Cohort manifest

The exact company IDs, domains, local account IDs, and segment assignments belong in an access-controlled local manifest outside the repository. The manifest must:

- use the validated account-file schema;
- contain exactly the three approved accounts and no additional records;
- be mode `0600` or protected by an equivalent access control;
- have a recorded SHA-256 digest for review;
- contain no HubSpot token, Slack webhook, notes, owner data, or raw provider payload; and
- be deleted according to the retention schedule.

The repository and pull requests must contain only aggregate pilot evidence. Do not commit the manifest, state, run records, reports, backups, credentials, domains, or company IDs.

## Authorization boundaries

Planning and CI do not authorize production activity. Before pilot execution, record separate approvals for:

1. **Cohort verification:** the three exact HubSpot company IDs, one read-only request per ID, at most two attempts per request, expected domains, no CRM writes, and redacted output.
2. **Probe dry run:** the three exact domains and every derived DNS, HTTPS, and TLS target, no state writes, and no delivery.
3. **Stateful scan:** one invocation, the exact cohort-manifest digest, exact probe targets, dedicated state and run-record paths, network access, and state writes, with no delivery.
4. **Delivery:** one invocation, the exact state file, approved pilot Slack destination, preflight count, `--limit`, lifetime attempt cap, network access, state writes, and delivery.

Approval for one step does not authorize another step or a later day. HubSpot access remains read-only. Slack delivery remains a separate command after review.

## Entry gates

All gates must pass before day 1:

- protected `main` CI passes on the pilot baseline;
- 145 or more automated tests and TypeScript typechecking pass;
- dependency audit reports no high-severity vulnerability;
- the exact cohort manifest and configuration pass the [pilot preflight](./competitive-footprint-pilot-preflight.md), and both reported digests receive review;
- exact-ID HubSpot reads confirm each ID-to-domain mapping without CRM writes;
- a probe-only dry run completes for every exact domain and approved target;
- the pilot state file, run-record directory, and backup location are dedicated, absent or empty, and outside the repository;
- a dedicated non-production Slack channel and webhook are confirmed;
- preflight, delivery-failure, rollback, retention, and credential-removal procedures are reviewed;
- the operator has a stop mechanism and no scheduler or background worker is active; and
- the pilot owner records the start time, planned end time, cohort size, and authorized roles.

If any gate fails, do not start the pilot.

## Daily operating sequence

Perform these steps once per authorized 24-hour window:

1. Confirm the cohort-manifest digest, configuration digest, state path, run-record path, current branch or commit, and absence of other writers.
2. Confirm only the secrets required for the authorized step are available through the approved secret store without printing them. Daily scanning needs no HubSpot token. Load the Slack webhook only after delivery approval.
3. Run the exact-domain no-write probe diagnostic when targets or DNS have changed since the last successful window. Stop on any unapproved target or failure.
4. Obtain authorization for one stateful scan.
5. Run the stateful scan with a unique canonical `--at` time and the dedicated state and run-record paths.
6. Stop if the scan exits nonzero, the run record is missing, the report contains an unexpected account count, or any configured target differs from approval.
7. Back up the state file and new run record to restricted pilot storage.
8. Run read-only outbox preflight with `--max-attempts 3`.
9. Review each proposed transition against the approved cohort and expected detector behavior. Preflight is aggregate-only, so do not deliver when the selected items cannot be reconciled from protected state evidence.
10. If deliverable items exist, obtain a separate delivery authorization using the exact count as `--limit`, capped at 9.
11. Run delivery once. Stop on any retryable, terminal, exhausted, skipped, or duplicate-risk outcome and follow the [delivery failure policy](./competitive-footprint-delivery-failure-policy.md).
12. Repeat read-only preflight and record the aggregate outcome in the restricted pilot log.
13. Remove secrets from the process environment and confirm no credential was written to reports, shell history, state, run records, or the repository.

Do not compensate for a missed daily window by running twice in the next window.

## Success criteria

The pilot may pass only when all criteria are met:

- at least 5 authorized daily windows complete within the 7-day period;
- every completed stateful scan has one immutable run record;
- the cohort and probe targets never exceed the approved exact set;
- there are zero HubSpot writes, customer-facing actions, unauthorized deliveries, credential exposures, or committed operational files;
- there are zero terminal, exhausted, or unresolved duplicate-risk delivery outcomes;
- every delivered notification maps to an approved account, detector, and persisted transition;
- every observed transition is explainable from protected state evidence and public probe behavior;
- all nonzero commands, retryable failures, skipped items, and operator deviations are resolved and reviewed before completion;
- the state file and run records remain readable, internally consistent, and backed up; and
- the pilot owner and reviewer sign the aggregate evidence record.

The absence of a natural transition is not a failure and does not authorize manufacturing a production event. Existing synthetic Slack evidence remains the delivery-path control when the pilot is quiet.

## Stop conditions

Stop immediately and revoke all pending authorizations when any condition occurs:

- cohort ID or domain mismatch;
- unapproved DNS, HTTPS, TLS, redirect, or destination target;
- private-address or public-address-policy rejection;
- CRM write attempt or credential scope broader than read-only company access;
- state corruption, symbolic-link rejection, lock conflict, missing run record, or run-record conflict;
- nonzero stateful scan or delivery result;
- terminal, exhausted, skipped, or duplicate-risk delivery outcome;
- unexpected notification, duplicate notification, or customer-facing communication;
- secret exposure or operational data committed to the repository;
- concurrent writer, scheduler, or automation activity;
- inability to reconcile preflight counts with protected state evidence; or
- pilot owner, operator, reviewer, or service owner requests a stop.

Do not resume on verbal assumption. Record the cause, preserve evidence, complete remediation, repeat affected entry gates, and obtain explicit resume approval.

## Rollback

Rollback stops future side effects. It does not erase evidence or restore an older state file over newer state.

1. Stop all scan and delivery commands and confirm no scheduler or worker is running.
2. Revoke pending network, state-write, and delivery authorizations.
3. Remove the HubSpot token and Slack webhook from the process environment.
4. Disable and rotate the pilot Slack webhook when exposure or unintended delivery is possible.
5. Preserve the current state file, run records, reports, manifest digest, and preflight output in restricted incident storage.
6. Do not edit state JSON, delete pending outbox items, lower attempt counts, mark receipts manually, or overwrite state with a backup.
7. Follow the delivery failure policy for pending, exhausted, terminal, or duplicate-risk items.
8. Record whether any Slack message requires manual deletion. Delete a message only through Slack administration with service-owner approval and retain the deletion evidence.
9. Decide whether to hold, remediate and resume, or terminate the pilot. A terminated pilot requires a new reviewed plan before restart.

Rollback never includes HubSpot record cleanup because HubSpot writes are prohibited.

## Retention and deletion

Default retention starts at the final pilot decision or termination date:

| Artifact | Location | Default retention | End action |
| --- | --- | --- | --- |
| Cohort manifest and configuration | Restricted local pilot storage | 30 days | Securely delete after confirming final aggregate evidence |
| State file and backups | Restricted pilot storage | 30 days | Securely delete unless an incident or approved follow-up requires a documented extension |
| Run records | Restricted pilot storage | 30 days | Securely delete after final review or extend under incident policy |
| Detailed scan, preflight, and delivery reports | Restricted pilot log | 30 days | Securely delete; never commit |
| HubSpot token | Approved secret store | Exact-ID verification window only | Delete immediately after each verification and verify absence |
| Slack webhook | Approved secret store | Pilot duration only | Disable or rotate within 24 hours of stop or completion and verify absence |
| Aggregate final evidence | Repository documentation | Indefinite | Retain without identifiers, domains, credentials, or raw outputs |

A legal, security, or incident hold overrides deletion only when the owner, reason, scope, and revised deletion date are recorded.

## Evidence record

The final repository-safe evidence must include:

- reviewed commit and CI result;
- planned and actual pilot dates;
- approved cohort size, not identities;
- authorized and completed scan-window counts;
- aggregate selected, processed, changed, unchanged, skipped, and failed counts;
- aggregate notification and failure-category counts;
- run-record completeness;
- stop, rollback, and incident counts;
- credential and artifact deletion confirmation;
- deviations and their reviewed disposition; and
- separate pilot-owner and reviewer decisions.

The evidence must not include company IDs, names, domains, detector IDs, operation keys, messages, endpoints, credentials, raw state, manifests, or provider payloads.

## Exit decision

Pilot completion does not automatically approve unattended production operation. After retention actions and evidence review, make one explicit decision:

- **Pass:** all success criteria met; proceed to a separate production release review.
- **Extend:** no safety breach, but evidence is insufficient; amend dates and authorizations without expanding scope.
- **Fail:** a success criterion cannot be met or a safety boundary was breached; stop and resolve findings before a new pilot.

Scheduling, hosting, multi-host storage, direct HubSpot-backed stateful composition, and another framework transfer remain separate decisions.
