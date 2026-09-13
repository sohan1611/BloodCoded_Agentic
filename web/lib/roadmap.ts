import type { Plan, PlanSkill } from "./api.ts";
import { pretty } from "./skills.ts";

export function filterRoadmap(skills: PlanSkill[], query: string): PlanSkill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter((skill) =>
    pretty(skill.skill).toLowerCase().includes(needle),
  );
}

export function unlockedSummary(counts: Plan["counts"]): string {
  return `${counts.unlocked} of ${counts.total} unlocked`;
}

export function roadmapNumber(position: number): string {
  return String(position).padStart(2, "0");
}
