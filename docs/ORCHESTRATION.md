# Orchestration

## Default Flow

1. Collect or write a local route fixture.
2. Run `connector-route-replay replay <fixture> --format markdown`.
3. Inspect selected route, rejected routes, approval gate, and dry-run-only notes.
4. Run `connector-route-replay verify fixtures --policy examples/policy.json` before changing connector policy examples.

## Boundaries

- Do not use this tool as permission to execute an external action.
- Do not include real tokens, customer records, or account identifiers in fixtures.
- Treat reports as review evidence for a separate approval workflow.

## CI Suggestion

```sh
npm run check
npm test
npm run smoke
```
