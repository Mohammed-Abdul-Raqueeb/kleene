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

/**
 * Compiles a tree.
 *
 * @param {object} node the root
 * @param {object} options
 * @param {number} options.groupCount how many capture groups the tree holds
 * @param {object} [options.flags] the parsed flags, carried into the program
 * @param {Map<string, number>} [options.names] named groups
 * @param {string} [options.pattern] the source, for error messages
 * @returns {import('./program.js').Program} the program
 */
export function compile(node, { groupCount, flags = {}, names = new Map(), pattern = '' }) {
  const builder = new ProgramBuilder();

  // Slot 0 and 1 hold the whole match, so group N uses slots 2N and 2N+1.
  // Emitting the outer save pair here rather than wrapping the tree in a
  // synthetic group keeps `groupCount` meaning what it says.
  builder.emit({ op: Op.SAVE, slot: 0 });
  emit(builder, node, pattern);
  builder.emit({ op: Op.SAVE, slot: 1 });
  builder.emit({ op: Op.MATCH });

  if (builder.here > MAX_PROGRAM) {
    throw new PatternError(
      `this pattern compiles to ${builder.here} instructions, over the limit of ${MAX_PROGRAM}`,
      { pattern, index: 0 },
    );
  }

  return builder.build((groupCount + 1) * 2, { flags, names, groupCount, pattern });
}

function emit(builder, node, pattern) {
  switch (node.kind) {
    case Kind.EMPTY:
      // Nothing to emit. The empty pattern matches the empty string, which
      // falls out of there being no instructions between the saves.
      return;

    case Kind.CHARSET:
      builder.emit({ op: Op.CHAR, set: node.set });
      return;

    case Kind.CONCAT:
      for (const part of node.parts) emit(builder, part, pattern);
      return;

    case Kind.ALTERNATE:
      emitAlternate(builder, node, pattern);
      return;

    case Kind.REPEAT:
      emitRepeat(builder, node, pattern);
      return;

    case Kind.GROUP:
      if (node.number < 0) {
        emit(builder, node.body, pattern);
        return;
      }
      builder.emit({ op: Op.SAVE, slot: node.number * 2 });
      emit(builder, node.body, pattern);
      builder.emit({ op: Op.SAVE, slot: node.number * 2 + 1 });
      return;

    case Kind.ANCHOR:
      builder.emit({
        op: node.which === 'start' ? Op.ASSERT_START : Op.ASSERT_END,
      });
      return;

    case Kind.BOUNDARY:
      builder.emit({ op: Op.ASSERT_BOUNDARY, negated: node.negated });
      return;

    default:
      throw new Error(`compiler bug: cannot emit a ${node.kind} node`);
  }
}

/**
 * `a|b|c` becomes a chain of splits.
 *
 *     split L1, L2
 *   L1: <a>
 *     jump END
 *   L2: split L3, L4
 *   L3: <b>
 *     jump END
 *   L4: <c>
 *   END:
 */
function emitAlternate(builder, node, pattern) {
  const jumpsToEnd = [];

  for (let i = 0; i < node.options.length; i++) {
    const isLast = i === node.options.length - 1;

    if (isLast) {
      emit(builder, node.options[i], pattern);
      break;
    }

    const split = builder.emitPlaceholder(Op.SPLIT);
    builder.patch(split, { x: builder.here });
    emit(builder, node.options[i], pattern);
    jumpsToEnd.push(builder.emitPlaceholder(Op.JUMP));
    builder.patch(split, { y: builder.here });
  }

  const end = builder.here;
  for (const jump of jumpsToEnd) builder.patch(jump, { x: end });
}

/**
 * The capture slots of every group inside a node.
 *
 * Used to clear them at the top of each repeat iteration.
 */
function slotsIn(node) {
  const slots = [];
  walk(node, (current) => {
    if (current.kind === Kind.GROUP && current.number >= 0) {
      slots.push(current.number * 2, current.number * 2 + 1);
    }
  });
  return slots.sort((a, b) => a - b);
}

function emitRepeat(builder, node, pattern) {
  const { min, max, greedy, body } = node;
  const captured = slotsIn(body);

  /** Emits the body, clearing its captures first when it has any. */
  const emitIteration = () => {
    if (captured.length > 0) builder.emit({ op: Op.CLEAR, slots: captured });
    emit(builder, body, pattern);
  };

  // `{min,}` and `{min,max}` are compiled by laying out `min` mandatory
  // copies and then the optional part. Copying the body is the cost of not
  // having a counter in the VM, and a counter would mean a thread's identity
  // included its counts -- which would break the "one thread per program
  // position" bound that makes the VM linear.
  for (let i = 0; i < min; i++) {
    emitIteration();
  }

  if (max === UNBOUNDED) {
    // `a{2,}` is `aa` then `a*`: the mandatory copies are already emitted
    // above, so what remains is a star either way.
    emitStar(builder, body, greedy, pattern, captured);
    return;
  }

  // A bounded repeat becomes nested optionals: `a{0,3}` is `(a(a(a)?)?)?`.
  // Laid out as a chain of splits that all jump to the same end.
  const optional = max - min;
  const splits = [];

  for (let i = 0; i < optional; i++) {
    const split = builder.emitPlaceholder(Op.SPLIT);
    splits.push(split);
    builder.patch(split, greedy ? { x: builder.here } : { y: builder.here });
    emitIteration();
  }

  const end = builder.here;
  for (const split of splits) {
    builder.patch(split, greedy ? { y: end } : { x: end });
  }
}

/**
 * `a*` becomes:
 *
 *   L1: split L2, L3      (greedy: body first; lazy: exit first)
 *   L2: <a>
 *     jump L1
 *   L3:
 */
function emitStar(builder, body, greedy, pattern, captured = []) {
  const start = builder.here;
  const split = builder.emitPlaceholder(Op.SPLIT);

  const bodyAt = builder.here;
  // Inside the loop, so it runs once per iteration rather than once in total.
  if (captured.length > 0) builder.emit({ op: Op.CLEAR, slots: captured });
  emit(builder, body, pattern);

  // A body that consumes nothing would make this loop for ever: `(?:)*` or
  // `(a?)*`. Guarded by checking whether any instruction between the split
  // and here can consume, rather than by a runtime check, so the cost is
  // paid once at compile time.
  if (!canConsume(builder, bodyAt, builder.here)) {
    // Emitted as a plain optional instead of a loop. One iteration of
    // something that consumes nothing is indistinguishable from any other
    // number, so the loop is pointless rather than wrong.
    builder.patch(split, greedy ? { x: bodyAt, y: builder.here } : { x: builder.here, y: bodyAt });
    return;
  }

  builder.emit({ op: Op.JUMP, x: start });
  const end = builder.here;

  builder.patch(split, greedy ? { x: bodyAt, y: end } : { x: end, y: bodyAt });
}

/** Whether any instruction in a range consumes input. */
function canConsume(builder, from, to) {
  for (let at = from; at < to; at++) {
    if (builder.instructions[at].op === Op.CHAR) return true;
  }
  return false;
}
