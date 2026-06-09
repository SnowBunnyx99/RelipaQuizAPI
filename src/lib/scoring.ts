// Kahoot/Quiz.com-style scoring: a correct answer earns the question's base
// points, reduced by how long the player took. The fastest possible answer
// earns full points; an answer at the buzzer earns half. Wrong answers: 0.

const MIN_FACTOR = 0.5; // slowest correct answer still earns this fraction

export function computeScore(params: {
  correct: boolean;
  timeTakenMs: number;
  timeLimitSec: number;
  basePoints: number;
}): number {
  const { correct, timeTakenMs, timeLimitSec, basePoints } = params;
  if (!correct) return 0;

  const limitMs = Math.max(1, timeLimitSec * 1000);
  const ratio = Math.min(1, Math.max(0, timeTakenMs / limitMs));
  const factor = 1 - (1 - MIN_FACTOR) * ratio;
  return Math.round(basePoints * factor);
}
