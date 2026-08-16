import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CliUsageError, loadFixture, loadPolicy, parseCliArguments, renderReport, replayRoute, verifyFixtures } from "../src/index.js";

test("library parser returns command-specific arguments", () => {
  assert.deepEqual(
    parseCliArguments(["replay", "fixture.json", "--policy", "policy.json", "--format", "json"]),
    { command: "replay", target: "fixture.json", format: "json", policy: "policy.json" }
  );
  assert.deepEqual(
    parseCliArguments(["verify", "fixtures", "--policy", "policy.json"]),
    { command: "verify", target: "fixtures", format: "markdown", policy: "policy.json" }
  );
});

test("library parser rejects invalid argument forms deterministically", () => {
  const cases = [
    [["replay", "fixture.json", "--bogus", "value"], /Unknown option for replay: --bogus/],
    [["replay", "fixture.json", "extra.json"], /Unexpected positional argument for replay: extra.json/],
    [["replay", "fixture.json", "--format", "json", "--format", "markdown"], /Duplicate option for replay: --format/],
    [["verify", "fixtures", "--format", "json"], /Option --format is not supported by verify/]
  ];

  for (const [args, message] of cases) {
    assert.throws(() => parseCliArguments(args), (error) => error instanceof CliUsageError && message.test(error.message));
  }
});

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

test("applies approval and dry-run gates according to route side effects", () => {
  const cases = [
    ["fixtures/credential-access-route.json", "explicit-approval", true],
    ["fixtures/write-action-route.json", "explicit-approval", true],
    ["fixtures/read-only-route.json", "none", false]
  ];

  for (const [fixturePath, approval, dryRunOnly] of cases) {
    const replay = replayRoute(loadFixture(fixturePath));
    assert.equal(replay.approval, approval, fixturePath);
    assert.equal(replay.dryRunOnly, dryRunOnly, fixturePath);
  }
});

test("custom policy merging preserves credential-access defaults unless explicitly replaced", () => {
  const fixture = loadFixture("fixtures/credential-access-route.json");
  const mergedReplay = replayRoute(fixture, { blockedTools: ["unused.tool"] });
  assert.equal(mergedReplay.approval, "explicit-approval");
  assert.equal(mergedReplay.dryRunOnly, true);

  const overriddenReplay = replayRoute(fixture, { dryRunRequiredSideEffects: ["external-write"] });
  assert.equal(overriddenReplay.approval, "none");
  assert.equal(overriddenReplay.dryRunOnly, false);
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
  assert.equal(result.count, 5);
});

test("library rejects malformed fixture candidates with field-specific errors", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-fixtures-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases = [
    [null, /candidate 1 must be an object/],
    [{}, /candidate 1 field name must be a non-empty string/],
    [{ name: "route", capabilities: "read" }, /candidate 1 field capabilities must be an array of strings/],
    [{ name: "route", sideEffects: [false] }, /candidate 1 field sideEffects must be an array of strings/],
    [{ name: "route", evidence: {} }, /candidate 1 field evidence must be an array of strings/],
    [{ name: "route", dryRun: "false" }, /candidate 1 field dryRun must be a boolean/]
  ];

  for (const [candidate, message] of cases) {
    const fixturePath = path.join(dir, "invalid.json");
    fs.writeFileSync(fixturePath, JSON.stringify({ id: "invalid", request: { summary: "Test", intent: "read" }, candidates: [candidate] }));
    assert.throws(() => loadFixture(fixturePath), message);
  }
});

test("library rejects malformed request fields before scoring", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-requests-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = { id: "invalid", request: { summary: "Test", intent: "read" }, candidates: [{ name: "route" }] };
  const cases = [
    [{ ...base, request: null }, /Fixture invalid field request must be an object/],
    [{ ...base, request: { ...base.request, summary: 12 } }, /Fixture invalid request field summary must be a non-empty string/],
    [{ ...base, request: { ...base.request, intent: false } }, /Fixture invalid request field intent must be a non-empty string/],
    [{ ...base, request: { ...base.request, risk: 1 } }, /Fixture invalid request field risk must be a string/],
    [{ ...base, request: { ...base.request, keywords: "read" } }, /Fixture invalid request field keywords must be an array of strings/],
    [{ ...base, request: { ...base.request, keywords: ["read", null] } }, /Fixture invalid request field keywords must be an array of strings/]
  ];

  for (const [fixture, message] of cases) {
    const fixturePath = path.join(dir, "invalid.json");
    fs.writeFileSync(fixturePath, JSON.stringify(fixture));
    assert.throws(() => loadFixture(fixturePath), message);
    assert.throws(() => replayRoute(fixture), message);
  }
});

