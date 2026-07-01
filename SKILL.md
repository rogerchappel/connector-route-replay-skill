# Connector Route Replay Skill

## When To Use

Use this skill when an agent needs to validate connector-routing behavior from local fixtures before enabling tools, asking for approval, or showing a dry-run action plan.

## Required Inputs

- A JSON or simple YAML route fixture with `request`, `candidates`, and optional `expected` fields.
- Optional policy JSON with `blockedTools`, `approvalRequiredIntents`, and `dryRunRequiredSideEffects`.

## Side-Effect Boundaries

Default commands read local files and write reports to stdout only. The skill must not call live connectors, read credentials, post messages, update CRMs, or change external systems.

## Approval Requirements

- External writes, destructive actions, credential access, and medium/high-risk write intents require explicit approval.
- Blocked tools are reported as blocked and must not be executed.
- Dry-run-only routes can be used to prepare a plan, not to perform the action.

## Examples

```sh
connector-route-replay replay fixtures/read-only-route.json --format markdown
connector-route-replay replay fixtures/write-action-route.yaml --format json
connector-route-replay verify fixtures --policy examples/policy.json
```

## Validation Workflow

Run these before relying on the skill in another repo:

```sh
npm run check
npm test
npm run smoke
npm run package:smoke
```
