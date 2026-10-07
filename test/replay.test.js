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

test("custom policy overlays cannot remove required side-effect safeguards", () => {
  const fixture = loadFixture("fixtures/credential-access-route.json");
  const mergedReplay = replayRoute(fixture, { blockedTools: ["unused.tool"] });
  assert.equal(mergedReplay.approval, "explicit-approval");
  assert.equal(mergedReplay.dryRunOnly, true);

  const extendedReplay = replayRoute(fixture, { dryRunRequiredSideEffects: ["custom-effect"] });
  assert.equal(extendedReplay.approval, "explicit-approval");
  assert.equal(extendedReplay.dryRunOnly, true);
});

test("loaded policy overlays retain all built-in side-effect safeguards", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "route-policy-"));
  try {
    const file = path.join(dir, "policy.json");
    fs.writeFileSync(file, JSON.stringify({ dryRunRequiredSideEffects: ["custom-effect"] }));
    const replay = replayRoute(loadFixture("fixtures/credential-access-route.json"), loadPolicy(file));
    assert.equal(replay.approval, "explicit-approval");
    assert.equal(replay.dryRunOnly, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("marks tied read routes as clarify", () => {
  const replay = replayRoute(loadFixture("fixtures/ambiguous-route.json"), loadPolicy("examples/policy.json"));
  assert.equal(replay.approval, "clarify");
  assert.equal(replay.ambiguous, true);
});

test("preserves source order for equal scores across double-digit candidate indices", () => {
  const replay = replayRoute(loadFixture("fixtures/many-tied-routes.json"));
  assert.equal(replay.selected.name, "route-2");
  assert.equal(replay.ambiguous, true);
  assert.equal(replay.approval, "clarify");
  assert.deepEqual(replay.rejected.map(({ name }) => name), [
    "route-3", "route-4", "route-5", "route-6", "route-7", "route-8", "route-9", "route-10", "route-11", "route-0", "route-1"
  ]);
});

test("CLI reports the first highest-scoring candidate for a large tied fixture", () => {
  const output = execFileSync("node", ["bin/connector-route-replay.js", "replay", "fixtures/many-tied-routes.json", "--format", "json"], {
    encoding: "utf8"
  });
  const replay = JSON.parse(output);
  assert.equal(replay.selected.name, "route-2");
  assert.equal(replay.approval, "clarify");
  assert.deepEqual(replay.rejected.map(({ name }) => name), [
    "route-3", "route-4", "route-5", "route-6", "route-7", "route-8", "route-9", "route-10", "route-11", "route-0", "route-1"
  ]);
});

test("parses simple YAML and avoids blocked live sender", () => {
  const replay = replayRoute(loadFixture("fixtures/blocked-route.yaml"), loadPolicy("examples/policy.json"));
  assert.equal(replay.selected.name, "mail.draft");
  assert.equal(replay.rejected.some((candidate) => candidate.name === "mail.send.live" && candidate.blocked), true);
});

test("decodes quoted scalars in YAML fixture fields", () => {
  const fixture = loadFixture("fixtures/quoted-route.yaml");
  const replay = replayRoute(fixture, loadPolicy("examples/policy.json"));

  assert.equal(replay.id, "quoted-route");
  assert.deepEqual(replay.request, {
    summary: "Look up the customer's CRM record",
    intent: "read",
    risk: "low",
    keywords: ["crm", "customer"]
  });
  assert.equal(replay.selected.name, "crm.search");
  assert.deepEqual(replay.selected.capabilities, ["read", "crm", "customer:lookup"]);
  assert.deepEqual(replay.selected.sideEffects, ["local-file"]);
  assert.deepEqual(replay.selected.evidence.slice(0, 2), [
    "source: local fixture",
    "Uses: the customer's identifier"
  ]);
  assert.deepEqual(replay.expected, { selected: "crm.search", approval: "none" });
  assert.equal(replay.approval, "none");
});

test("verifies all bundled fixtures", () => {
  const result = verifyFixtures("fixtures", { policy: "examples/policy.json" });
  assert.equal(result.ok, true);
  assert.equal(result.count, 7);
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

test("library rejects duplicate candidate names before scoring", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-duplicate-names-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = {
    id: "duplicate-routes",
    request: { summary: "Find a record", intent: "read" },
    candidates: [
      { name: "crm.search", capabilities: ["read", "crm"] },
      { name: "crm.search", capabilities: ["read", "customer"] }
    ]
  };
  const fixturePath = path.join(dir, "duplicate.json");
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));

  const message = /Fixture duplicate-routes candidates 1 and 2 use duplicate name "crm\.search"/;
  assert.throws(() => loadFixture(fixturePath), message);
  assert.throws(() => replayRoute(fixture), message);
});

test("distinct candidate names retain complete selected and rejected audit reporting", () => {
  const replay = replayRoute({
    id: "distinct-routes",
    request: { summary: "Find a record", intent: "read", keywords: ["crm"] },
    candidates: [
      { name: "crm.search", capabilities: ["read", "crm"] },
      { name: "customer.search", capabilities: ["read", "crm"] }
    ]
  });

  assert.equal(replay.ambiguous, true);
  assert.equal(replay.selected.name, "crm.search");
  assert.deepEqual(replay.rejected.map((candidate) => candidate.name), ["customer.search"]);
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

test("library rejects malformed expected fields before scoring", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-expected-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = { id: "invalid", request: { summary: "Test", intent: "read" }, candidates: [{ name: "route" }] };
  const cases = [
    [{ ...base, expected: "not-an-object" }, /Fixture invalid field expected must be an object/],
    [{ ...base, expected: [] }, /Fixture invalid field expected must be an object/],
    [{ ...base, expected: { selected: "" } }, /Fixture invalid expected field selected must be a non-empty string/],
    [{ ...base, expected: { selected: false } }, /Fixture invalid expected field selected must be a non-empty string/],
    [{ ...base, expected: { approval: "sometimes" } }, /Fixture invalid expected field approval must be one of none, clarify, explicit-approval, blocked/],
    [{ ...base, expected: { approval: true } }, /Fixture invalid expected field approval must be one of none, clarify, explicit-approval, blocked/]
  ];

  for (const [fixture, message] of cases) {
    const fixturePath = path.join(dir, "invalid.json");
    fs.writeFileSync(fixturePath, JSON.stringify(fixture));
    assert.throws(() => loadFixture(fixturePath), message);
    assert.throws(() => replayRoute(fixture), message);
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

test("CLI replay and verify exit nonzero for duplicate candidate names", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-duplicate-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturePath = path.join(dir, "duplicate.json");
  fs.writeFileSync(fixturePath, JSON.stringify({
    id: "duplicate-routes",
    request: { summary: "Find a record", intent: "read" },
    candidates: [{ name: "crm.search" }, { name: "crm.search" }]
  }));

  for (const args of [["replay", fixturePath, "--format", "json"], ["verify", dir]]) {
    const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, args[0]);
    assert.equal(result.stdout, "", args[0]);
    assert.match(result.stderr, /candidates 1 and 2 use duplicate name "crm\.search"/, args[0]);
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

test("CLI replay and verify reject malformed expected fields", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-expected-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturePath = path.join(dir, "malformed.json");
  fs.writeFileSync(fixturePath, JSON.stringify({
    id: "malformed",
    request: { summary: "Test", intent: "read" },
    candidates: [{ name: "route" }],
    expected: "not-an-object"
  }));

  for (const args of [["replay", fixturePath], ["verify", dir]]) {
    const result = spawnSync(process.execPath, ["bin/connector-route-replay.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, args[0]);
    assert.equal(result.stdout, "", args[0]);
    assert.match(result.stderr, /field expected must be an object/, args[0]);
  }
});

test("renders markdown report", () => {
  const replay = replayRoute(loadFixture("fixtures/read-only-route.json"), loadPolicy("examples/policy.json"));
  const markdown = renderReport(replay, "markdown");
  assert.match(markdown, /# Connector Route Replay: read-only-route/);
  assert.match(markdown, /Tool: crm.search/);
});

test("markdown reports contain fixture-derived text without allowing Markdown structure", () => {
  const fixture = {
    id: "demo\n# forged heading",
    request: {
      summary: "Lookup *important* record\n## unexpected section",
      intent: "read_[all]"
    },
    candidates: [
      {
        name: "crm.search\n- injected route",
        capabilities: ["read_[all]"],
        evidence: ["first line\n## unexpected evidence", "source: `fixture`"]
      },
      { name: "backup|route", capabilities: [] }
    ]
  };
  const replay = replayRoute(fixture);
  const markdown = renderReport(replay, "markdown");

  assert.equal(markdown.includes("# Connector Route Replay: demo \\# forged heading\n"), true);
  assert.equal(markdown.includes("Request: Lookup \\*important\\* record \\#\\# unexpected section\n"), true);
  assert.equal(markdown.includes("Intent: read\\_\\[all\\]\n"), true);
  assert.match(markdown, /^- Tool: crm\.search - injected route$/m);
  assert.equal(markdown.includes("- first line \\#\\# unexpected evidence\n"), true);
  assert.equal(markdown.includes("- source: \\`fixture\\`\n"), true);
  assert.match(markdown, /^- backup\\\|route: score 0$/m);
  assert.equal(markdown.includes("\n## unexpected"), false);
  assert.equal(renderReport(replay, "json"), `${JSON.stringify(replay, null, 2)}\n`);
});

test("CLI escapes request, route-name, and evidence fields in markdown output", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-markdown-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturePath = path.join(dir, "report.json");
  fs.writeFileSync(fixturePath, JSON.stringify({
    id: "cli-report",
    request: { summary: "Lookup\n# not a heading", intent: "read" },
    candidates: [{ name: "crm_[search]", capabilities: ["read"], evidence: ["one\n- not a list item"] }]
  }));

  const output = execFileSync(process.execPath, ["bin/connector-route-replay.js", "replay", fixturePath, "--format", "markdown"], {
    encoding: "utf8"
  });
  assert.match(output, /^Request: Lookup \\\# not a heading$/m);
  assert.match(output, /^- Tool: crm\\_\\\[search\\\]$/m);
  assert.match(output, /^- one - not a list item$/m);
  assert.equal(output.includes("\n# not a heading"), false);
  assert.equal(output.includes("\n- not a list item"), false);
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

test("CLI replay and verify report decoded quoted YAML values", () => {
  const replayOutput = execFileSync(process.execPath, ["bin/connector-route-replay.js", "replay", "fixtures/quoted-route.yaml", "--format", "json"], {
    encoding: "utf8"
  });
  const replay = JSON.parse(replayOutput);
  assert.equal(replay.id, "quoted-route");
  assert.equal(replay.request.summary, "Look up the customer's CRM record");
  assert.equal(replay.selected.name, "crm.search");
  assert.deepEqual(replay.selected.capabilities, ["read", "crm", "customer:lookup"]);
  assert.deepEqual(replay.selected.evidence.slice(0, 2), ["source: local fixture", "Uses: the customer's identifier"]);
  assert.equal(replay.expected.approval, "none");

  const verifyOutput = execFileSync(process.execPath, ["bin/connector-route-replay.js", "verify", "fixtures", "--policy", "examples/policy.json"], {
    encoding: "utf8"
  });
  const verify = JSON.parse(verifyOutput);
  const quoted = verify.results.find((result) => result.file === "quoted-route.yaml");
  assert.deepEqual(quoted, {
    file: "quoted-route.yaml",
    id: "quoted-route",
    selected: "crm.search",
    approval: "none",
    ok: true,
    expected: { selected: "crm.search", approval: "none" }
  });
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

test("parses repeated empty mappings from their positional next lines", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "route-replay-yaml-"));
  const fixturePath = path.join(directory, "repeated.yaml");
  fs.writeFileSync(fixturePath, [
    "id: repeated",
    "request:",
    "  summary: repeated mappings",
    "  intent: read",
    "candidates:",
    "  - name: first",
    "    options:",
    "      enabled: true",
    "  - name: second",
    "    options:",
    "      - safe",
    "      - deterministic",
    "    score: 1",
    ""
  ].join("\n"));
  try {
    const fixture = loadFixture(fixturePath);
    assert.deepEqual(fixture.candidates[0].options, { enabled: true });
    assert.deepEqual(fixture.candidates[1].options, ["safe", "deterministic"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
