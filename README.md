# Connector Route Replay Skill

Replay recorded connector-routing decisions from local fixtures and explain why each tool, approval gate, or dry-run path was selected.

This is a local-first agent skill. It does not call live connectors, read credentials, or write to external accounts.

## Quickstart

```sh
npm install
npm test
npm run smoke
node bin/connector-route-replay.js --help
node bin/connector-route-replay.js --version
node bin/connector-route-replay.js replay fixtures/write-action-route.json --format json
```

## CLI

```sh
connector-route-replay replay fixtures/read-only-route.json --format markdown
connector-route-replay replay fixtures/write-action-route.json --format json
connector-route-replay replay fixtures/credential-access-route.json --format json
connector-route-replay verify fixtures --policy examples/policy.json
```

`replay` scores one fixture and emits a report. `verify` scans a fixture directory, compares expected route and approval values, and exits non-zero on mismatch.

Markdown reports keep fixture-derived values on one line and escape Markdown control characters. This preserves readable text while preventing request summaries, route names, evidence, or other fixture fields from creating headings, lists, links, or emphasis. JSON reports preserve the original fixture values unchanged.

Invalid command lines exit with usage status `2` and print an actionable error plus usage text to stderr. This includes unknown options, extra positional arguments, repeated options, missing option values, and command-specific options such as `--format` on `verify`. Runtime and verification failures use status `1`.

## Fixture Shape

Fixtures are JSON by default. A small YAML subset is supported for simple scalar/list/object fixtures. Scalar values may be unquoted, double quoted with JSON-style escapes, or single quoted with doubled apostrophes (`''`). Quoted list values may contain colons and remain strings; unquoted `key: value` list items create inline mappings. Quoted booleans remain strings; unquoted `true` and `false` become booleans.

Each item in `candidates` must be an object with a non-empty string `name`, and every candidate name in a fixture must be unique. Names are compared exactly, without trimming or case folding. When present, `capabilities`, `sideEffects`, and `evidence` must be arrays of strings, and `dryRun` must be a boolean. Both `replay` and `verify` reject malformed or duplicate candidates before route scoring; duplicate-name errors identify both candidate numbers.

Candidates are ordered by numeric score from highest to lowest. Equal scores preserve their order in the fixture: the first tied candidate is selected, every other candidate remains in deterministic fixture order in the rejected-route audit, and the tie still produces `clarify` approval.

When present, `expected` must be an object. Its optional `selected` field is a non-empty route-name string, and its optional `approval` field is one of `none`, `clarify`, `explicit-approval`, or `blocked`. Both commands validate these assertions before scoring; malformed expectations are errors rather than verification mismatches.

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

The fixture schema is validated before scoring:

- `id`, `request.summary`, and `request.intent` are required non-empty strings.
- `request.risk`, when present, is a string. `request.keywords`, when present, is an array of strings.
- `candidates` is a non-empty array of objects. Each candidate requires a non-empty string `name` that is unique within the fixture; optional `capabilities`, `sideEffects`, and `evidence` fields are arrays of strings, and optional `dryRun` is a boolean.
- `expected`, when present, is an object. Optional `selected` is a non-empty string; optional `approval` is `none`, `clarify`, `explicit-approval`, or `blocked`.
- Empty strings are accepted inside string arrays and are compared literally; they are not trimmed, removed, or coerced. Required scalar strings cannot be empty or whitespace-only.

## Policy Shape

A policy file is a JSON object. All supported fields are optional. `blockedTools` and `approvalRequiredIntents` replace their corresponding defaults when supplied; `dryRunRequiredSideEffects` adds to the built-in safeguards and cannot remove them:

```json
{
  "blockedTools": ["mail.send.live"],
  "approvalRequiredIntents": ["write", "delete", "publish"],
  "dryRunRequiredSideEffects": ["external-write", "notification-send"]
}
```

Each policy field must be an array of strings. As with fixture arrays, empty strings are accepted and compared literally without coercion. The library entry points and the `replay` and `verify` CLI commands reject invalid fixture or policy fields before scoring, with the invalid field named in the error.

## Safety Notes

- All commands operate on local fixture files only.
- Approval gates are explanatory, not a replacement for platform policy.
- By default, any route with external writes, destructive actions, notification sends, or credential access requires approval and is marked `dryRunOnly`.
- `dryRunOnly` routes are reported separately so agents can rehearse action plans before asking for access.
- Custom policies cannot disable built-in dry-run side-effect safeguards. `dryRunRequiredSideEffects` overlays are additive; custom side effects extend the required set. Other policy fields retain their documented replacement behavior.

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
paths, and a real packed-package install and CLI consumer probe.
