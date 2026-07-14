import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const output = `${result.stdout || ''}\n${result.stderr || ''}`;

if (result.status !== 0) {
  process.stderr.write(output);
  process.exit(result.status || 1);
}

let packed;
try {
  [packed] = JSON.parse(result.stdout);
} catch (error) {
  process.stderr.write(output);
  console.error(`could not parse npm pack json: ${error.message}`);
  process.exit(1);
}

const packedFiles = new Set((packed.files || []).map((file) => file.path));

const required = [
  'bin/connector-route-replay.js',
  'src/index.js',
  'fixtures/read-only-route.json',
  'fixtures/write-action-route.json',
  'examples/policy.json',
  'docs/RELEASE_CANDIDATE.md',
  'SKILL.md',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CHANGELOG.md'
];

const missing = required.filter((entry) => !packedFiles.has(entry));

if (missing.length > 0) {
  console.error(`package smoke missing entries:\n${missing.join('\n')}`);
  process.exit(1);
}

console.log(`package smoke passed: ${packed.filename}`);
