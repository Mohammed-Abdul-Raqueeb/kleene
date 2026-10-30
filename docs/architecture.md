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

