import fs from "node:fs";
import path from "node:path";

export { CliUsageError, parseCliArguments } from "./cli-args.js";

const DEFAULT_POLICY = {
  blockedTools: [],
  approvalRequiredIntents: ["write", "delete", "publish"],
  dryRunRequiredSideEffects: ["external-write", "notification-send", "destructive-change", "credential-access"]
};
const APPROVAL_VALUES = ["none", "clarify", "explicit-approval", "blocked"];
const REQUIRED_SIDE_EFFECT_GUARDS = ["external-write", "notification-send", "destructive-change", "credential-access"];

export function loadFixture(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  const fixture = ext === ".yaml" || ext === ".yml" ? parseSimpleYaml(text) : JSON.parse(text);
  validateFixture(fixture, filePath);
  return fixture;
}

export function loadPolicy(filePath) {
  if (!filePath) return DEFAULT_POLICY;
  const policy = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validatePolicy(policy);
  return mergePolicy(policy);
}

export function replayRoute(fixture, policy = DEFAULT_POLICY) {
  validateFixture(fixture, "replay input");
  validatePolicy(policy);
  const normalizedPolicy = mergePolicy(policy);
  const scored = fixture.candidates
    .map((candidate, index) => scoreCandidate(candidate, fixture.request, normalizedPolicy, index))
    .sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex);
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
  if (format !== "markdown") throw new Error(`Unsupported format: ${format}. Expected markdown or json`);
  const lines = [
    `# Connector Route Replay: ${markdownText(replay.id)}`,
    "",
    `Request: ${markdownText(replay.request.summary)}`,
    `Intent: ${markdownText(replay.request.intent)}`,
    `Risk: ${markdownText(replay.request.risk ?? "unspecified")}`,
    "",
    "## Selected Route",
    "",
    `- Tool: ${markdownText(replay.selected?.name ?? "none")}`,
    `- Score: ${replay.selected?.score ?? 0}`,
    `- Approval: ${replay.approval}`,
    `- Dry-run only: ${replay.dryRunOnly ? "yes" : "no"}`,
    `- Ambiguous: ${replay.ambiguous ? "yes" : "no"}`,
    "",
    "## Evidence",
    ""
  ];
  for (const item of replay.selected?.evidence ?? []) lines.push(`- ${markdownText(item)}`);
  lines.push("", "## Rejected Routes", "");
  for (const candidate of replay.rejected) {
    lines.push(`- ${markdownText(candidate.name)}: score ${candidate.score}${candidate.blocked ? " (blocked)" : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function markdownText(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_{}\[\]()<>#!|])/g, "\\$1");
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
    sourceIndex: index,
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
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error(`Invalid fixture in ${filePath}`);
  if (typeof fixture.id !== "string" || fixture.id.trim() === "") throw new Error(`Fixture ${filePath} field id must be a non-empty string`);
  validateRequest(fixture.request, fixture.id);
  if (!Array.isArray(fixture.candidates) || fixture.candidates.length === 0) throw new Error(`Fixture ${fixture.id} needs candidates`);
  fixture.candidates.forEach((candidate, index) => validateCandidate(candidate, fixture.id, index));
  validateUniqueCandidateNames(fixture.candidates, fixture.id);
  if (Object.hasOwn(fixture, "expected")) validateExpected(fixture.expected, fixture.id);
}

function validateUniqueCandidateNames(candidates, fixtureId) {
  const firstIndexByName = new Map();
  candidates.forEach((candidate, index) => {
    const firstIndex = firstIndexByName.get(candidate.name);
    if (firstIndex !== undefined) {
      throw new Error(`Fixture ${fixtureId} candidates ${firstIndex + 1} and ${index + 1} use duplicate name ${JSON.stringify(candidate.name)}`);
    }
    firstIndexByName.set(candidate.name, index);
  });
}

function validateExpected(expected, fixtureId) {
  const label = `Fixture ${fixtureId}`;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error(`${label} field expected must be an object`);
  }
  if (Object.hasOwn(expected, "selected") && (typeof expected.selected !== "string" || expected.selected.trim() === "")) {
    throw new Error(`${label} expected field selected must be a non-empty string`);
  }
  if (Object.hasOwn(expected, "approval") && !APPROVAL_VALUES.includes(expected.approval)) {
    throw new Error(`${label} expected field approval must be one of ${APPROVAL_VALUES.join(", ")}`);
  }
}

function validateRequest(request, fixtureId) {
  const label = `Fixture ${fixtureId}`;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error(`${label} field request must be an object`);
  }
  for (const field of ["summary", "intent"]) {
    if (typeof request[field] !== "string" || request[field].trim() === "") {
      throw new Error(`${label} request field ${field} must be a non-empty string`);
    }
  }
  if (Object.hasOwn(request, "risk") && typeof request.risk !== "string") {
    throw new Error(`${label} request field risk must be a string`);
  }
  if (Object.hasOwn(request, "keywords")) validateStringArray(request.keywords, `${label} request field keywords`);
}

function mergePolicy(policy) {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    dryRunRequiredSideEffects: [...new Set([...DEFAULT_POLICY.dryRunRequiredSideEffects, ...(policy.dryRunRequiredSideEffects ?? [])])]
  };
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("Policy must be an object");
  for (const field of ["blockedTools", "approvalRequiredIntents", "dryRunRequiredSideEffects"]) {
    if (Object.hasOwn(policy, field)) validateStringArray(policy[field], `Policy field ${field}`);
  }
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
}

function validateCandidate(candidate, fixtureId, index) {
  const label = `Fixture ${fixtureId} candidate ${index + 1}`;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${label} must be an object`);
  }
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    throw new Error(`${label} field name must be a non-empty string`);
  }
  for (const field of ["capabilities", "sideEffects", "evidence"]) {
    if (Object.hasOwn(candidate, field)) validateStringArray(candidate[field], `${label} field ${field}`);
  }
  if (Object.hasOwn(candidate, "dryRun") && typeof candidate.dryRun !== "boolean") {
    throw new Error(`${label} field dryRun must be a boolean`);
  }
}

function parseSimpleYaml(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error("Simple YAML parser expected list parent");
      const itemText = trimmed.slice(2);
      if (findYamlPairIndex(itemText) !== -1) {
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
      const nextLine = lines[lineIndex + 1]?.trim() ?? "";
      parent[key] = nextLine.startsWith("- ") ? [] : {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = coerceYaml(value);
    }
  }
  return root;
}

function splitYamlPair(text) {
  const index = findYamlPairIndex(text);
  if (index === -1) return [text, ""];
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}

function findYamlPairIndex(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote === '"' && character === "\\") {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'" && text[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === ":" && quote === null) return index;
  }
  return -1;
}

function coerceYaml(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid double-quoted YAML scalar: ${value}`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  return value;
}
