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

function describe(instruction) {
  switch (instruction.op) {
    case Op.CHAR:
      return `char    ${instruction.set}`;
    case Op.SPLIT:
      return `split   ${instruction.x}, ${instruction.y}`;
    case Op.JUMP:
      return `jump    ${instruction.x}`;
    case Op.SAVE:
      // Even slots are group starts, odd are ends, so slot 2 is "group 1
      // starts here". Printing it that way saves the reader the arithmetic.
      return `save    ${instruction.slot}`
        + `   (group ${instruction.slot >> 1} ${instruction.slot % 2 === 0 ? 'start' : 'end'})`;
    case Op.CLEAR:
      return `clear   ${instruction.slots.join(', ')}`;
    case Op.ASSERT_START:
      return 'assert  start';
    case Op.ASSERT_END:
      return 'assert  end';
    case Op.ASSERT_BOUNDARY:
      return `assert  ${instruction.negated ? 'not-' : ''}word-boundary`;
    case Op.MATCH:
      return 'match';
    default:
      return `?       ${instruction.op}`;
  }
}

/** Builds an instruction list, resolving jumps as it goes. */
export class ProgramBuilder {
  constructor() {
    this.instructions = [];
  }

  /** The index the next instruction will land at. */
  get here() {
    return this.instructions.length;
  }

  /**
   * Appends an instruction.
   *
   * @param {object} instruction the instruction
   * @returns {number} where it landed, for patching jumps to it
   */
  emit(instruction) {
    this.instructions.push(instruction);
    return this.instructions.length - 1;
  }

  /**
   * Appends a placeholder to be filled in later.
   *
   * Forward jumps are unavoidable in a single pass -- a `split` at the start
   * of an alternation has to point past a branch that has not been compiled
   * yet -- so they are emitted blank and patched once the target is known.
   *
   * @param {string} op the opcode
   * @returns {number} where it landed
   */
  emitPlaceholder(op) {
    return this.emit({ op, x: -1, y: -1 });
  }

  /**
   * Fills in a placeholder's targets.
   *
   * @param {number} at the instruction to patch
   * @param {object} targets the `x` and optionally `y` to set
   */
  patch(at, targets) {
    Object.assign(this.instructions[at], targets);
  }

  /**
   * Finishes the program.
   *
   * @param {number} slotCount how many capture slots are used
   * @param {object} meta flags and names to carry along
   * @returns {Program} the program
   */
  build(slotCount, meta) {
    // Checked rather than assumed: a placeholder left unpatched is a compiler
    // bug that would otherwise present as a thread jumping to -1 and the
    // match quietly failing.
    this.instructions.forEach((instruction, at) => {
      if (instruction.op === Op.SPLIT && (instruction.x < 0 || instruction.y < 0)) {
        throw new Error(`compiler bug: split at ${at} was never patched`);
      }
      if (instruction.op === Op.JUMP && instruction.x < 0) {
        throw new Error(`compiler bug: jump at ${at} was never patched`);
      }
    });

    return new Program(this.instructions, slotCount, meta);
  }
}
