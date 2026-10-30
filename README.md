# Kleene

A regular expression engine that **cannot be made slow by its input**, with no
dependencies at all.

```
(a+)+b against 10,000 a's      kleene  5.58ms
(a+)+b against     26 a's      RegExp   865ms
```

Each extra character doubles the time on the right and adds a constant on the
left. At sixty a's a backtracking engine would outlast the universe; this one
finishes in microseconds.

That is the entire product. Everything else about it is a consequence.

## Install

```bash
npm install @raqueeb/kleene     # as a library
npx @raqueeb/kleene explain 'a+b'   # as a command
```

Requires Node 20 or newer. Nothing to compile, nothing to fetch, no lock file.

## Use it

```js
import { Regex } from '@raqueeb/kleene';

const regex = new Regex('(?<user>[a-z]+)@(?<host>[a-z.]+)', 'g');

regex.test('write to me@example.com');          // true
regex.match('write to me@example.com').groups;  // { user: 'me', host: 'example.com' }
[...regex.matchAll(text)];                      // every match
regex.replace(text, '$<host>');                 // substitute
regex.split(text);                              // split
```

Shaped like `RegExp` on purpose — `test`, `exec`, `lastIndex`, `source`,
`flags` — so you can swap one for the other and compare. That is how most of
this engine was tested.

```bash
echo 'a1b22' | kleene find '[0-9]+'      # 1, then 22
kleene match -n 'ERROR' app.log          # matching lines, numbered
echo 'hello world' | kleene replace '(\w+) (\w+)' '$2 $1'
kleene explain '(a|b)+c'                 # the parsed tree and the program
```

## Why it is fast on the bad cases

A backtracking engine tries one path and winds back when it fails. This one
runs **every** path at once, one input character at a time — a Pike VM over a
Thompson NFA. A thread is a program counter plus capture slots, and:

> The thread list can never hold two threads at the same program counter,
> because the second would explore exactly what the first already is.

So the list is capped at the program's length, and matching is
O(subject × program) for every pattern. There is no input that escapes it.

## What that costs

Stated plainly, because it is the trade and not a footnote:

**No backreferences.** `(a+)\1` makes a thread's future depend on text it
already consumed, so two threads at the same counter stop being
interchangeable. Matching them is NP-hard in general.

**No lookaround.** `(?=a)` is an assertion about a different parse of the same
input, which one pass cannot evaluate.

Both are refused **by name** at parse time, with a message saying why:

```
UnsupportedError: lookahead is not supported: it cannot be expressed as a
finite automaton, which is what this engine builds
  /(?=a)/
   ^
```

**About 50× slower on patterns that backtrack fine.** `RegExp` is years of
C++ with a JIT; this is three thousand lines of JavaScript. `npm run bench`
prints both numbers side by side.

If your patterns are fixed and trusted, use `RegExp` — it is faster and far
more battle-worn. Use this when a pattern or a subject comes from somewhere
you do not control, and a hang is worse than being slower.

## Agreement with RegExp, measured

For any pattern where **no quantifier's body can match the empty string**,
this engine agrees with `RegExp` exactly. Measured by generating thousands of
patterns and comparing both engines:

```
5,035 generated patterns compared, 0 disagreements
```

Outside that range there is one difference. ECMAScript rejects a quantifier
iteration that consumes nothing when the lower bound is zero, so:

```js
/(b{0,2})?/.exec(' a ')[1]                // undefined  (RegExp)
new Regex('(b{0,2})?').match(' a ')[1]    // ''         (kleene)
```

Implementing that rule means a thread carrying the position each iteration
began at — and a thread's identity would then include that position, which
breaks the bound the whole guarantee rests on. So it is a documented property
rather than a hidden quirk, and it is detectable before you rely on it:

```js
import { hasNullableQuantifier, Regex } from '@raqueeb/kleene';
hasNullableQuantifier(new Regex('(b{0,2})?').ast);   // true
```

`kleene explain` prints the same answer, and the differential test uses the
same function to draw its boundary.

## Syntax

Everything JavaScript has except the two constructs above:
literals, `.`, classes with ranges and negation, `\d \w \s \D \W \S`, `*` `+`
`?` `{n,m}` and their lazy forms, groups including `(?:)` and `(?<name>)`,
alternation, `^ $ \b \B`, and the `g i m s u y` flags.

Full reference: [docs/syntax.md](docs/syntax.md).

One deliberate refusal worth knowing: `a**` is an error rather than a nested
repetition. This engine would survive it, but accepting it would mean
compiling something the author did not write.

## See what it compiled

```
$ kleene explain '(a|b)+c'
pattern     /(a|b)+c/
simplified  /([a-b])+c/
groups      1
program     12 instructions
RegExp parity  guaranteed: no quantifier body can match empty

 0  save    0   (group 0 start)
 1  save    2   (group 1 start)
 2  char    [a-b]
 3  save    3   (group 1 end)
 4  split   5, 9
 5  save    2   (group 1 start)
 6  char    [a-b]
 7  save    3   (group 1 end)
 8  jump    4
 9  char    c
10  save    1   (group 0 end)
11  match
```

The simplifier merged `a|b` into one character class. Being able to read the
program is how most of the compiler's bugs were found.

## Build and test

```bash
npm test          # 164 tests, node:test, no runner to install
npm run lint      # the house rules, including the dependency check
npm run bench     # kleene against RegExp, both directions
```

CI runs the suite on Node 20, 22 and 24 on Linux plus one version each on
Windows and macOS, asserts the manifest declares nothing and every import is
`node:` or relative, and drives the real binary end to end — including the
headline claim, so a regression hangs the job rather than passing quietly.

## What is in here

| | |
| --- | --- |
| Source | 13 files, ~3,100 lines |
| Tests | 6 files, 164 cases |
| Dependencies | 0 |

```
src/
  parser.js     pattern to a tree, three precedence levels
  ast.js        node constructors, and the nullable analysis
  charset.js    code-point sets as sorted range lists
  simplify.js   rewrites that preserve which match wins
  compiler.js   Thompson construction to a flat program
  program.js    the instruction set, and a disassembler
  pike.js       the VM: every path at once, one character at a time
  regex.js      the RegExp-shaped public matcher
  cli.js        flags and input; returns an exit code
```

## Limitations

- **No backreferences, no lookaround.** See above. Not oversights.
- **One documented capture difference** for nullable quantifier bodies,
  detectable in advance.
- **No lazy DFA**, so a boolean search still pays for the thread list. That is
  the obvious next step and would close much of the gap on ordinary patterns.
- **No Unicode property escapes** — `\p{Letter}` needs megabytes of tables.
- **`{n,m}` is copied out**, so the upper bound is capped at 10,000.

## Licence

MIT. See [LICENSE](LICENSE).
