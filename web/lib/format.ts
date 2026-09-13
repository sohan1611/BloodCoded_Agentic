export function percent(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 100)}%`;
}

export function beliefLine(mastery: number, confidence: number): string {
  return `${percent(mastery)} estimated · ${percent(confidence)} confidence`;
}

export type Confirmation =
  | "needs_more_evidence"
  | "needs_consistent_answers";

export function confirmationCopy(reason: Confirmation | null): string {
  if (reason === "needs_more_evidence") {
    return "You got this right. One more to be sure.";
  }
  if (reason === "needs_consistent_answers") {
    return "You've shown this, but your answers have been mixed. A steady run will confirm it.";
  }
  return "Looks good. Not confirmed yet.";
}
