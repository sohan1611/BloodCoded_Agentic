export type StartupDecision = "wait" | "sign-in" | "welcome" | "resume";

export function startupDecision(input: {
  accountPending: boolean;
  hasAccount: boolean;
  engineOnline: boolean;
  me: { exists: boolean } | null;
}): StartupDecision {
  if (input.accountPending) return "wait";
  if (!input.hasAccount) return "sign-in";
  if (!input.engineOnline) return "wait";
  if (input.me === null) return "wait";
  return input.me.exists ? "resume" : "welcome";
}
