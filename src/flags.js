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

