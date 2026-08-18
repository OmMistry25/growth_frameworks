# CI and Repository Security

This policy defines the automated security baseline for repository changes. It does not replace application threat modeling, production access controls, incident response, or a vulnerability-reporting policy.

## Pull request controls

Every pull request to `main` must pass:

- clean installation from `package-lock.json` with `npm ci`;
- TypeScript typechecking;
- the complete automated test suite;
- `npm audit --audit-level=high`; and
- GitHub dependency review with a failure threshold of `high` severity.

Dependency review evaluates dependency changes introduced by a pull request. The npm audit evaluates the fully resolved dependency tree. Both checks are required because they cover different change and installation paths.

## Workflow supply-chain controls

- Workflow permissions default to read-only repository contents.
- Every external action is pinned to a full commit SHA.
- A human-readable release comment follows each pinned SHA.
- Dependabot monitors npm and GitHub Actions dependencies weekly.
- New third-party actions require a security and data-impact review in their pull request.
- Workflows must not use pull-request code with privileged secrets or write permissions.

GitHub recommends full-length commit SHA pinning because it makes an action reference immutable. A version tag alone is not an immutable security boundary.

## Secret controls

GitHub secret scanning and push protection must remain enabled for the public repository. Contributors must not bypass push protection merely to make a push succeed.

Secrets must:

- enter processes only through an approved runtime secret store or environment boundary;
- never appear in arguments, configuration files, fixtures, logs, run records, state, reports, issues, pull requests, or documentation;
- be removed or rotated after bounded diagnostics when the operating procedure requires it; and
- be revoked immediately when exposure is suspected.

GitHub repository settings, rather than workflow files, control secret scanning, push protection, generic-pattern scanning, validity checks, and Dependabot security updates. Repository administrators must review these settings before an open-source release and after any visibility or ownership change.

## Current repository settings review

The following settings were confirmed through the GitHub repository API on August 15, 2026:

| Control | Status |
| --- | --- |
| Repository visibility | Public |
| Secret scanning | Enabled |
| Push protection | Enabled |
| Generic-pattern secret scanning | Disabled |
| Secret validity checks | Disabled |
| Dependabot security updates | Disabled |

Before the production and open-source release review, enable the disabled controls when available for the repository and account. If a control cannot be enabled, record the reason, compensating control, owner, and review date.

## Failure handling

- Do not merge a pull request with a failed quality, audit, or dependency-review check.
- Review the advisory, affected dependency path, exploitability, and available remediation.
- Prefer an upstream patched version or removal of the dependency.
- Do not suppress an advisory without a documented, time-bounded exception approved in a separate review.
- Treat a detected secret as an incident. Revoke it before removing it from history or closing an alert.

## Deferred controls

The production release review must decide whether the repository also requires CodeQL, artifact attestations, signed releases, provenance, SBOM publication, and additional operating-system or Node.js-version coverage. These controls depend on the selected packaging and deployment model.
