# Release Candidate Notes

## 0.1.0

- Adds local connector route replay CLI.
- Supports JSON and simple YAML fixtures.
- Reports selected and rejected routes with approval gates.
- Includes skill instructions, fixtures, tests, and smoke validation.

## Verification

Passed locally on 2026-07-01:

```sh
npm run check        # pass
npm test             # pass, 7 tests
npm run smoke        # pass, replay + fixture verify
npm run package:smoke # pass, npm pack --dry-run
```
