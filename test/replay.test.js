import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { loadFixture, loadPolicy, renderReport, replayRoute, verifyFixtures } from "../src/index.js";

test("selects read-only CRM route without approval", () => {
  const replay = replayRoute(loadFixture("fixtures/read-only-route.json"), loadPolicy("examples/policy.json"));
  assert.equal(replay.selected.name, "crm.search");
  assert.equal(replay.approval, "none");
  assert.equal(replay.dryRunOnly, false);
});

test("classifies write route as explicit approval", () => {
  const replay = replayRoute(loadFixture("fixtures/write-action-route.json"), loadPolicy("examples/policy.json"));
  assert.equal(replay.selected.name, "crm.write");
  assert.equal(replay.approval, "explicit-approval");
  assert.equal(replay.dryRunOnly, true);
});

test("marks tied read routes as clarify", () => {
  const replay = replayRoute(loadFixture("fixtures/ambiguous-route.json"), loadPolicy("examples/policy.json"));
  assert.equal(replay.approval, "clarify");
  assert.equal(replay.ambiguous, true);
});

test("parses simple YAML and avoids blocked live sender", () => {
  const replay = replayRoute(loadFixture("fixtures/blocked-route.yaml"), loadPolicy("examples/policy.json"));
  assert.equal(replay.selected.name, "mail.draft");
  assert.equal(replay.rejected.some((candidate) => candidate.name === "mail.send.live" && candidate.blocked), true);
});

test("verifies all bundled fixtures", () => {
  const result = verifyFixtures("fixtures", { policy: "examples/policy.json" });
  assert.equal(result.ok, true);
  assert.equal(result.count, 4);
});

test("renders markdown report", () => {
  const replay = replayRoute(loadFixture("fixtures/read-only-route.json"), loadPolicy("examples/policy.json"));
  const markdown = renderReport(replay, "markdown");
  assert.match(markdown, /# Connector Route Replay: read-only-route/);
  assert.match(markdown, /Tool: crm.search/);
});

test("CLI replay emits JSON", () => {
  const output = execFileSync("node", ["bin/connector-route-replay.js", "replay", "fixtures/write-action-route.json", "--format", "json"], {
    encoding: "utf8"
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.selected.name, "crm.write");
});
