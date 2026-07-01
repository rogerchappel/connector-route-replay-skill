import fs from "node:fs";
import path from "node:path";

const DEFAULT_POLICY = {
  blockedTools: [],
  approvalRequiredIntents: ["write", "delete", "publish"],
  dryRunRequiredSideEffects: ["external-write", "notification-send", "destructive-change"]
};

export function loadFixture(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  const fixture = ext === ".yaml" || ext === ".yml" ? parseSimpleYaml(text) : JSON.parse(text);
  validateFixture(fixture, filePath);
  return fixture;
}

export function loadPolicy(filePath) {
  if (!filePath) return DEFAULT_POLICY;
  return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
}

export function replayRoute(fixture, policy = DEFAULT_POLICY) {
  const normalizedPolicy = { ...DEFAULT_POLICY, ...policy };
  const scored = fixture.candidates
    .map((candidate, index) => scoreCandidate(candidate, fixture.request, normalizedPolicy, index))
    .sort((a, b) => a.rankKey.localeCompare(b.rankKey));
  const available = scored.filter((candidate) => !candidate.blocked);
  const selected = available[0] ?? scored[0];
  const topScore = selected?.score ?? 0;
  const tied = available.filter((candidate) => candidate.score === topScore);
  const ambiguous = tied.length > 1;
  const approval = classifyApproval(selected, fixture.request, normalizedPolicy, ambiguous);

  return {
    id: fixture.id,
    request: fixture.request,
    selected,
    rejected: scored.filter((candidate) => candidate.name !== selected?.name),
    approval,
    ambiguous,
    dryRunOnly: Boolean(selected?.dryRun) || hasDryRunRequiredSideEffect(selected, normalizedPolicy),
    expected: fixture.expected ?? null
  };
}

export function verifyFixtures(dirPath, options = {}) {
  const policy = loadPolicy(options.policy);
  const files = fs.readdirSync(dirPath)
    .filter((name) => /\.(json|ya?ml)$/i.test(name))
    .sort();
  const results = files.map((name) => {
    const filePath = path.join(dirPath, name);
    const fixture = loadFixture(filePath);
    const replay = replayRoute(fixture, policy);
    const selectedOk = !fixture.expected?.selected || fixture.expected.selected === replay.selected?.name;
    const approvalOk = !fixture.expected?.approval || fixture.expected.approval === replay.approval;
    return {
      file: name,
      id: fixture.id,
      selected: replay.selected?.name,
      approval: replay.approval,
      ok: selectedOk && approvalOk,
      expected: fixture.expected ?? {}
    };
  });
  return {
    ok: results.every((result) => result.ok),
    count: results.length,
    results
  };
}

export function renderReport(replay, format = "markdown") {
  if (format === "json") return `${JSON.stringify(replay, null, 2)}\n`;
  const lines = [
    `# Connector Route Replay: ${replay.id}`,
    "",
    `Request: ${replay.request.summary}`,
    `Intent: ${replay.request.intent}`,
    `Risk: ${replay.request.risk ?? "unspecified"}`,
    "",
    "## Selected Route",
    "",
    `- Tool: ${replay.selected?.name ?? "none"}`,
    `- Score: ${replay.selected?.score ?? 0}`,
    `- Approval: ${replay.approval}`,
    `- Dry-run only: ${replay.dryRunOnly ? "yes" : "no"}`,
    `- Ambiguous: ${replay.ambiguous ? "yes" : "no"}`,
    "",
    "## Evidence",
    ""
  ];
  for (const item of replay.selected?.evidence ?? []) lines.push(`- ${item}`);
  lines.push("", "## Rejected Routes", "");
  for (const candidate of replay.rejected) {
    lines.push(`- ${candidate.name}: score ${candidate.score}${candidate.blocked ? " (blocked)" : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function scoreCandidate(candidate, request, policy, index) {
  const blocked = policy.blockedTools.includes(candidate.name);
  const keywords = new Set((request.keywords ?? []).map(String));
  const capabilities = new Set((candidate.capabilities ?? []).map(String));
  let score = 0;
  const evidence = [...(candidate.evidence ?? [])];

  if (capabilities.has(request.intent)) {
    score += 40;
    evidence.push(`Capability matches request intent: ${request.intent}`);
  }
  for (const keyword of keywords) {
    if (capabilities.has(keyword)) {
      score += 10;
      evidence.push(`Capability matches keyword: ${keyword}`);
    }
  }
  if (candidate.dryRun) {
    score += 5;
    evidence.push("Supports dry-run rehearsal");
  }
  if (blocked) {
    score -= 1000;
    evidence.push("Tool is blocked by policy");
  }

  return {
    ...candidate,
    score,
    blocked,
    rankKey: `${String(9999 - score).padStart(4, "0")}:${index}`,
    evidence
  };
}

function classifyApproval(selected, request, policy, ambiguous) {
  if (!selected) return "blocked";
  if (selected.blocked) return "blocked";
  if (ambiguous) return "clarify";
  if (policy.approvalRequiredIntents.includes(request.intent)) return "explicit-approval";
  if (hasDryRunRequiredSideEffect(selected, policy)) return "explicit-approval";
  if (request.risk === "high") return "explicit-approval";
  return "none";
}

function hasDryRunRequiredSideEffect(candidate, policy) {
  return (candidate?.sideEffects ?? []).some((effect) => policy.dryRunRequiredSideEffects.includes(effect));
}

function validateFixture(fixture, filePath) {
  if (!fixture || typeof fixture !== "object") throw new Error(`Invalid fixture in ${filePath}`);
  if (!fixture.id) throw new Error(`Fixture ${filePath} is missing id`);
  if (!fixture.request?.summary || !fixture.request?.intent) throw new Error(`Fixture ${fixture.id} is missing request summary or intent`);
  if (!Array.isArray(fixture.candidates) || fixture.candidates.length === 0) throw new Error(`Fixture ${fixture.id} needs candidates`);
}

function parseSimpleYaml(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const raw of lines) {
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error("Simple YAML parser expected list parent");
      const itemText = trimmed.slice(2);
      if (itemText.includes(":")) {
        const [key, value] = splitYamlPair(itemText);
        const item = { [key]: coerceYaml(value) };
        parent.push(item);
        stack.push({ indent, value: item });
      } else {
        parent.push(coerceYaml(itemText));
      }
      continue;
    }
    const [key, value] = splitYamlPair(trimmed);
    if (value === "") {
      const nextLine = lines[lines.indexOf(raw) + 1]?.trim() ?? "";
      parent[key] = nextLine.startsWith("- ") ? [] : {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = coerceYaml(value);
    }
  }
  return root;
}

function splitYamlPair(text) {
  const index = text.indexOf(":");
  if (index === -1) return [text, ""];
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}

function coerceYaml(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  return value;
}
