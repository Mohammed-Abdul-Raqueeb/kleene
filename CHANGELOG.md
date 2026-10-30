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