test("library rejects malformed policy fields before classification", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-policies-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = loadFixture("fixtures/read-only-route.json");
  const cases = [
    [null, /Policy must be an object/],
    [{ blockedTools: { route: true } }, /Policy field blockedTools must be an array of strings/],
    [{ approvalRequiredIntents: "bread" }, /Policy field approvalRequiredIntents must be an array of strings/],
    [{ dryRunRequiredSideEffects: ["external-write", false] }, /Policy field dryRunRequiredSideEffects must be an array of strings/]
  ];

  for (const [policy, message] of cases) {
    const policyPath = path.join(dir, "invalid.json");
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    assert.throws(() => loadPolicy(policyPath), message);
    assert.throws(() => replayRoute(fixture, policy), message);
  }
});

test("CLI replay and verify exit nonzero for malformed candidates", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturePath = path.join(dir, "malformed.json");
  fs.writeFileSync(fixturePath, JSON.stringify({ id: "malformed", request: { summary: "Test", intent: "read" }, candidates: [{}] }));

  for (const args of [["replay", fixturePath, "--format", "json"], ["verify", dir]]) {
    const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, args[0]);
    assert.equal(result.stdout, "", args[0]);
    assert.match(result.stderr, /candidate 1 field name must be a non-empty string/, args[0]);
  }
});

test("CLI replay and verify reject malformed request and policy fields", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-schema-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturePath = path.join(dir, "malformed.json");
  const policyPath = path.join(dir, "policy.json");
  fs.writeFileSync(fixturePath, JSON.stringify({
    id: "malformed",
    request: { summary: "Test", intent: "read", keywords: "read" },
    candidates: [{ name: "route" }]
  }));
  fs.writeFileSync(policyPath, JSON.stringify({ approvalRequiredIntents: "bread" }));

  const cases = [
    [["replay", fixturePath], /request field keywords must be an array of strings/],
    [["verify", dir], /request field keywords must be an array of strings/],
    [["replay", "fixtures/read-only-route.json", "--policy", policyPath], /Policy field approvalRequiredIntents must be an array of strings/],
    [["verify", "fixtures", "--policy", policyPath], /Policy field approvalRequiredIntents must be an array of strings/]
  ];

  for (const [args, message] of cases) {
    const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.match(result.stderr, message, args.join(" "));
  }
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

test("CLI reports approval and dry-run gates for credential, write, and read routes", () => {
  const cases = [
    ["fixtures/credential-access-route.json", "explicit-approval", true],
    ["fixtures/write-action-route.json", "explicit-approval", true],
    ["fixtures/read-only-route.json", "none", false]
  ];

  for (const [fixturePath, approval, dryRunOnly] of cases) {
    const output = execFileSync(process.execPath, ["bin/connector-route-replay.js", "replay", fixturePath, "--format", "json"], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.approval, approval, fixturePath);
    assert.equal(parsed.dryRunOnly, dryRunOnly, fixturePath);
  }
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
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing value for --format/);
  assert.match(result.stderr, /Usage:/);
});

test("CLI rejects invalid argument forms with usage status and actionable stderr", () => {
  const cases = [
    [["replay", "fixtures/read-only-route.json", "--bogus", "value"], /Unknown option for replay: --bogus/],
    [["replay", "fixtures/read-only-route.json", "extra.json"], /Unexpected positional argument for replay: extra.json/],
    [["replay", "fixtures/read-only-route.json", "--format", "json", "--format", "markdown"], /Duplicate option for replay: --format/],
    [["verify", "fixtures", "--format", "json"], /Option --format is not supported by verify/]
  ];

  for (const [args, message] of cases) {
    const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.match(result.stderr, message, args.join(" "));
    assert.match(result.stderr, /Usage:/, args.join(" "));
  }
});
