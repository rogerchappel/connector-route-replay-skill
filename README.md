# Connector Route Replay Skill

Replay recorded connector-routing decisions from local fixtures and explain why each tool, approval gate, or dry-run path was selected.

This is a local-first agent skill. It does not call live connectors, read credentials, or write to external accounts.

## Quickstart

```sh
npm install
npm test
npm run smoke
node bin/connector-route-replay.js replay fixtures/write-action-route.json --format json
```

## CLI

```sh
connector-route-replay replay fixtures/read-only-route.json --format markdown
connector-route-replay replay fixtures/write-action-route.yaml --format json
connector-route-replay verify fixtures --policy examples/policy.json
```

`replay` scores one fixture and emits a report. `verify` scans a fixture directory, compares expected route and approval values, and exits non-zero on mismatch.

## Fixture Shape

Fixtures are JSON by default. A small YAML subset is supported for simple scalar/list/object fixtures.

```json
{
  "id": "write-action-route",
  "request": {
    "summary": "Draft and send a CRM update",
    "intent": "write",
    "risk": "medium"
  },
  "candidates": [
    {
      "name": "crm.write",
      "capabilities": ["write", "crm"],
      "sideEffects": ["external-write"],
      "dryRun": true,
      "evidence": ["Matches CRM write intent"]
    }
  ],
  "expected": {
    "selected": "crm.write",
    "approval": "explicit-approval"
  }
}
```

## Safety Notes

- All commands operate on local fixture files only.
- Approval gates are explanatory, not a replacement for platform policy.
- Any route with external writes, destructive actions, or credential access is treated as requiring approval unless policy explicitly blocks it.
- `dryRunOnly` routes are reported separately so agents can rehearse action plans before asking for access.

## Limitations

- V1 scoring is deterministic and heuristic-based.
- It intentionally avoids live connector probing.
- YAML support is designed for fixtures, not arbitrary YAML documents.

## Verification

```sh
npm run check
npm run lint
npm test
npm run smoke
npm run package:smoke
npm run release:check
```

`release:check` runs syntax checks, fixture-backed tests, the replay/verify smoke
paths, and an npm pack dry run.
