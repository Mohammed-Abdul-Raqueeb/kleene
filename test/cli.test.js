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

test('an unknown option before the pattern is refused', () => {
  const error = throwsWith(() => parseArgs(['--nope', 'find', 'a']), Error);
  assert.match(error.message, /unknown option "--nope"/);
});

test('a pattern starting with a dash is data, not a flag', () => {
  // `kleene find -x` should search for "-x", which means only the arguments
  // before the pattern can be flags.
  const options = parseArgs(['find', 'a', '-x.txt']);
  assert.deepEqual(options.files, ['-x.txt']);
});

test('the boolean switches parse', () => {
  assert.equal(parseArgs(['match', 'a', '-v']).invert, true);
  assert.equal(parseArgs(['match', 'a', '-n']).lineNumber, true);
  assert.equal(parseArgs(['match', 'a', '-c']).count, true);
  assert.equal(parseArgs(['match', 'a', '-o']).only, true);
  assert.equal(parseArgs(['replace', 'a', 'b', '--no-newline']).noNewline, true);
});

// ---- find ----------------------------------------------------------------

test('find prints every match, one per line', async () => {
  const result = await cli(['find', '[0-9]+'], { stdin: 'a1b22c333' });
  assert.equal(result.code, 0);
  assert.equal(result.out, '1\n22\n333\n');
});

test('find exits 1 when nothing matched', async () => {
  // As grep does, so a shell can branch on it.
  const result = await cli(['find', 'z'], { stdin: 'abc' });
  assert.equal(result.code, 1);
  assert.equal(result.out, '');
});

test('find --count prints the number, not the matches', async () => {
  const result = await cli(['find', '[0-9]', '-c'], { stdin: 'a1b2' });
  assert.equal(result.out, '2\n');
});

test('find --group prints one capture instead of the whole match', async () => {
  const byNumber = await cli(['find', '(\\w)=(\\d)', '--group', '2'], { stdin: 'a=1 b=2' });
  assert.equal(byNumber.out, '1\n2\n');

  const byName = await cli(['find', '(?<k>\\w)=\\d', '--group', 'k'], { stdin: 'a=1' });
  assert.equal(byName.out, 'a\n');
});

test('find --group prints nothing for a group that did not participate', async () => {
  // Rather than the word "undefined", which would poison a pipeline.
  const result = await cli(['find', '(x)?a', '--group', '1'], { stdin: 'a' });
  assert.equal(result.out, '\n');
});

// ---- match ---------------------------------------------------------------

test('match prints the lines that match', async () => {
  const result = await cli(['match', 'ERROR'], { stdin: 'ok\nERROR here\nfine\n' });
  assert.equal(result.code, 0);
  assert.equal(result.out, 'ERROR here\n');
});

test('match -n prefixes the line number', async () => {
  const result = await cli(['match', 'b', '-n'], { stdin: 'a\nb\nc\nb\n' });
  assert.equal(result.out, '2:b\n4:b\n');
});

test('match -v prints the lines that do not match', async () => {
  const result = await cli(['match', 'b', '-v'], { stdin: 'a\nb\nc\n' });
  assert.equal(result.out, 'a\nc\n');
});

test('match -c counts the lines', async () => {
  const result = await cli(['match', 'b', '-c'], { stdin: 'a\nb\nbb\n' });
  assert.equal(result.out, '2\n');
});

test('match -o prints the matched text rather than the line', async () => {
  const result = await cli(['match', '[0-9]+', '-o'], { stdin: 'a1 b22\n' });
  assert.equal(result.out, '1\n22\n');
});

test('a trailing newline does not create an extra empty line', async () => {
  // Without dropping it, a file ending in a newline matches `^$` and every
  // count is one too high.
  const result = await cli(['match', '^$', '-c'], { stdin: 'a\n' });
  assert.equal(result.out, '0\n');
});

test('match -i ignores case', async () => {
  const result = await cli(['match', 'error', '-i'], { stdin: 'ERROR\n' });
  assert.equal(result.out, 'ERROR\n');
});

// ---- replace -------------------------------------------------------------

test('replace substitutes every match', async () => {
  // Global by default: replacing only the first occurrence in a file is
  // almost never what was meant.
  const result = await cli(['replace', 'a', 'X'], { stdin: 'aaa' });
  assert.equal(result.out, 'XXX\n');
});

test('replace expands group references', async () => {
  const result = await cli(['replace', '(\\w+) (\\w+)', '$2 $1'], { stdin: 'hello world' });
  assert.equal(result.out, 'world hello\n');
});

test('replace without a replacement is a usage error', async () => {
  const result = await cli(['replace', 'a']);
  assert.equal(result.code, 2);
  assert.match(result.err, /needs a replacement/);
});

test('replace --no-newline leaves the output as it is', async () => {
  const result = await cli(['replace', 'a', 'X', '--no-newline'], { stdin: 'a' });
  assert.equal(result.out, 'X');
});

// ---- split ---------------------------------------------------------------

test('split prints the pieces one per line', async () => {
  const result = await cli(['split', ','], { stdin: 'a,b,c' });
  assert.equal(result.out, 'a\nb\nc\n');
});

