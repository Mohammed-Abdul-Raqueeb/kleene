/**
 * Shared test helpers.
 *
 * Two things, both to do with what `node:assert` does not give you:
 * `assert.throws` checks that something threw and returns nothing, so
 * asserting on a message means catching by hand; and almost every test in
 * this suite wants to compare against `RegExp`, which deserves one function
 * rather than being spelled out each time.
 */

import assert from 'node:assert/strict';

import { Regex } from '../src/index.js';
import { hasNullableQuantifier } from '../src/ast.js';

/**
 * Asserts that `fn` throws an instance of `type`, and returns the error.
 *
 * @param {Function} fn the body to run
 * @param {Function} type the constructor expected
 * @returns {Error} the thrown error, for further assertions
 */
export function throwsWith(fn, type) {
  let thrown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown !== undefined, `expected ${type.name} but nothing was thrown`);
  assert.ok(
    thrown instanceof type,
    `expected ${type.name} but got ${thrown.constructor.name}: ${thrown.message}`,
  );
  return thrown;
}

/**
 * Normalises a match for comparison.
 *
 * `undefined` becomes null so it survives JSON, and only the parts both
 * engines promise are compared: the groups, the index, and the named groups.
 *
 * @param {object|null} found a match object
 * @returns {string} a comparable rendering
 */
export function renderMatch(found) {
  if (found === null || found === undefined) return 'null';
  return JSON.stringify({
    groups: [...found].map((value) => (value === undefined ? null : value)),
    index: found.index,
    named: found.groups ? { ...found.groups } : null,
  });
}

/**
 * Asserts that this engine and `RegExp` agree on a pattern and subject.
 *
 * Refuses to run on a pattern whose quantifier body is nullable, because
 * those are outside the range where the two are guaranteed to agree and a
 * test that compared them there would be asserting a difference, not a
 * property. See `nullable` in src/ast.js.
 *
 * @param {string} pattern the pattern
 * @param {string} subject the text to search
 * @param {string} [flags] the flag letters
 */
export function agreesWithRegExp(pattern, subject, flags = '') {
  const mine = new Regex(pattern, flags);

  assert.ok(
    !hasNullableQuantifier(mine.ast),
    `/${pattern}/ quantifies a nullable body, so RegExp parity is not promised;`
      + ' assert the behaviour directly instead',
  );

  const theirs = new RegExp(pattern, flags);
  assert.equal(
    renderMatch(mine.match(subject)),
    renderMatch(theirs.exec(subject)),
    `/${pattern}/${flags} against ${JSON.stringify(subject)}`,
  );
}

