/**
 * The Pike VM: runs a program against a subject in linear time.
 *
 * The idea, which is Thompson's with captures bolted on by Pike: instead of
 * trying one path and backing up, run *every* path at once, one input
 * character at a time. A "thread" is a program counter plus a set of capture
 * slots. At each position the VM holds a list of threads, steps them all
 * over the next character, and keeps the survivors.
 *
 * Why this and not backtracking: the thread list can never hold two threads
 * at the same program counter, because a second one would explore exactly
 * what the first already is. That caps the list at the program's length, so
 * the whole match is O(len(subject) x len(program)) with no exceptions --
 * no input makes it blow up. `(a+)+b` against sixty a's finishes instantly
 * here and hangs a backtracking engine for longer than the universe has
 * existed.
 *
 * What it costs: no backreferences and no lookaround. Both need a thread's
 * future to depend on text it has already consumed, which breaks the "one
 * thread per program counter" bound that the linearity rests on. The parser
 * refuses them by name rather than this file failing mysteriously.
 */

import { Op } from './program.js';
import { CLASSES } from './charset.js';
import { MatchError } from './errors.js';

/** How many threads may be live at once before the VM gives up. */
const MAX_THREADS = 200000;

