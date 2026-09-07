// Layer 2 — the "math brain". Runs the OR-Tools CP-SAT solver (solver/solve.py)
// as a short-lived subprocess: feed ScheduleInput as JSON on stdin, read a
// ScheduleResult as JSON on stdout. Same contract as the greedy engine, so the
// two are interchangeable. ANY failure (python/ortools missing, timeout, bad
// output) returns null so the caller transparently falls back to the greedy engine.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { ScheduleInput, ScheduleResult } from '@engine';

const SOLVE_TIMEOUT_MS = 15_000; // solver self-limits to 10s; give spawn a little slack

function solverPaths() {
  const root = process.cwd(); // dev + prod both launch from the repo root
  const isWin = process.platform === 'win32';
  const python = path.join(root, 'solver', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  const script = path.join(root, 'solver', 'solve.py');
  return { python, script };
}

/**
 * Try to solve optimally. Returns the optimal ScheduleResult, or null if the
 * solver is unavailable / errored (caller should fall back to generateSchedule).
 */
export function solveOptimal(input: ScheduleInput): ScheduleResult | null {
  try {
    const { python, script } = solverPaths();
    const res = spawnSync(python, [script], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
      timeout: SOLVE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.error) {
      console.warn('[optimize] solver not runnable, falling back:', res.error.message);
      return null;
    }
    if (res.status !== 0 || !res.stdout) {
      console.warn('[optimize] solver failed, falling back:', (res.stderr || '').slice(0, 500));
      return null;
    }
    const parsed = JSON.parse(res.stdout) as ScheduleResult;
    if (!Array.isArray(parsed.assignments)) {
      console.warn('[optimize] solver returned malformed result, falling back');
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[optimize] solver error, falling back:', (err as Error).message);
    return null;
  }
}
