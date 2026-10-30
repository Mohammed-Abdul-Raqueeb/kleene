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

/**
 * Runs a program against a subject, starting at `start`.
 *
 * @param {import('./program.js').Program} program the compiled pattern
 * @param {string} subject the text to search
 * @param {number} start where to begin
 * @param {object} [options]
 * @param {boolean} [options.anchored] when true, only try to match at `start`
 * @returns {number[]|null} the capture slots, or null when there is no match
 */
export function run(program, subject, start, { anchored = false } = {}) {
  const { instructions, slotCount } = program;
  const multiline = Boolean(program.meta.flags?.multiline);

  // Code points, not UTF-16 units. A pattern written with `.` should treat an
  // emoji as one character, and indexing the string directly would make it
  // two -- and could split a surrogate pair inside a character class.
  const chars = [...subject];

  // Maps a UTF-16 index back from a code-point index, so the offsets reported
  // match what a caller gets from `String.prototype.indexOf`.
  const offsets = new Array(chars.length + 1);
  let utf16 = 0;
  for (let i = 0; i < chars.length; i++) {
    offsets[i] = utf16;
    utf16 += chars[i].length;
  }
  offsets[chars.length] = utf16;

  // Translate the UTF-16 start into a code-point index.
  let from = 0;
  while (from < chars.length && offsets[from] < start) from++;

  let current = new ThreadList(instructions.length);
  let next = new ThreadList(instructions.length);
  let matched = null;

  for (let at = from; at <= chars.length; at++) {
    // A fresh thread is added at every position until something matches,
    // which is what makes an unanchored search work without an explicit
    // `.*?` prefix. Once there is a match, no new thread is added: a later
    // start could only produce a worse (further right) match.
    if (matched === null && (!anchored || at === from)) {
      const fresh = new Array(slotCount).fill(-1);
      addThread(current, instructions, at, fresh, chars, multiline, offsets);
    }

    if (current.size === 0 && matched !== null) break;
    if (current.size > MAX_THREADS) {
      throw new MatchError(
        `this pattern needs more than ${MAX_THREADS} simultaneous threads`,
      );
    }

    const char = at < chars.length ? chars[at].codePointAt(0) : -1;

    for (let i = 0; i < current.size; i++) {
      const thread = current.threads[i];
      const instruction = instructions[thread.pc];

      switch (instruction.op) {
        case Op.CHAR:
          // The character matched, so this thread survives into the next
          // position, continuing at the instruction after the char.
          if (char >= 0 && instruction.set.has(char)) {
            addThread(
              next, instructions, at + 1, thread.slots, chars, multiline, offsets,
              thread.pc + 1,
            );
          }
          break;

        case Op.MATCH:
          // The first thread to match wins, and threads are in priority
          // order, so every later thread at this position is a worse
          // alternative and can be dropped.
          matched = thread.slots.slice();
          current.size = i + 1;
          break;

        default:
          // Everything else consumes nothing and was already handled when the
          // thread was added.
          break;
      }
    }

    const swap = current;
    current = next;
    next = swap;
    next.clear();
  }

  return matched;
}

/**
 * Adds a thread, following everything that consumes no input.
 *
 * The recursion through splits and jumps happens here rather than in the main
 * loop, so the loop only ever sees instructions that consume. The `seen`
 * check inside {@link ThreadList} is what stops a cycle of jumps -- `(?:)*`
 * compiles to a loop that consumes nothing -- from recursing for ever.
 */
function addThread(list, instructions, at, slots, chars, multiline, offsets, pc = 0) {
  if (list.seen[pc] === list.generation) return;
  list.seen[pc] = list.generation;

  const instruction = instructions[pc];

  switch (instruction.op) {
    case Op.JUMP:
      addThread(list, instructions, at, slots, chars, multiline, offsets, instruction.x);
      return;

    case Op.SPLIT:
      // x before y, which is where greediness lives: the compiler puts the
      // preferred branch in x, and this adds it to the list first.
      addThread(list, instructions, at, slots, chars, multiline, offsets, instruction.x);
      addThread(list, instructions, at, slots, chars, multiline, offsets, instruction.y);
      return;

    case Op.CLEAR: {
      // Copied rather than mutated, for the same reason SAVE copies: two
      // threads can share a slot array until one of them writes.
      const copy = slots.slice();
      for (const slot of instruction.slots) copy[slot] = -1;
      addThread(list, instructions, at, copy, chars, multiline, offsets, pc + 1);
      return;
    }

    case Op.SAVE: {
      // Copied rather than mutated: two threads can share a slot array until
      // one of them writes, and mutating in place would corrupt the other's
      // captures.
      const copy = slots.slice();
      copy[instruction.slot] = offsets[at];
      addThread(list, instructions, at, copy, chars, multiline, offsets, pc + 1);
      return;
    }

    case Op.ASSERT_START:
      if (at === 0 || (multiline && isLineTerminator(chars[at - 1]))) {
        addThread(list, instructions, at, slots, chars, multiline, offsets, pc + 1);
      }
      return;

    case Op.ASSERT_END:
      if (at === chars.length || (multiline && isLineTerminator(chars[at]))) {
        addThread(list, instructions, at, slots, chars, multiline, offsets, pc + 1);
      }
      return;

    case Op.ASSERT_BOUNDARY: {
      const before = at > 0 && isWord(chars[at - 1]);
      const after = at < chars.length && isWord(chars[at]);
      const boundary = before !== after;
      if (boundary !== instruction.negated) {
        addThread(list, instructions, at, slots, chars, multiline, offsets, pc + 1);
      }
      return;
    }

    default:
      // CHAR and MATCH are the two the main loop handles.
      list.push(pc, slots);
  }
}

