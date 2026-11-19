# Project Rules

## Living docs

- Every feature addition or behavior change must update `living-docs/` in the same commit.
  - `living-docs/PRD.md`: product behavior, user-facing features, decisions.
  - `living-docs/IMPLEMENTATION_PLAN.md`: architecture, API contract, schema/migrations, deployment, worker pipeline.
- Docs describe the current state, not history. Replace outdated statements; don't append contradictions.
- A change is not done until docs match the code.
