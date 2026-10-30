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

