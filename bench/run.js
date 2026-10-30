#!/usr/bin/env node
/**
 * Benchmarks, measured with `performance.now` rather than a framework.
 *
 * A framework would be the only dependency in the repository, and what a
 * benchmark needs is a number you can reproduce rather than a statistical
 * model of it. Each case warms up, then runs enough iterations to take a
 * measurable time, and reports the median with the best and worst sample so
 * an outlier is visible rather than averaged away.
 *
 * Read the first section and ignore the rest if you are short of time. It is
 * the only one where this engine wins, and it wins by a margin that makes
 * the rest beside the point.
 *
 *   npm run bench
 */

import { Regex } from '../src/index.js';

const SAMPLES = 9;

/**
 * Times `body`, reporting the median of several samples.
 *
 * @param {string} label what is being measured
 * @param {number} iterations how many times to run the body per sample
 * @param {Function} body the work
 */
function measure(label, iterations, body) {
  // One warm-up sample, discarded. The first run of anything in V8 is
  // dominated by the optimiser not having seen the code yet.
  for (let i = 0; i < iterations; i++) body();

  const samples = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) body();
    samples.push((performance.now() - started) / iterations);
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];

  process.stdout.write(
    `  ${label.padEnd(44)}${render(median).padStart(10)}`
      + `   [${render(samples[0])} … ${render(samples[samples.length - 1])}]\n`,
  );
  return median;
}

function render(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function section(title) {
  process.stdout.write(`\n${title}\n${'─'.repeat(80)}\n`);
}

process.stdout.write('kleene benchmarks\n');
process.stdout.write('Each line: median of 9 samples, best and worst in brackets.\n');

// ---- the one that matters -------------------------------------------------

section('Catastrophic backtracking (the reason this engine exists)');
{
  // `(a+)+b` against a string of a's has exponentially many ways to split the
  // a's between the two quantifiers, and a backtracking engine tries all of
  // them before concluding there is no b. This engine holds at most one
  // thread per instruction, so it cannot do that.
  const evil = new Regex('(a+)+b');

  process.stdout.write('\n  kleene, which is linear in the subject:\n');
  for (const length of [100, 1000, 10000]) {
    const subject = 'a'.repeat(length);
    measure(`(a+)+b against ${length} a's`, length > 1000 ? 5 : 50, () => evil.test(subject));
  }

  process.stdout.write('\n  RegExp, on the same pattern, doubling the input:\n');
  const reference = /(a+)+b/;
  for (const length of [18, 20, 22, 24, 26]) {
    const subject = 'a'.repeat(length);
    const started = performance.now();
    reference.test(subject);
    const elapsed = performance.now() - started;
    process.stdout.write(
      `  ${`/(a+)+b/ against ${length} a's`.padEnd(44)}${render(elapsed).padStart(10)}\n`,
    );
  }

  process.stdout.write(
    '\n  Each extra character doubles the time on the right and adds a constant\n'
      + "  on the left. At 26 a's the gap is already five orders of magnitude; at\n"
      + "  60 a's the backtracking engine would outlast the universe.\n",
  );
}

// ---- where a backtracking engine wins ------------------------------------

section('Ordinary patterns (where RegExp is faster, and by how much)');
{
  // Worth measuring and printing honestly. A production RegExp is years of
  // optimisation in C++ with a JIT; this is a few hundred lines of
  // JavaScript. The guarantee is the product, not the speed.
  const cases = [
    ['\\d{3}-\\d{4}', 'please call 555-1234 today'],
    ['[a-z]+@[a-z]+\\.[a-z]{2,}', 'write to someone@example.com please'],
    ['^(\\w+)\\s+(\\w+)$', 'hello world'],
    ['(a|b)+c', `${'ab'.repeat(40)}c`],
  ];

  for (const [pattern, subject] of cases) {
    const mine = new Regex(pattern);
    const theirs = new RegExp(pattern);

    const label = pattern.length > 24 ? `${pattern.slice(0, 24)}…` : pattern;
    const kleene = measure(`kleene  /${label}/`, 2000, () => mine.test(subject));
    const regexp = measure(`RegExp  /${label}/`, 2000, () => theirs.test(subject));
    const ratio = `${(kleene / regexp).toFixed(0)}x slower`;
    process.stdout.write(`  ${''.padEnd(44)}${ratio.padStart(10)}\n\n`);
  }
}

// ---- the pieces ----------------------------------------------------------

section('Compiling');
{
  measure('parse and compile /a/', 20000, () => new Regex('a'));
  measure('parse and compile a realistic pattern', 2000,
    () => new Regex('^(\\w+)@([a-z0-9.-]+)\\.([a-z]{2,})$'));
  measure('parse and compile a{100}', 500, () => new Regex('a{100}'));
}

section('Matching, by subject length');
{
  const regex = new Regex('[a-z]+@[a-z]+\\.[a-z]+');
  for (const length of [100, 1000, 10000]) {
    // The address sits at the end, so the whole subject is scanned.
    const subject = `${'x '.repeat(length / 2)}someone@example.com`;
    measure(`search ${length} characters`, length > 1000 ? 50 : 500,
      () => regex.test(subject));
  }
}

section('Captures');
{
  const plain = new Regex('[a-z]+ [a-z]+');
  const captured = new Regex('([a-z]+) ([a-z]+)');
  const named = new Regex('(?<first>[a-z]+) (?<second>[a-z]+)');
  const subject = 'hello world';

  const a = measure('no groups', 5000, () => plain.match(subject));
  const b = measure('two groups', 5000, () => captured.match(subject));
  measure('two named groups', 5000, () => named.match(subject));
  process.stdout.write(
    `  ${''.padEnd(44)}${`${(b / a).toFixed(1)}x for captures`.padStart(10)}\n`,
  );
}

process.stdout.write('\n');
