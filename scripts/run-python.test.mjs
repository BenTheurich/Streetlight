import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('./run-python.mjs', import.meta.url));

function run(interpreter, args) {
  return spawnSync(process.execPath, [launcher, ...args], {
    encoding: 'utf8',
    env: { ...process.env, STREETLIGHT_PYTHON: interpreter },
  });
}

test('forwards interpreter output and successful status', () => {
  const result = run(process.execPath, [
    '-e',
    "process.stdout.write('standard output'); process.stderr.write('standard error')",
  ]);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'standard output');
  assert.equal(result.stderr, 'standard error');
});

test('propagates an unsuccessful interpreter status', () => {
  const result = run(process.execPath, ['-e', 'process.exit(7)']);

  assert.equal(result.status, 7);
});

test('names a missing configured interpreter before child output', () => {
  const executable = 'streetlight-python-missing-for-test';
  const result = run(executable, ['-e', "process.stdout.write('partial output')"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`Python interpreter "${executable}"`));
  assert.doesNotMatch(result.stderr, /partial output/);
  assert.equal(result.stderr.trim().split(/\r?\n/).length, 1);
});

test('rejects an empty configured interpreter before child output', () => {
  const result = run('', ['-e', "process.stdout.write('partial output')"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr.trim(),
    'Failed to start Python interpreter "": STREETLIGHT_PYTHON is empty',
  );
});
