# Engineering Standards

These standards apply to code, documentation, branches, commits, pull requests, comments, logs, and user-facing copy.

## Writing

- Use concise, direct language.
- Do not use em dashes.
- Do not use emojis.
- State behavior and constraints precisely.
- Avoid promotional language and unnecessary commentary.
- Use established project terms consistently.

## Branches

Use a branch prefix that describes the type of change:

- `chore/` for repository and tooling maintenance
- `docs/` for documentation-only changes
- `feat/` for new behavior
- `fix/` for defect corrections
- `refactor/` for behavior-preserving code changes
- `test/` for test-only changes

Branch names must describe the work. They must not identify the implementer.

Examples:

```text
docs/framework-inventory
feat/competitor-detector-contract
fix/duplicate-webhook-processing
refactor/signal-state-engine
```

## Commits

Use Conventional Commits. Each commit must contain one cohesive change.

Examples:

```text
feat: add competitor detector contract
fix: make webhook processing idempotent
test: add qualification golden fixtures
docs: map reference implementation files
```

## Pull requests

Every pull request must include:

- Problem and scope
- Non-goals
- Implementation summary
- Verification evidence
- Security and data impact
- Migration impact
- Rollback instructions
- Follow-up work

Changes must pass formatting, linting, type checking, tests, build checks, and secret scanning when those checks apply.

## Reference implementations

- Treat reference repositories as read-only inputs.
- Pin the reviewed reference commit.
- Copy no credentials, production state, or customer data.
- Capture behavior with sanitized fixtures before porting logic.
- Separate reusable behavior from vendor and company configuration.
- Record the destination or exclusion decision for each relevant source area.

## Framework completion

A framework is complete only when:

- Core behavior is company-agnostic.
- Company assumptions are validated configuration.
- Reference parity tests pass.
- A second configuration demonstrates reuse.
- Clean installation and dry-run workflows pass.
- External writes are idempotent.
- Documentation and operational guidance are complete.
