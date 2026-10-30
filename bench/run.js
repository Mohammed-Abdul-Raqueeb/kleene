#!/usr/bin/env node
/**
 * Benchmarks, measured with `performance.now` rather than a framework.
 *
 * A framework would be the only dependency in the repository, and what a
 * benchmark needs is a number you can reproduce rather than a statistical
 * model of it. Each case warms up, then runs enough iterations to take a
 * measurable time, and reports the median with the best and worst sample so
 * an outlier is visible rather than averaged away.
 *
 * Read the first section and ignore the rest if you are short of time. It is
 * the only one where this engine wins, and it wins by a margin that makes
 * the rest beside the point.
 *
 *   npm run bench
 */

import { Regex } from '../src/index.js';

const SAMPLES = 9;

