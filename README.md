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

