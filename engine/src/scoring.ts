// Soft constraints — expressed as a score to MINIMIZE.

import { endHour } from './time';
import type { LaborRules, Slot } from './types';

export function isWeekend(dayIndex: number, weekendDays: number[]): boolean {
  return weekendDays.includes(dayIndex);
}

export function isClosing(slot: Slot, rules: LaborRules): boolean {
  return endHour(slot.startTime, slot.endTime) >= rules.closingHour;
}

/**
 * How "undesirable" a seat is. Weekend + closing is the worst (2); either one
 * alone is 1; a plain weekday daytime seat is 0.
 */
export function undesirableWeight(slot: Slot, weekendDays: number[], rules: LaborRules): number {
  return (isWeekend(slot.dayIndex, weekendDays) ? 1 : 0) + (isClosing(slot, rules) ? 1 : 0);
}

export interface CandidateScoreParams {
  slotWeight: number;
  empUndesirable: number;
  fairnessCredit: number;
  currentCount: number;
  minShifts: number;
  prefer: boolean;
}

/**
 * Lower is better. Whoever carries the least undesirable load (this cycle +
 * historical credit) is preferred for undesirable seats.
 */
export function candidateScore(p: CandidateScoreParams): number {
  let score = 0;
  score += p.slotWeight * (p.empUndesirable + p.fairnessCredit);
  if (p.currentCount < p.minShifts) score -= (p.minShifts - p.currentCount) * 10;
  if (p.prefer) score -= 5;
  score += p.currentCount * 0.5;
  return score;
}
