# Product Requirements: Connector Route Replay Skill

## Problem

Agents need a safe way to rehearse connector routing and approval decisions before touching live tools. Existing connector projects cover routing, rehearsal, and approval pieces, but a fixture-first replay layer makes those decisions reviewable and testable.

## Goals

- Parse local JSON/YAML route fixtures.
- Replay deterministic route scoring with evidence.
- Emit Markdown and JSON reports.
- Verify expected selected routes and approval gates in bulk.
- Document a reusable agent skill workflow.

## Non-Goals

- Live connector calls.
- Credential reads or account writes.
- Replacing a production policy engine.

## Users

- Agents validating connector decisions.
- Maintainers reviewing policy changes.
- Demo builders preparing safe connector examples.

## Success Criteria

- Fixture-backed tests cover read-only, write-action, ambiguous, and blocked routes.
- CLI smoke exercises replay and verify commands.
- Reports show selected route, rejected routes, approval gate, dry-run-only status, and evidence.
