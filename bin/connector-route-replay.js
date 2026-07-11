#!/usr/bin/env node
import { loadFixture, loadPolicy, renderReport, replayRoute, verifyFixtures } from "../src/index.js";

const args = process.argv.slice(2);
const command = args[0];
const VERSION = "0.1.0";

try {
  if (command === "--help" || command === "-h" || command === "help" || !command) {
    usage(undefined, 0);
  } else if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`connector-route-replay ${VERSION}\n`);
  } else if (command === "replay") {
    const fixturePath = args[1];
    if (!fixturePath) usage("Missing fixture path");
    const format = readOption(args, "--format") ?? "markdown";
    const policyPath = readOption(args, "--policy");
    const fixture = loadFixture(fixturePath);
    const replay = replayRoute(fixture, loadPolicy(policyPath));
    process.stdout.write(renderReport(replay, format));
  } else if (command === "verify") {
    const dirPath = args[1];
    if (!dirPath) usage("Missing fixture directory");
    const policyPath = readOption(args, "--policy");
    const result = verifyFixtures(dirPath, { policy: policyPath });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } else {
    usage(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`connector-route-replay: ${error.message}\n`);
  process.exitCode = 1;
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index === -1 ? undefined : values[index + 1];
}

function usage(message, status = 2) {
  if (message) process.stderr.write(`${message}\n`);
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`Usage:
  connector-route-replay replay <fixture> [--format markdown|json] [--policy policy.json]
  connector-route-replay verify <fixtures-dir> [--policy policy.json]
  connector-route-replay --version
`);
  process.exit(status);
}
