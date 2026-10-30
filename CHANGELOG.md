# Changelog

Notable changes to Kleene. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-30

First release. Everything is new, so this entry records the decisions worth
knowing rather than a list of additions.

### Added

- **A linear-time matcher.** A Pike VM over a Thompson NFA: every path runs at
  once, one input character at a time. Matching is O(subject × program) for
  every pattern, with no input that escapes it.
- **The syntax JavaScript has**, minus backreferences and lookaround:
  literals, `.`, classes with ranges and negation, the named classes, `*` `+`
  `?` `{n,m}` and their lazy forms, capturing, non-capturing and named groups,
  alternation, `^ $ \b \B`, and the `g i m s u y` flags.
- **A `RegExp`-shaped API**: `test`, `exec`, `match`, `matchAll`, `replace`,
  `split`, `lastIndex`, `source`, `flags`. Shaped that way so the two can be
  swapped and compared, which is how the engine was tested.
- **`explain` and a disassembler**, so the compiled program can be read.
- **A command line**: `match`, `find`, `replace`, `split`, `explain`, with the
  flags a shell user expects and distinct exit codes.
- **164 tests**, including three randomised differential sweeps against the
  host's own engine, a hand-written linter, and benchmarks that print both
  engines side by side.
- **CI** on Node 20, 22 and 24 on Linux plus one version each on Windows and
  macOS, with gates asserting the dependency count is zero and driving the
  real binary end to end.

### Decisions worth recording

- **Linear time is the product.** `(a+)+b` against 10,000 a's takes 5.58ms
  here; against 26 a's `RegExp` takes 865ms, doubling with every further
  character. Everything below is a consequence of keeping that true.
- **No backreferences and no lookaround.** Both make a thread's future depend
  on something a single pass cannot know, which breaks the
  one-thread-per-instruction bound the guarantee rests on. Refused by name at
  parse time with a message saying why, and as `UnsupportedError` rather than
  `PatternError` so a caller can tell "your pattern is wrong" from "this tool
  cannot do that".
- **About 50× slower than `RegExp` on patterns that backtrack fine**, and the
  benchmark prints it rather than omitting it. `RegExp` is years of C++ with a
  JIT; this is three thousand lines of JavaScript.
- **Greediness is the order of a split's two targets.** No priority queue and
  no backtracking: threads run in order and the first to reach `match` wins.
- **Character sets are sorted range lists.** `\w` under `i` covers tens of
  thousands of code points; a `Set` of those is megabytes and a bitmap is
  136KB per class.
- **`a**` is refused.** This engine would survive it, but accepting it would
  mean compiling something the author did not write.
- **The CLI returns an exit code** rather than calling `process.exit`, which
  is what lets all 40-odd CLI tests run in-process and assert on stdout,
  stderr and the code together.

### Fixed before release

Four bugs, each recorded for how it was found rather than what it was. Two
came from the randomised differential sweep, which earned its place.

- **Captures were not cleared between quantifier iterations.** ECMAScript
  resets a quantified group's captures each time round, so
  `(?:(a)|(b))+` against `"ab"` must leave group 1 unset rather than holding
  the `a` from the first pass. Fixed with a `clear` instruction at the top of
  each iteration. Found by the differential sweep, on a pattern well inside
  the range where parity is promised.
- **The parser split surrogate pairs.** It indexed the pattern as UTF-16
  units, so `/😀+/` became a high surrogate, a low surrogate and a `+` — and
  the `+` applied to half a character, which can never match. The VM already
  walked code points; the parser now does too.
- **`split` only split once.** It inherited `matchAll`'s early return, which
  respects the `g` flag — but `String.prototype.split` ignores `g` and always
  breaks on every occurrence. Two further edge cases came out of checking it
  against `String.split` properly: a zero-width match at the very end is not a
  separator, and an empty subject splits to `[]` rather than `['']` when the
  separator matches it.
- **`parse` leaked a raw `TypeError`** for a non-string pattern. It is
  exported, so a caller reaching it directly deserves the same error
  everything else raises rather than one from inside the scanner.

Two of my own test expectations were also wrong rather than the code: the
matched text keeps the *subject's* case under the `i` flag, and `` $` ``
expands to everything before the match, so replacing `b` in `abc` with it
gives `aac` and not `ac`.

### Known limitations

No backreferences, no lookaround, no Unicode property escapes, no lazy DFA.
One documented capture difference for nullable quantifier bodies, detectable
in advance via `hasNullableQuantifier`. `{n,m}` is copied out, so its upper
bound is capped at 10,000. See the README and `docs/architecture.md`.

[0.1.0]: https://github.com/Mohammed-Abdul-Raqueeb/kleene/releases/tag/v0.1.0
