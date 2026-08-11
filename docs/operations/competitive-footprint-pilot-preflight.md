# Competitive Footprint Pilot Preflight

The pilot preflight validates the limited-cohort configuration and clean local storage boundary without network access or writes. It performs no HubSpot, DNS, HTTPS, TLS, state, run-record, backup, or Slack operation.

## Inputs

All five paths must be absolute, distinct, and outside the repository:

- validated Competitive Footprint configuration;
- validated user-supplied account manifest;
- absent pilot state file;
- absent or empty pilot run-record directory; and
- absent or empty pilot backup directory.

The configuration and manifest must be regular non-symbolic-link files no larger than 1 MiB, with no group or other permission bits. The manifest must contain exactly three unique normalized domains and one unique numeric HubSpot external reference for each account.

The configuration must contain exactly one CNAME detector rule, one HTTPS detector rule, and one TLS port 443 detector rule. This fixes the maximum initial transition count at nine and the pilot lifetime delivery cap at three.

## Run

```text
npm run preflight:competitive-footprint:pilot -- \
  --pilot-preflight \
  --config /secure/pilot/config.json \
  --accounts /secure/pilot/accounts.json \
  --state-file /secure/pilot/state.json \
  --run-record-dir /secure/pilot/runs \
  --backup-dir /secure/pilot/backups
```

Run from the repository root so the outside-repository path check uses the intended boundary.

## Output

A ready report contains only:

- fixed command and mode names;
- read-only and disabled-capability flags;
- cohort, detector, maximum-transition, and attempt-cap counts;
- SHA-256 digests of the exact validated configuration and manifest bytes; and
- absent or empty storage states.

It excludes file paths, company IDs, account IDs, names, domains, HubSpot references, detector IDs, targets, credentials, and file contents. Store the two digests with the exact pilot authorization.

Any invalid field, unsafe permission, symbolic link, repository-local path, duplicate identity, broad cohort, unexpected detector shape, existing state, or nonempty storage directory makes the command exit nonzero. A ready report validates local inputs only and does not authorize a production action.
