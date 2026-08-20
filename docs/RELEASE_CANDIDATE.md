# Release Candidate Notes

## 0.1.0

- Adds local connector route replay CLI.
- Supports JSON and simple YAML fixtures.
- Reports selected and rejected routes with approval gates.
- Includes skill instructions, fixtures, tests, and smoke validation.

## Verification

The canonical release gate is reproducible from a clean checkout:

```sh
npm ci
npm run release:check
```

`release:check` runs syntax checks, the complete Node test suite, replay and
fixture verification smoke commands, and the package consumer probe. The
consumer probe creates a real tarball, installs it into a temporary project,
and runs the packaged `connector-route-replay` binary against a fixture shipped
inside the package. Temporary package and consumer files are always removed.
