/**
 * Turns a tree into a program.
 *
 * Thompson's construction, with one departure: there are no epsilon
 * transitions as such. A `split` consumes nothing, which is the same thing
 * expressed as an instruction rather than as an edge, and it is what lets the
 * VM walk the program as a flat array.
 *
 * Greediness is expressed entirely by the order of a split's two targets.
 * The VM runs threads in order and the first to reach `match` wins, so
 * putting the "one more repetition" branch first makes the repeat greedy and
 * putting it second makes it lazy. There is no backtracking and no priority
 * queue -- just the order of two integers.
 */

import { Kind, UNBOUNDED, walk } from './ast.js';
import { Op, ProgramBuilder } from './program.js';
import { PatternError } from './errors.js';

/** The most instructions a program may hold. */
export const MAX_PROGRAM = 100000;

