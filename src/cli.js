/**
 * The `kleene` command.
 *
 * A function taking argv and the streams, returning an exit code. Nothing
 * here calls `process.exit`; `bin/kleene.js` does that with what this
 * returns, which is what lets every flag be tested in-process.
 */

import { Regex, VERSION } from './index.js';
import { PatternError, UnsupportedError } from './errors.js';
import { hasNullableQuantifier } from './ast.js';

const USAGE = `kleene ${VERSION} - a linear-time regular expression engine

Usage: kleene <command> <pattern> [options] [file...]

Commands:
  match <pattern>      print the lines that match
  find <pattern>       print every match, one per line
  replace <pattern> <with>   substitute and print the result
  split <pattern>      split each line and print the pieces
  explain <pattern>    show the parsed pattern and the compiled program
  version
  help

Options:
  -f, --flags <letters>   regex flags: g i m s u y
  -i, --ignore-case       shorthand for --flags i
  -v, --invert            with match: print the lines that do NOT match
  -n, --line-number       prefix each line with its number
  -c, --count             print how many lines matched, not the lines
  -o, --only              with match: print the matched text, not the line
      --group <n|name>    with find: print one capture group instead
      --no-newline        with replace: do not add a trailing newline

Input comes from the named files, or from standard input.

Examples:
  echo 'a1b22' | kleene find '[0-9]+'
  kleene match -n 'ERROR' app.log
  echo 'hello world' | kleene replace '(\\w+) (\\w+)' '$2 $1'
  kleene explain '(a|b)+c'
`;

