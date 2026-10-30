import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, run } from '../src/cli.js';
import { throwsWith } from './helpers.js';

/** Collects what a stream was written. */
function sink() {
  const chunks = [];
  return {
    write(text) { chunks.push(text); return true; },
    get text() { return chunks.join(''); },
  };
}

/**
 * Runs the CLI in-process against captured streams.
 *
 * No subprocess, which keeps the suite fast and lets a test assert on
 * stdout, stderr and the exit code together -- three separate promises, any
 * of which can be broken alone.
 */
async function cli(argv, { stdin = '', files = {} } = {}) {
  const out = sink();
  const err = sink();
  const code = await run(argv, {
    out,
    err,
    readStdin: async () => stdin,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path];
    },
  });
  return { code, out: out.text, err: err.text };
}

// ---- argument parsing ----------------------------------------------------

test('the first two positionals are the command and the pattern', () => {
  const options = parseArgs(['find', '\\d+', 'one.txt']);
  assert.equal(options.command, 'find');
  assert.equal(options.pattern, '\\d+');
  assert.deepEqual(options.files, ['one.txt']);
});

test('replace takes its replacement as the third positional', () => {
  const options = parseArgs(['replace', 'a', 'b', 'in.txt']);
  assert.equal(options.pattern, 'a');
  assert.equal(options.replacement, 'b');
  assert.deepEqual(options.files, ['in.txt']);
});

test('flags accumulate from both spellings', () => {
  assert.equal(parseArgs(['find', 'a', '-i']).flags, 'i');
  assert.equal(parseArgs(['find', 'a', '--flags', 'gm']).flags, 'gm');
  assert.equal(parseArgs(['find', 'a', '-i', '-f', 'm']).flags, 'im');
});

test('--name=value is accepted as well as --name value', () => {
  assert.equal(parseArgs(['find', 'a', '--flags=gi']).flags, 'gi');
});

test('an option missing its value is reported by name', () => {
  const error = throwsWith(() => parseArgs(['find', 'a', '--flags']), Error);
  assert.match(error.message, /--flags needs a value/);
});

