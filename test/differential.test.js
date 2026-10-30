import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Regex } from '../src/index.js';
import { hasNullableQuantifier } from '../src/ast.js';
import { renderMatch } from './helpers.js';

/**
 * Randomised differential testing against the host's own engine.
 *
 * This is the test that gives the most confidence per line in the whole
 * suite, and it is only possible because a reference implementation ships
 * with the runtime. Thousands of generated patterns are run through both
 * engines and the results compared, which finds the cases nobody would think
 * to write by hand -- two of the three real bugs in this engine were found
 * here rather than by a hand-written test.
 *
 * The generator is seeded, so a failure is reproducible: the seed is printed
 * with any mismatch.
 */

/** A small deterministic generator, so a failing run can be repeated. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const ATOMS = ['a', 'b', 'c', '.', '[ab]', '[^a]', '\\d', '\\w', '\\s', '[a-c]', 'x', '\\.'];
const QUANTIFIERS = ['', '*', '+', '?', '{2}', '{1,2}', '{0,2}', '{2,}', '*?', '+?', '??'];
const SUBJECTS = [
  '', 'a', 'b', 'ab', 'aab', 'abc', 'aaa', 'xbca', 'a b', 'a1b2',
  'cab', 'ccc', 'abab', ' a ', 'a.b', 'AbC', 'a\nb',
];
const FLAG_SETS = ['', 'i', 's', 'm', 'im', 'is'];

/** Builds a random pattern from the subset this engine supports. */
function generate(rnd, depth) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  if (depth <= 0) return pick(ATOMS) + pick(QUANTIFIERS);

  const choice = rnd();
  if (choice < 0.28) return generate(rnd, depth - 1) + generate(rnd, depth - 1);
  if (choice < 0.48) {
    const left = generate(rnd, depth - 1);
    const right = generate(rnd, depth - 1);
    return `(?:${left}|${right})${pick(QUANTIFIERS)}`;
  }
  if (choice < 0.66) return `(${generate(rnd, depth - 1)})${pick(QUANTIFIERS)}`;
  if (choice < 0.76) return `[${pick(['abc', 'a-c', '^a', '^a-c', 'a-cx'])}]${pick(QUANTIFIERS)}`;
  return pick(ATOMS) + pick(QUANTIFIERS);
}

/**
 * Runs a differential sweep and returns what it found.
 *
 * @param {object} options
 * @param {number} options.seed the generator seed
 * @param {number} options.rounds how many patterns to try
 * @param {number} options.depth how deeply to nest
 * @returns {object} counts and the first few mismatches
 */
function sweep({ seed, rounds, depth = 2 }) {
  const rnd = random(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  let compared = 0;
  let skippedNullable = 0;
  let skippedInvalid = 0;
  const mismatches = [];

  for (let round = 0; round < rounds; round++) {
    const pattern = generate(rnd, depth);
    const flags = pick(FLAG_SETS);
    const subject = pick(SUBJECTS);

    let reference;
    try {
      reference = new RegExp(pattern, flags);
    } catch {
      // The generator can emit something RegExp rejects; that is not this
      // engine's problem.
      skippedInvalid++;
      continue;
    }

    let mine;
    try {
      mine = new Regex(pattern, flags);
    } catch (error) {
      mismatches.push(`/${pattern}/${flags} threw ${error.name}: ${error.message}`);
      continue;
    }

    // Outside the promised range. See `nullable` in src/ast.js: ECMAScript
    // rejects a zero-width iteration when the lower bound is zero, and this
    // engine does not implement that rule.
    if (hasNullableQuantifier(mine.ast)) {
      skippedNullable++;
      continue;
    }

    compared++;
    const got = renderMatch(mine.match(subject));
    const want = renderMatch(reference.exec(subject));

    if (got !== want) {
      mismatches.push(
        `seed ${seed}: /${pattern}/${flags} against ${JSON.stringify(subject)}`
          + `\n    kleene: ${got}`
          + `\n    RegExp: ${want}`,
      );
    }
  }

  return { compared, skippedNullable, skippedInvalid, mismatches };
}

test('generated patterns agree with RegExp exactly', () => {
  const result = sweep({ seed: 20261030, rounds: 3000 });

  assert.deepEqual(
    result.mismatches.slice(0, 5),
    [],
    `${result.mismatches.length} of ${result.compared} comparisons disagreed`,
  );
  // Guards against the sweep silently comparing nothing, which would make
  // this test pass by doing no work.
  assert.ok(result.compared > 800, `expected a real sample, compared ${result.compared}`);
});

test('a second seed agrees too', () => {
  // A different seed reaches different shapes. One seed passing could be
  // luck; two is evidence.
  const result = sweep({ seed: 777, rounds: 3000 });

  assert.deepEqual(result.mismatches.slice(0, 5), [], 'mismatches on the second seed');
  assert.ok(result.compared > 800, `compared ${result.compared}`);
});

test('deeper patterns agree too', () => {
  const result = sweep({ seed: 31337, rounds: 1200, depth: 3 });

  assert.deepEqual(result.mismatches.slice(0, 5), [], 'mismatches at depth 3');
  assert.ok(result.compared > 200, `compared ${result.compared}`);
});

test('the sweep actually excludes the nullable cases it claims to', () => {
  // If this were zero, the exclusion would be doing nothing and the two
  // earlier tests would be making a stronger claim than the engine supports.
  const result = sweep({ seed: 20261030, rounds: 1000 });
  assert.ok(
    result.skippedNullable > 100,
    `expected the generator to produce nullable quantifiers, skipped ${result.skippedNullable}`,
  );
});

test('the boundary is where the engine says it is', () => {
  // The documented difference, pinned so a change to it is deliberate.
  // ECMAScript refuses the zero-width iteration and leaves the group unset.
  const reference = /(b{0,2})?/.exec(' a ');
  assert.equal(reference[1], undefined, 'RegExp leaves the group unset');

  const mine = new Regex('(b{0,2})?').match(' a ');
  assert.equal(mine[1], '', 'this engine records the empty iteration');

  // And it is detectable in advance, which is what makes it a boundary
  // rather than a surprise.
  assert.ok(hasNullableQuantifier(new Regex('(b{0,2})?').ast));
  assert.ok(!hasNullableQuantifier(new Regex('(b{1,2})?').ast));
});

test('every pattern in the supported subset either parses or is refused by name', () => {
  // No generated pattern should produce an error this engine does not
  // explain. A bare TypeError or RangeError escaping would mean a hole.
  const rnd = random(4242);
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  for (let round = 0; round < 1500; round++) {
    const pattern = generate(rnd, 2);
    const flags = pick(FLAG_SETS);

    try {
      new Regex(pattern, flags);
    } catch (error) {
      assert.ok(
        error.name === 'PatternError' || error.name === 'UnsupportedError',
        `/${pattern}/${flags} threw an unexplained ${error.name}: ${error.message}`,
      );
    }
  }
});
