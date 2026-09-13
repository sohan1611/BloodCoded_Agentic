export const LABELS: Record<string, string> = {
  variables: "Variables",
  conditionals: "Conditionals",
  loops: "Loops",
  functions: "Functions",
  function_call_tracing: "Function Call Tracing",
  recursion: "Recursion",
  recursion_tree: "Recursion Trees",
  nested_loops: "Nested Loops",
};

export const BLURBS: Record<string, string> = {
  variables: "Store a value, give it a name, and use it again later.",
  conditionals: "Make the program choose between two paths.",
  loops: "Repeat work without writing it out every time.",
  functions: "Package work up, hand it inputs, and get an answer back.",
  function_call_tracing: "Follow a value as it moves between functions.",
  recursion: "A function that solves a smaller version of its own problem.",
  recursion_tree: "Recursion that branches, and the shape that makes.",
  nested_loops: "A loop inside a loop, and what that costs.",
};

/* Exported so every screen names a skill identically. Progress spelled its own
   "Recursion Tree" against the plan's "Recursion Trees" for exactly as long as this
   lived privately in a component -- one student, one skill, two names. */
export const pretty = (skill: string) => LABELS[skill] ?? skill.replace(/_/g, " ");

export const skillBlurb = (skill: string) =>
  BLURBS[skill] ?? "A skill in this course.";

export function notMeasuredLabel(reason: string | null) {
  if (reason === null) return "Not checked yet";
  return `Not checked — we stopped because ${pretty(reason)} needs work first.`;
}
