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

