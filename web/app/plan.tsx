"use client";

/**
 * The learning plan: the prerequisite graph, drawn.
 *
 * Every card state comes from the engine. This file decides where a card sits on the
 * screen and nothing else -- it does not work out whether a skill is locked, because
 * that is a prerequisite judgement and prerequisite judgements are the whole subject of
 * the system underneath.
 */

import { useState } from "react";

import type { LearnerActivity, Plan, PlanSkill, TutorEvent } from "@/lib/api";
import { describeActivity } from "@/lib/activity";
import { confirmationCopy, percent } from "@/lib/format";
import {
  filterRoadmap,
  roadmapNumber,
  unlockedSummary,
} from "@/lib/roadmap";
import { notMeasuredLabel, pretty, skillBlurb } from "@/lib/skills";

export {
  BLURBS,
  LABELS,
  notMeasuredLabel,
  pretty,
  skillBlurb,
} from "@/lib/skills";

export function LearningPlan({
  plan,
  activeSkill,
  onStart,
  busy,
}: {
  plan: Plan;
  activeSkill: string | null;
  onStart: (skill: string) => void;
  busy: boolean;
}) {
  // Restored after the dashboard rework removed it. The design's search bar reads
  // "Search curriculum or notes", which we do not have and did not build -- but this
  // one was already here, already worked, and filters the student's own skills. A
  // spec line meant to stop a fabricated control was read as licence to delete a real
  // one.
  const [query, setQuery] = useState("");
  const needle = query.trim();
  const shown = filterRoadmap(plan.skills, query);

  return (
    <section className="roadmap-section" aria-labelledby="roadmap-title">
      <div className="flow-head">
        <span>
          <i aria-hidden />
          CURRICULUM ROADMAP
        </span>
        <span>{unlockedSummary(plan.counts)}</span>
      </div>

      <div className="roadmap-search">
        <span aria-hidden>⌕</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter skills"
          aria-label="Filter skills"
        />
      </div>

      {needle && shown.length === 0 && (
        <p className="muted" style={{ padding: "8px 2px" }}>
          No skill matches “{query.trim()}”.
        </p>
      )}

      <div className="plan">
        {shown.map((skill) => {
          const active = skill.skill === activeSkill;
          const suggested = !activeSkill && skill.skill === plan.suggested_next;
          const nextCompleted = plan.skills.find(
            (candidate) => candidate.position === skill.position + 1,
          )?.state === "completed";
          return (
            <div
              className={`spine-item spine-${skill.state}${active ? " spine-active" : ""}${
                skill.state === "completed" ? " spine-completed" : ""
              }${skill.state === "completed" && nextCompleted ? " spine-continues" : ""}`}
              key={skill.skill}
            >
              <div className="spine-node" aria-hidden>
                {spineGlyph(skill, active)}
              </div>
              <SkillCard
                skill={skill}
                active={active}
                // Suppressed while a skill is in flight. Two cards competing for "do this
                // next" is worse than none, and the honest next step for someone mid-topic
                // is to finish it.
                suggested={suggested}
                onStart={() => onStart(skill.skill)}
                busy={busy}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function spineGlyph(skill: PlanSkill, active: boolean) {
  if (active) return "▶";
  if (skill.state === "completed") return "✓";
  if (skill.state === "provisional") return "◐";
  if (skill.state === "locked") return "🔒";
  return "+";
}

function measurementLabel(value: number | null, suffix: string) {
  if (value === null) return "Not checked yet";
  return `${percent(value)} ${suffix}`;
}

function measurementWidth(value: number | null) {
  if (value === null) return "0%";
  return `${Math.max(2, Math.min(1, value) * 100)}%`;
}

function SkillCard({
  skill,
  active,
  suggested,
  onStart,
  busy,
}: {
  skill: PlanSkill;
  active: boolean;
  suggested: boolean;
  onStart: () => void;
  busy: boolean;
}) {
  const unmeasured = !skill.measured;
  const locked = skill.state === "locked";
  const done = skill.state === "completed";
  const provisional = skill.state === "provisional";
  const statusClass = done
    ? "chip done"
    : active
      ? "chip now"
      : provisional
        ? "chip maybe"
        : "chip";
  const statusLabel = skill.state;
  const progressLabel = measurementLabel(skill.mastery, "complete");
  const statusTitle = provisional
    ? confirmationCopy(skill.confirmation ?? null)
    : undefined;
  return (
    <article
      className={`card roadmap-card${active ? " active" : ""}${locked ? " locked" : ""}${
        suggested ? " suggested" : ""
      }`}
      data-skill={skill.skill}
    >
      {/* The check ends by saying "Start here: functions" and then hands over a grid of
          eight cards. Until this existed, the suggestion lived only in a `title`
          attribute -- invisible on a phone, invisible to a screen reader that is not
          hovering, and invisible to anyone who simply looks. The one instruction the
          student was given had nowhere to land. Same words as the summary screen, on
          purpose: they are meant to be recognised, not re-read. */}
      {suggested && <p className="flag">Start here</p>}
      {active && <p className="flag active-now">Active now</p>}

      <span className="roadmap-index" aria-hidden>
        {roadmapNumber(skill.position)}
      </span>
      <span className={`roadmap-icon roadmap-icon-${skill.state}${active ? " roadmap-icon-active" : ""}`} aria-hidden>
        {spineGlyph(skill, active)}
      </span>

      <div className="roadmap-copy">
        <div className="top">
          <h3>
            {pretty(skill.skill)}
            {active && <span className="focus-tag"> · CURRENT FOCUS</span>}
          </h3>
          <span className={`${statusClass} status-mobile`} title={statusTitle}>
            {statusLabel}
          </span>
          {active ? (
            <button className="play top-play" onClick={onStart} disabled={busy} aria-label="Continue">
              ▶
            </button>
          ) : (
            <div className={`dot${locked ? " lock" : ""}`} aria-hidden>
              {done ? "✓" : provisional ? "◐" : locked ? "🔒" : "＋"}
            </div>
          )}
        </div>

        <p className="desc">{skillBlurb(skill.skill)}</p>

        {/* Locked is not a wall, it is an explanation. Saying which prerequisite is
            blocking turns "you can't" into "do this first". */}
        {locked && skill.not_measured_because !== null ? (
          <p className="muted roadmap-wait">
            {notMeasuredLabel(skill.not_measured_because)}
          </p>
        ) : locked ? (
          <p className="muted roadmap-wait">
            Waiting on {skill.blocked_by.map(pretty).join(", ")}
          </p>
        ) : null}

        {provisional && (
          <p className="muted roadmap-wait">
            {confirmationCopy(skill.confirmation ?? null)}
          </p>
        )}

        <div className="bar" aria-hidden>
          <span
            style={{
              width: measurementWidth(skill.mastery),
              opacity: unmeasured ? 0.35 : 1,
            }}
          />
        </div>

        <div className="foot" style={{ marginTop: 12 }}>
          {/* One right answer is evidence, not a finished topic. Saying so is the whole
             difference between a tutor and a progress bar. */}
          <span className={`${statusClass} status-desktop`} title={statusTitle}>
            {statusLabel}
          </span>

          <div className="row skill-action" style={{ gap: 6 }}>
            <span className="muted">{measurementLabel(skill.mastery, "mastery")}</span>
            {active && (
              <button className="play mobile-play" onClick={onStart} disabled={busy} aria-label="Continue">
                ▶
              </button>
            )}
            {!locked && !active && (
              <button
                className={`iconbtn solid${suggested ? " go" : ""}`}
                onClick={onStart}
                disabled={busy}
                aria-label={
                  suggested
                    ? `Start ${pretty(skill.skill)} — suggested next`
                    : `Start ${pretty(skill.skill)}`
                }
              >
                ▸
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="roadmap-progress">
        <span className={statusClass} title={statusTitle}>
          {statusLabel}
        </span>
        <small>{progressLabel}</small>
      </div>

      {!locked ? (
        <button
          className="roadmap-arrow"
          type="button"
          onClick={onStart}
          disabled={busy}
          aria-label={active ? `Continue ${pretty(skill.skill)}` : `Start ${pretty(skill.skill)}`}
        >
          ›
        </button>
      ) : (
        <span className="roadmap-arrow locked-arrow" aria-hidden>
          ›
        </span>
      )}
    </article>
  );
}

/* The right-hand column. The design showed scheduled webinars and lessons; this system
   has no calendar and inventing one would be the first dishonest thing in it. What it
   does have is better: every decision the tutor just made, and why. */
const TONE: Record<string, string> = {
  diagnostic: "sky",
  plan: "lilac",
  retrieval: "sky",
  generated: "lilac",
  execution: "plain",
  misconception: "butter",
  resolved: "leaf",
  mastery: "leaf",
  adaptation: "butter",
  guard_override: "butter",
  prereq_redirect: "lilac",
  prereq_return: "leaf",
  recovery: "plain",
  session_end: "leaf",
};

const ICON: Record<string, string> = {
  diagnostic: "🔍", plan: "🗺", retrieval: "📚", generated: "✎", execution: "⚙",
  misconception: "🧠", resolved: "✓", mastery: "📈", adaptation: "🧭", guard_override: "🛡",
  prereq_redirect: "↩", prereq_return: "↪", recovery: "🩹", session_end: "🏁",
};

export function ActivityPanel({
  activity,
  events,
}: {
  activity: LearnerActivity[];
  events?: TutorEvent[];
}) {
  const recent = [...activity].reverse().slice(0, 8);
  const trace = events ? [...events].reverse().slice(0, 8) : [];
  return (
    <aside className="panel">
      <div className="head">
        <h2>
          Why it did that <span aria-hidden>🧐</span>
        </h2>
      </div>

      {recent.length === 0 && (
        <div className="event plain">
          <p>
            Start a skill and every decision the tutor makes appears here, with its
            reason — including the ones where it overrules its own model.
          </p>
        </div>
      )}

      {recent.map((item, i) => {
        const description = describeActivity(item);
        return (
          <div className={`event ${TONE[item.type] ?? "plain"}`} key={i}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="kind">
                <span className="badge" aria-hidden>{ICON[item.type] ?? "•"}</span>
                {description.title}
              </span>
            </div>
            <p>{description.detail}</p>
          </div>
        );
      })}

      {events && (
        <details>
          <summary>Engine trace (diagnostics)</summary>
          {trace.map((event, i) => (
            <div className={`event ${TONE[event.type] ?? "plain"}`} key={i}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="kind">
                  <span className="badge" aria-hidden>{ICON[event.type] ?? "•"}</span>
                  {event.type.replace(/_/g, " ")}
                </span>
                <span className="when">{event.node}</span>
              </div>
              <p>
                {event.reason ??
                  Object.entries(event.payload)
                    .slice(0, 3)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join(" · ")}
              </p>
            </div>
          ))}
        </details>
      )}
    </aside>
  );
}
