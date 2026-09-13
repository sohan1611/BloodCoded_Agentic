import type { LearnerActivity } from "./api.ts";
import { percent } from "./format.ts";
import { pretty } from "./skills.ts";

type ActivityDescription = { title: string; detail: string };

const ADAPTATION_DETAIL: Record<string, string> = {
  ADVANCE: "You're moving on to the next skill.",
  RETRY_VARIATION: "You'll try a different exercise at this level.",
  EXPLAIN_DIFFERENTLY: "The tutor will explain this in a different way.",
  STEP_DOWN_DIFFICULTY: "You'll try a gentler version before building back up.",
  REVISIT_PREREQUISITE: "You'll practise a foundation skill before returning here.",
  ESCALATE_DIFFICULTY: "You're ready for a harder exercise.",
  REASSESS: "You'll get another exercise so the tutor can check your understanding.",
  COMPLETE: "You've completed this session.",
};

export function describeActivity(item: LearnerActivity): ActivityDescription {
  switch (item.type) {
    case "generated":
      return {
        title: "New exercise",
        detail: `${item.title} · ${item.difficulty.toLowerCase()}`,
      };
    case "execution":
      return item.passed
        ? { title: "Your code passed", detail: "Every test passed." }
        : {
            title: "Your code ran",
            detail: `${percent(item.score)} of the tests passed.`,
          };
    case "misconception":
      return {
        title: `Something to look at in ${pretty(item.skill)}`,
        detail: item.note,
      };
    case "resolved":
      return {
        title: `Cleared up in ${pretty(item.skill)}`,
        detail: "You've grown out of a mistake the tutor noticed earlier.",
      };
    case "mastery":
      return {
        title: `${pretty(item.skill)} estimate`,
        detail:
          `${percent(item.before)} → ${percent(item.after)}` +
          (item.attributed_from
            ? ` (part of your ${pretty(item.attributed_from)} answer)`
            : ""),
      };
    case "adaptation":
      return {
        title: "Your next step",
        detail:
          ADAPTATION_DETAIL[item.action] ?? "The tutor picked your next step.",
      };
    case "prereq_redirect":
      return {
        title: "A step back first",
        detail: `Practising ${pretty(item.to_skill)} before returning to ${pretty(item.from_skill)}.`,
      };
    case "prereq_return":
      return {
        title: "Back on track",
        detail: `Returning to ${pretty(item.skill)}.`,
      };
    case "recovery":
      return {
        title: "Something went wrong on our side",
        detail: "Nothing was counted against you.",
      };
    case "session_end":
      return {
        title: "Session complete",
        detail: "That's the end of this session.",
      };
  }
}
