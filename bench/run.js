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

/**
 * Times `body`, reporting the median of several samples.
 *
 * @param {string} label what is being measured
 * @param {number} iterations how many times to run the body per sample
 * @param {Function} body the work
 */
function measure(label, iterations, body) {
  // One warm-up sample, discarded. The first run of anything in V8 is
  // dominated by the optimiser not having seen the code yet.
  for (let i = 0; i < iterations; i++) body();

  const samples = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) body();
    samples.push((performance.now() - started) / iterations);
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];

  process.stdout.write(
    `  ${label.padEnd(44)}${render(median).padStart(10)}`
      + `   [${render(samples[0])} … ${render(samples[samples.length - 1])}]\n`,
  );
  return median;
}

function render(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function section(title) {
  process.stdout.write(`\n${title}\n${'─'.repeat(80)}\n`);
}

process.stdout.write('kleene benchmarks\n');
process.stdout.write('Each line: median of 9 samples, best and worst in brackets.\n');

