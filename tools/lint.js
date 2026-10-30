#!/usr/bin/env node
/**
 * A small linter for this repository's own conventions.
 *
 * Not a replacement for ESLint. It checks the handful of rules that matter
 * here and that a general linter would need configuring to enforce:
 *
 *   - every exported function and class carries a doc comment
 *   - nothing in src/ writes to the console
 *   - no line is unreasonably long
 *   - nothing is imported from outside the standard library
 *
 * The last is the one that justifies the file. The project's only hard
 * promise is that it has no dependencies, and a promise with nothing checking
 * it is one that gets broken by accident.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath rather than url.pathname: pathname percent-encodes, so a
// directory with a space in its name comes back as "project%20folder" and
// every readdir fails with ENOENT on a path that looks almost right.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_LINE = 100;

/** Modules the project is allowed to import. */
const ALLOWED_IMPORTS = [/^node:/, /^\./];

