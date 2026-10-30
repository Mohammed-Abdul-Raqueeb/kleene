# Pattern syntax

The same syntax JavaScript uses, minus two constructs that a linear-time
engine cannot have. A pattern copied from a `RegExp` works unchanged unless it
uses one of them.

## Atoms

| Form | Matches |
| --- | --- |
| `a` | the character itself |
| `.` | any character except a line terminator (any at all with `s`) |
| `[abc]` | one of these characters |
| `[a-z]` | one character in the range |
| `[^a]` | one character that is not `a` |
| `\d` `\w` `\s` | a digit, a word character, whitespace |
| `\D` `\W` `\S` | the complements |
| `\n` `\r` `\t` `\f` `\v` `\0` | the control characters |
| `\xNN` | a character by two hex digits |
| `\uNNNN` `\u{NNNNN}` | a character by code point |
| `\cA` | a control character |
| `\.` `\*` `\\` | a punctuation character, literally |

`\w` is `[A-Za-z0-9_]` and `\s` is JavaScript's set, which is wider than most
people expect — it includes the non-breaking space and the byte-order mark.

## Quantifiers

| Form | Repetitions |
| --- | --- |
| `a*` | zero or more |
| `a+` | one or more |
| `a?` | zero or one |
| `a{3}` | exactly three |
| `a{2,}` | two or more |
| `a{1,4}` | one to four |

A trailing `?` makes any of them lazy, preferring fewer:

```
/a.*b/  against "axbxb"  →  "axbxb"
/a.*?b/ against "axbxb"  →  "axb"
```

### Stacked quantifiers are refused

`a**` is an error, not a nested repetition:

```
PatternError: '*' cannot follow another quantifier; wrap the first in a
group if that is what you meant
  /a**/
     ^
```

This engine would survive `a**` — that is the whole point of it — but
accepting it would mean compiling something the author did not write. Write
`(?:a*)*` if you mean it.

Braces that do not hold a bound are literal, as everywhere else: `a{`,
`a{x}` and `a{,2}` all match themselves.

## Groups

| Form | Meaning |
| --- | --- |
| `(a)` | capturing |
| `(?:a)` | grouping only, no capture |
| `(?<name>a)` | capturing, and reachable as `match.groups.name` |

A group that did not participate reads as `undefined`, not as an empty
string. That distinction is what `(a)|(b)` depends on.

A quantified group clears its captures each time round, which is
ECMAScript's rule:

```
/(?:(a)|(b))+/ against "ab"  →  ["ab", undefined, "b"]
```

Group 1 matched on the first pass and is unset again on the second.

## Anchors and boundaries

| Form | Holds |
| --- | --- |
| `^` | at the start of the subject, or after a newline with `m` |
| `$` | at the end, or before a newline with `m` |
| `\b` | between a word character and a non-word one |
| `\B` | anywhere `\b` does not |

An anchor cannot carry a quantifier: `^*` is an error rather than being
quietly ignored.

`\b` inside a character class is a **backspace**, not a boundary. A genuine
quirk of the syntax, shared by every engine.

## Alternation

`a|b|c` tries the branches in order and the first to match wins —
leftmost-first, as Perl and JavaScript do:

```
/a|ab/ against "ab"  →  "a"
/ab|a/ against "ab"  →  "ab"
```

A POSIX engine would prefer the longest. This one does not, so that patterns
behave the way they do in the language they were written for.

An empty alternative is allowed: `a|` matches `"a"` or nothing.

## Flags

| Letter | Effect |
| --- | --- |
| `g` | find every match, and track `lastIndex` on `exec` |
| `i` | match either case |
| `m` | `^` and `$` hold at every line |
| `s` | `.` matches a line terminator too |
| `u` | accepted and ignored — this engine is always code-point based |
| `y` | anchor each `exec` to `lastIndex` |

A repeated letter is an error rather than being ignored, because it is a typo.

## What this engine does not support

Both are refused at parse time with a message saying why, and both raise
`UnsupportedError`, which is a subclass of `PatternError` — so a caller can
tell "your pattern is wrong" from "this tool cannot do that".

### Backreferences

```
PatternError: backreferences are not supported: matching them is NP-hard in
general, and this engine promises linear time
  /(a)\1/
     ^
```

`\1`–`\9` and `\k<name>`. A backreference makes a thread's future depend on
text it already consumed, which is exactly what the linear-time bound rules
out.

### Lookaround

```
UnsupportedError: lookahead is not supported: it cannot be expressed as a
finite automaton, which is what this engine builds
  /(?=a)/
   ^
```

`(?=)`, `(?!)`, `(?<=)` and `(?<!)`. Note that `(?<` is told apart from a
named group by the character after it, so `(?<name>a)` still works.

