import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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

test("CLI executes the documented markdown replay path", () => {
  const output = execFileSync(process.execPath, ["bin/connector-route-replay.js", "replay", "fixtures/read-only-route.json", "--format", "markdown"], {
    encoding: "utf8"
  });
  assert.match(output, /# Connector Route Replay: read-only-route/);
  assert.match(output, /Tool: crm\.search/);
});

test("CLI executes the documented JSON replay path", () => {
  const output = execFileSync(process.execPath, ["bin/connector-route-replay.js", "replay", "fixtures/write-action-route.json", "--format", "json"], {
    encoding: "utf8"
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.selected.name, "crm.write");
});

test("CLI rejects an unsupported replay format", () => {
  const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", "replay", "fixtures/read-only-route.json", "--format", "xml"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unsupported format: xml.*markdown or json/);
});

test("CLI rejects --format without a value", () => {
  const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", "replay", "fixtures/read-only-route.json", "--format"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing value for --format/);
});
