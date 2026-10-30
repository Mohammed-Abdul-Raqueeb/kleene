/**
 * Flag letters, parsed into a plain object.
 *
 * The same letters JavaScript uses, so a pattern copied from a `RegExp`
 * keeps its meaning. `u` is accepted and ignored: this engine always works
 * in code points, which is what `u` asks for, so there is nothing for the
 * flag to switch on.
 */

import { PatternError } from './errors.js';

/** The letters this engine understands. */
export const SUPPORTED = 'gimsuy';

/**
 * Parses a flag string.
 *
 * @param {string} [flags] the letters
 * @returns {object} the parsed flags
 * @throws {PatternError} on an unknown or repeated letter
 */
export function parseFlags(flags = '') {
  if (typeof flags !== 'string') {
    throw new PatternError(`flags must be a string, got ${typeof flags}`);
  }

  const parsed = {
    global: false,
    ignoreCase: false,
    multiline: false,
    dotAll: false,
    unicode: false,
    sticky: false,
    source: flags,
  };

  const seen = new Set();

  for (const letter of flags) {
    if (seen.has(letter)) {
      // Repeated letters are a typo rather than an intent, and ignoring them
      // hides the typo.
      throw new PatternError(`the flag '${letter}' is given twice`);
    }
    seen.add(letter);

    switch (letter) {
      case 'g': parsed.global = true; break;
      case 'i': parsed.ignoreCase = true; break;
      case 'm': parsed.multiline = true; break;
      case 's': parsed.dotAll = true; break;
      case 'u': parsed.unicode = true; break;
      case 'y': parsed.sticky = true; break;
      default:
        throw new PatternError(
          `'${letter}' is not a flag this engine knows; the flags are ${SUPPORTED}`,
        );
    }
  }

  return parsed;
}

/**
 * Renders parsed flags back to their letters, in JavaScript's order.
 *
 * @param {object} flags the parsed flags
 * @returns {string} the letters
 */
export function renderFlags(flags) {
  return [
    flags.dotAll ? 's' : '',
    flags.global ? 'g' : '',
    flags.ignoreCase ? 'i' : '',
    flags.multiline ? 'm' : '',
    flags.unicode ? 'u' : '',
    flags.sticky ? 'y' : '',
  ].join('');
}
