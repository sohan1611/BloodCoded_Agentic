import type { TutorView } from "./api";

export type TurnPhase =
  | "idle"
  | "running-tests"
  | "updating-plan"
  | "failed"
  | "timed-out";

export const POLL_INTERVAL_MS = 1_500;
export const TURN_DEADLINE_MS = 90_000;

export function phaseLabel(phase: TurnPhase): string | null {
  if (phase === "running-tests") return "Running tests…";
  if (phase === "updating-plan") return "Updating your plan…";
  return null;
}

type TurnView = Pick<TutorView, "phase" | "awaiting_student">;

export function settledView(view: TurnView): boolean {
  return view.phase === "idle" && view.awaiting_student;
}

export function shouldKeepPolling(
  view: TurnView,
  startedAt: number,
  now: number,
): boolean {
  return view.phase === "updating" && now - startedAt < TURN_DEADLINE_MS;
}
