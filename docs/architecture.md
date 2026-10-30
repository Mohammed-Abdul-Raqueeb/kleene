# Architecture

How the engine works, and what each choice cost.

## The pipeline

```
  pattern text
       │
       ▼
  ┌──────────┐  tree   ┌────────────┐  tree  ┌────────────┐  program
  │  parser  │ ──────▶ │  simplify  │ ─────▶ │  compiler  │ ────────┐
  └──────────┘         └────────────┘        └────────────┘         │
   parser.js            simplify.js           compiler.js           │
       │                                                            ▼
    ast.js                                                   ┌────────────┐
   charset.js                                                │  Pike VM   │
                                                             └────────────┘
                                                                 pike.js
```

Four stages. Each fails for a different reason the user needs told apart:

- **Parser** — unbalanced brackets, a backwards range, `a**`. Reported with
  the index and a caret.
- **Parser, again, differently** — a backreference or a lookahead. Valid
  elsewhere, never going to work here, so it raises `UnsupportedError`
  instead. One means fix your typo; the other means use a different tool.
- **Compiler** — a program over the instruction limit.
- **VM** — effectively nothing. Everything that can go wrong was caught
  earlier, which is why `MatchError` has only one use.

## Everything rests on the Pike VM

A backtracking engine tries one path and, when it fails, winds back and tries
another. A Pike VM runs **every** path at once, one input character at a
time. A "thread" is a program counter plus a set of capture slots; at each
position the VM steps every live thread over the next character and keeps the
survivors.

The property that falls out of this is the whole product:

> The thread list can never hold two threads at the same program counter,
> because a second one would explore exactly what the first already is.

That caps the list at the program's length, so matching is
O(subject × program) for **every** pattern. There is no input that makes it
blow up.

```
(a+)+b against 10,000 a's      kleene  5.58ms
(a+)+b against 26 a's          RegExp  865ms
```

Each extra character doubles the time on the right and adds a constant on the
left. At 60 a's a backtracking engine would outlast the universe.

### What it costs

**No backreferences.** `(a+)\1` needs a thread's future to depend on text it
has already consumed, so two threads at the same program counter are no
longer interchangeable and the bound collapses. Matching backreferences is
NP-hard in general, which is the formal version of the same statement.

**No lookaround.** `(?=a)` is an assertion about a different parse of the
same input, which a single pass over the input cannot evaluate.

Both are refused **by name** at parse time, with a message saying why, rather
than this file failing obscurely later.

**Slower on ordinary patterns.** About fifty times slower than `RegExp` on a
pattern that backtracks fine, and that is a fair trade to state plainly:
`RegExp` is years of C++ with a JIT, and the guarantee is the product rather
than the speed.

## Greediness is the order of two integers

There is no priority queue and no backtracking. A `split` instruction has two
targets, and the VM follows `x` before `y`. The compiler puts the preferred
branch in `x`:

```
greedy a*            lazy a*?
  L1: split L2, L3     L1: split L3, L2
  L2: char a           L2: char a
      jump L1              jump L1
  L3:                  L3:
```

Threads run in order and the first to reach `match` wins, so ordering the
branches orders the preferences. That is all `*` versus `*?` is.

## Character sets are range lists

`\w` under the `i` flag, or `[^\n]`, covers tens of thousands of code points.
A `Set` of those is megabytes; a bitmap over Unicode is 136KB per class. A
sorted list of inclusive ranges is four entries, and `has` is a binary search
over it.

Normalisation — sorted, non-overlapping, **non-adjacent** — is what makes
union and negation cheap and equality a plain comparison. The adjacency part
matters more than it looks: without joining `[a-b]` and `[c-d]`, a class
built one character at a time would be one range per character and every
lookup would walk all of them.

Case folding widens the set rather than lowercasing the subject. Lowercasing
the input would shift the offsets a match reports whenever a character's
lower case is a different length, which happens for real code points.

## Code points, not UTF-16 units

Both the parser and the VM iterate code points. Two separate bugs came from
getting this wrong:

- The **VM** indexing the subject directly would make an emoji two characters,
  so `.` would match half of one and a class could split a surrogate pair.
- The **parser** indexing the pattern directly split `/😀+/` into a high
  surrogate, a low surrogate and a `+` — so the `+` applied to half a
  character, which can never match.

Offsets reported in a match are converted back to UTF-16, so a caller can
slice the original string with what it gets. `match.index` equals
`subject.indexOf(...)`, which would not hold if code-point indices leaked out.

## Captures clear on each iteration

ECMAScript resets a quantified group's captures every time round the loop, so
`(?:(a)|(b))+` against `"ab"` leaves group 1 **unset** rather than holding
the `a` from the first pass.

This engine did not do that at first, and the differential test found it. The
fix is a `clear` instruction at the top of each iteration, listing the slots
of the groups inside the body. Cheap, and it removed a whole class of
divergence from patterns that were otherwise well inside the promised range.

## The one documented difference

ECMAScript also **rejects a zero-width iteration** when a quantifier's lower
bound is zero. That is why `/(b{0,2})?/ ` leaves its group `undefined`: the
iteration matched the empty string, so the engine discards it and takes the
zero-iterations path instead.

This engine does not implement that rule, because doing so means a thread
carrying the input position each iteration began at — and a thread's identity
would then include that position, which breaks the one-thread-per-instruction
bound the linear-time guarantee rests on.

So the trade is stated as a property rather than hidden as a quirk:

> For any pattern where no quantifier's body can match the empty string, this
> engine agrees with `RegExp` exactly.

`nullable(ast)` and `hasNullableQuantifier(ast)` are exported so a caller can
ask in advance, `kleene explain` prints the answer, and the differential test
uses the same function to draw its boundary. Measured: **5,035 generated
patterns compared, 0 disagreements** once nullable quantifier bodies are
excluded.

## The program is a flat array

Instructions with numeric jump targets, not a graph of state objects. Two
reasons:

- A thread is an integer, so the "have I run this state here already?" check
  is an array lookup rather than a `Set` of objects. `ThreadList` holds a
  generation number per instruction, so clearing it once per input character
  is incrementing one integer rather than refilling an array.
- **It is printable.** `kleene explain` disassembles the program, and being
  able to read what the compiler produced is how most of the bugs in it were
  found.

## Bounded repeats are copied out

`a{3,5}` becomes three mandatory copies and two optional ones. The cost is
program size, which is why `MAX_REPEAT` is 10,000 and the limit is reported
rather than the engine quietly building a million instructions.

The alternative — a counter in the VM — would mean a thread's identity
included its counts, and the one-thread-per-instruction bound would go with
it. The same reason the empty-check rule is absent.

## What is deliberately missing

- **A lazy DFA.** The standard next step for speed: cache subset-construction
  states so a boolean search needs no thread list. It would close much of the
  fifty-times gap on ordinary patterns, and it is a second engine to keep
  correct.
- **Unicode property escapes.** `\p{Letter}` needs the Unicode character
  database, which is megabytes of tables.
- **Backreferences and lookaround.** Covered above. Not oversights.
- **`y` with `matchAll`.** Sticky is honoured by `exec`; `matchAll` treats it
  as a scan from each position.
