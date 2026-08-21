import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "connector-route-package-"));
const packDirectory = path.join(temporaryRoot, "pack");
const consumerDirectory = path.join(temporaryRoot, "consumer");

try {
  fs.mkdirSync(packDirectory);
  fs.mkdirSync(consumerDirectory);
  fs.writeFileSync(path.join(consumerDirectory, "package.json"), JSON.stringify({ private: true }));

  const tarballName = execFileSync("npm", ["pack", "--pack-destination", packDirectory], {
    cwd: projectRoot,
    encoding: "utf8"
  }).trim().split("\n").at(-1);
  assert.ok(tarballName, "npm pack did not report a tarball");
  const tarballPath = path.join(packDirectory, tarballName);
  assert.ok(fs.statSync(tarballPath).isFile(), `npm pack did not create ${tarballName}`);

  execFileSync("npm", ["install", "--ignore-scripts", tarballPath], {
    cwd: consumerDirectory,
    stdio: "pipe"
  });
  const installedPackage = path.join(consumerDirectory, "node_modules", "connector-route-replay-skill");
  const cliPath = path.join(consumerDirectory, "node_modules", ".bin", "connector-route-replay");
  const fixturePath = path.join(installedPackage, "fixtures", "read-only-route.json");
  const output = execFileSync(cliPath, ["replay", fixturePath, "--format", "markdown"], {
    cwd: consumerDirectory,
    encoding: "utf8"
  });
  assert.match(output, /# Connector Route Replay: read-only-route/);
  assert.match(output, /Tool: crm\.search/);
  process.stdout.write(`Validated installed CLI from ${tarballName}\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
