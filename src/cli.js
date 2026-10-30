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

/**
 * Runs the command line.
 *
 * @param {string[]} argv the arguments, without node and the script
 * @param {object} io
 * @param {{write: Function}} io.out where output goes
 * @param {{write: Function}} io.err where errors go
 * @param {() => Promise<string>} io.readStdin reads standard input
 * @param {(path: string) => string} io.readFile reads a named file
 * @returns {Promise<number>} the exit code
 */
export async function run(argv, io) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.err.write(`kleene: ${error.message}\n`);
    return 2;
  }

  if (options.help) {
    io.out.write(USAGE);
    return 0;
  }
  if (options.version) {
    io.out.write(`kleene ${VERSION}\n`);
    return 0;
  }

  if (options.command === '') {
    io.err.write('kleene: a command is required\n');
    io.err.write('Run "kleene help" for the list.\n');
    return 2;
  }

  const known = ['match', 'find', 'replace', 'split', 'explain'];
  if (!known.includes(options.command)) {
    io.err.write(`kleene: unknown command "${options.command}"\n`);
    io.err.write(`The commands are ${known.join(', ')}.\n`);
    return 2;
  }

  if (options.pattern === null) {
    io.err.write(`kleene: ${options.command} needs a pattern\n`);
    return 2;
  }

  let regex;
  try {
    regex = new Regex(options.pattern, options.flags);
  } catch (error) {
    if (error instanceof PatternError) {
      io.err.write(`${error.format()}\n`);
      // An unsupported construct is told apart from a malformed one, because
      // the fixes differ: one is a typo, the other means reaching for a
      // different tool.
      return error instanceof UnsupportedError ? 4 : 3;
    }
    throw error;
  }

  if (options.command === 'explain') {
    return explain(regex, io);
  }

  if (options.command === 'replace' && options.replacement === null) {
    io.err.write('kleene: replace needs a replacement\n');
    return 2;
  }

  let text;
  try {
    text = options.files.length > 0
      ? options.files.map((path) => io.readFile(path)).join('')
      : await io.readStdin();
  } catch (error) {
    io.err.write(`kleene: ${error.message}\n`);
    return 2;
  }

  switch (options.command) {
    case 'match': return matchLines(regex, text, options, io);
    case 'find': return findAll(regex, text, options, io);
    case 'replace': return replaceAll(regex, text, options, io);
    case 'split': return splitLines(regex, text, options, io);
    default: return 2;
  }
}

function explain(regex, io) {
  io.out.write(`pattern     /${regex.source}/${regex.flagString}\n`);
  io.out.write(`simplified  /${regex.explain()}/\n`);
  io.out.write(`groups      ${regex.groupCount}`);
  if (regex.names.size > 0) {
    io.out.write(` (${[...regex.names.keys()].join(', ')})`);
  }
  io.out.write('\n');
  io.out.write(`program     ${regex.program.length} instructions\n`);

  // Worth surfacing: this is the one property that decides whether the
  // engine agrees with RegExp, and a user comparing the two should be told.
  const nullableQuantifier = hasNullableQuantifier(regex.ast);
  io.out.write(
    `RegExp parity  ${nullableQuantifier
      ? 'not guaranteed: a quantifier here has a body that can match empty'
      : 'guaranteed: no quantifier body can match empty'}\n`,
  );

  io.out.write('\n');
  io.out.write(`${regex.program.disassemble()}\n`);
  return 0;
}

function matchLines(regex, text, options, io) {
  const lines = splitKeepingNothing(text);
  let count = 0;

  lines.forEach((line, index) => {
    const found = regex.match(line);
    const hit = options.invert ? found === null : found !== null;
    if (!hit) return;
    count++;

    if (options.count) return;

    const prefix = options.lineNumber ? `${index + 1}:` : '';
    if (options.only && found !== null && !options.invert) {
      for (const each of allMatches(regex, line)) {
        io.out.write(`${prefix}${each[0]}\n`);
      }
      return;
    }
    io.out.write(`${prefix}${line}\n`);
  });

  if (options.count) io.out.write(`${count}\n`);
  // Exit 1 when nothing matched, as grep does, so a shell can branch on it.
  return count > 0 ? 0 : 1;
}

function findAll(regex, text, options, io) {
  let count = 0;

  for (const found of allMatches(regex, text)) {
    count++;
    if (options.count) continue;

    if (options.group !== null) {
      const value = /^\d+$/.test(options.group)
        ? found[Number(options.group)]
        : found.groups?.[options.group];
      // An absent group prints nothing rather than "undefined", so the
      // output stays usable in a pipeline.
      io.out.write(`${value ?? ''}\n`);
      continue;
    }
    io.out.write(`${found[0]}\n`);
  }

  if (options.count) io.out.write(`${count}\n`);
  return count > 0 ? 0 : 1;
}

