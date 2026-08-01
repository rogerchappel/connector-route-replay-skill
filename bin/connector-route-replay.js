#!/usr/bin/env node
import { CliUsageError, loadFixture, loadPolicy, parseCliArguments, renderReport, replayRoute, verifyFixtures } from "../src/index.js";

const args = process.argv.slice(2);
const VERSION = "0.1.0";

try {
  const parsed = parseCliArguments(args);
  if (parsed.command === "help") {
    usage(undefined, 0);
  } else if (parsed.command === "version") {
    process.stdout.write(`connector-route-replay ${VERSION}\n`);
  } else if (parsed.command === "replay") {
    const fixture = loadFixture(parsed.target);
    const replay = replayRoute(fixture, loadPolicy(parsed.policy));
    process.stdout.write(renderReport(replay, parsed.format));
  } else if (parsed.command === "verify") {
    const result = verifyFixtures(parsed.target, { policy: parsed.policy });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof CliUsageError) usage(error.message);
  else {
    process.stderr.write(`connector-route-replay: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function usage(message, status = 2) {
  if (message) process.stderr.write(`${message}\n`);
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`Usage:
  connector-route-replay replay <fixture> [--format markdown|json] [--policy policy.json]
  connector-route-replay verify <fixtures-dir> [--policy policy.json]
  connector-route-replay --help
  connector-route-replay --version
`);
  process.exit(status);
}
