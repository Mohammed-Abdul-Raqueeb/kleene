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

