/**
 * The instruction set the engine runs.
 *
 * A flat array of instructions with numeric jump targets, rather than a graph
 * of state objects. Two reasons, and the second is the one that matters:
 *
 *   - A thread is an integer program counter, so the VM's "have I already
 *     run this state at this input position?" check is an array lookup
 *     rather than a Set of objects.
 *   - It is printable. `kleene explain` disassembles the program, and being
 *     able to read what the compiler produced is how most of the bugs in it
 *     were found.
 */

/** Instruction opcodes. */
export const Op = {
  /** Consume one character if it is in `set`, else the thread dies. */
  CHAR: 'char',
  /** Fork: try `x` first, then `y`. Consumes nothing. */
  SPLIT: 'split',
  /** Continue at `x`. Consumes nothing. */
  JUMP: 'jump',
  /** Record the current position as the start or end of a capture group. */
  SAVE: 'save',
  /**
   * Reset capture slots to unset.
   *
   * Emitted at the top of each iteration of a repeat whose body captures.
   * ECMAScript clears a quantified group's captures on every iteration, so
   * `(?:(a)|(b))+` against "ab" leaves group 1 unset rather than holding
   * the 'a' from the first pass. Without this the engine would disagree
   * with RegExp on a pattern that is otherwise well inside the range where
   * it promises not to.
   */
  CLEAR: 'clear',
  /** Succeed if at the start of the input, or after a newline under `m`. */
  ASSERT_START: 'assertStart',
  /** Succeed if at the end of the input, or before a newline under `m`. */
  ASSERT_END: 'assertEnd',
  /** Succeed if this position is a word boundary. */
  ASSERT_BOUNDARY: 'assertBoundary',
  /** The whole pattern has matched. */
  MATCH: 'match',
};

/** A compiled pattern. */
export class Program {
  /**
   * @param {object[]} instructions the instruction list
   * @param {number} slotCount how many capture slots the program writes
   * @param {object} meta flags, group names and the source pattern
   */
  constructor(instructions, slotCount, meta = {}) {
    this.instructions = instructions;
    this.slotCount = slotCount;
    this.meta = meta;
  }

  /** How many instructions the program holds. */
  get length() {
    return this.instructions.length;
  }

  /**
   * Renders the program as readable assembly.
   *
   * @returns {string} one instruction per line, numbered
   */
  disassemble() {
    const width = String(this.instructions.length - 1).length;

    return this.instructions.map((instruction, at) => {
      const label = String(at).padStart(width, ' ');
      return `${label}  ${describe(instruction)}`;
    }).join('\n');
  }
}

