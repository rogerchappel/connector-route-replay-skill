import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CLI help entrypoint prints usage', () => {
  const result = spawnSync(process.execPath, ['./bin/connector-route-replay.js', '--help'], { encoding: 'utf8' });
  assert.ok([0, 1, 2].includes(result.status), `unexpected exit status: ${result.status}`);
  assert.match(result.stdout + result.stderr, /Usage:/);
});
