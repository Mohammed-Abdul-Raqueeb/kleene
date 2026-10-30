/**
 * Turns a pattern into a tree.
 *
 * Recursive descent over three levels, which is all the grammar has:
 *
 *   alternation := concat ('|' concat)*
 *   concat      := repeat*
 *   repeat      := atom ('*' | '+' | '?' | '{n,m}')* '?'?
 *   atom        := char | '.' | '[' class ']' | '(' alternation ')' | escape | anchor
 *
 * The one place it is not a clean recursion is the postfix quantifiers, which
 * loop so that `a**` is a parse error rather than a nested repetition --
 * `(a*)*` is what someone writing that almost certainly did not mean, and an
 * error is better than silently compiling something exponential.
 */

import * as A from './ast.js';
import {
  CharSet, CLASSES, DOT_NO_NEWLINE, NEGATED_CLASSES,
} from './charset.js';
import { PatternError, UnsupportedError } from './errors.js';

/** The most repetitions `{n,m}` may ask for. */
export const MAX_REPEAT = 10000;

/** How deeply groups may nest. */
export const MAX_DEPTH = 100;

