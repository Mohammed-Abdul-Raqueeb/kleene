/**
 * The public matcher.
 *
 * Deliberately shaped like `RegExp`: `test`, `exec`, `lastIndex`, and the
 * `String.prototype` operations as methods. A drop-in shape means a caller
 * can swap one for the other to compare behaviour, which is how most of this
 * engine was tested.
 */

import { compile } from './compiler.js';
import { parse } from './parser.js';
import { parseFlags, renderFlags } from './flags.js';
import { run } from './pike.js';
import { render } from './ast.js';
import { simplify } from './simplify.js';

