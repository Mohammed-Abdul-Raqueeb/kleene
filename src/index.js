/**
 * The public API.
 *
 * A linear-time regular expression engine. The headline property is that no
 * input makes it slow: matching is O(subject x program) for every pattern,
 * where a backtracking engine is exponential for some.
 *
 * The cost of that guarantee is that backreferences and lookaround are not
 * supported. Both are refused by name at parse time rather than failing
 * obscurely later.
 */

export { Regex } from './regex.js';
export { PatternError, UnsupportedError, MatchError } from './errors.js';
export { CharSet } from './charset.js';
export { parse } from './parser.js';
export { compile } from './compiler.js';
export { simplify } from './simplify.js';
export { parseFlags, renderFlags, SUPPORTED as SUPPORTED_FLAGS } from './flags.js';
export { Op, Program } from './program.js';
export { Kind, render, walk, nullable, hasNullableQuantifier } from './ast.js';

import { Regex } from './regex.js';

/** The library version. */
export const VERSION = '0.1.0';

/**
 * Compiles a pattern.
 *
 * @param {string} pattern the pattern text
 * @param {string} [flags] the flag letters
 * @returns {Regex} the compiled pattern
 */
export function compilePattern(pattern, flags) {
  return new Regex(pattern, flags);
}

/**
 * Whether a pattern matches anywhere in a subject.
 *
 * Compiles on every call, so a loop should use {@link Regex} directly.
 *
 * @param {string} pattern the pattern text
 * @param {string} subject the text to search
 * @param {string} [flags] the flag letters
 * @returns {boolean} true when it matches
 */
export function test(pattern, subject, flags) {
  return new Regex(pattern, flags).test(subject);
}

/**
 * The first match of a pattern in a subject.
 *
 * @param {string} pattern the pattern text
 * @param {string} subject the text to search
 * @param {string} [flags] the flag letters
 * @returns {object|null} the match, or null
 */
export function match(pattern, subject, flags) {
  return new Regex(pattern, flags).match(subject);
}

/**
 * Every match of a pattern in a subject.
 *
 * @param {string} pattern the pattern text
 * @param {string} subject the text to search
 * @param {string} [flags] the flag letters
 * @returns {object[]} the matches, in order
 */
export function matchAll(pattern, subject, flags) {
  return [...new Regex(pattern, flags || 'g').matchAll(subject)];
}

/**
 * Replaces matches in a subject.
 *
 * @param {string} pattern the pattern text
 * @param {string} subject the text to search
 * @param {string|Function} replacement the replacement
 * @param {string} [flags] the flag letters
 * @returns {string} the result
 */
export function replace(pattern, subject, replacement, flags) {
  return new Regex(pattern, flags).replace(subject, replacement);
}
