import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CLI help entrypoint prints usage', () => {
  const result = spawnSync(process.execPath, ['./bin/connector-route-replay.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, '');
});

test('CLI version entrypoint prints package version', () => {
  const result = spawnSync(process.execPath, ['./bin/connector-route-replay.js', '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /connector-route-replay 0\.1\.0/);
  assert.equal(result.stderr, '');
});
