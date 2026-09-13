"use client";

/**
 * The student experience, as a small state machine behind glass.
 *
 *   resuming -> welcome -> diagnostic -> plan <-> learn <-> progress
 *
 * Transitions are driven by what the engine returns. This component knows how to draw a
 * problem; it does not know how a problem is chosen, and it must not learn.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import {
  ApiError,
  api,
  clearCachedJwt,
  type Activity,
  type DiagnosticStep,
  type LanguageOption,
  type LearnerActivity,
  type Me,
  type Plan,
  type Progress,
  type TutorEvent,
  type TutorView,
  type PlanSkill,
} from "@/lib/api";
import { engineCopy, useEngineStatus, type EngineStatus } from "@/lib/engine";
import { beliefLine, percent } from "@/lib/format";
import { checkSubmission } from "@/lib/submission";
import { startupDecision } from "@/lib/startup";
import {
  POLL_INTERVAL_MS,
  phaseLabel,
  settledView,
  shouldKeepPolling,
  type TurnPhase,
} from "@/lib/turn";
import { StudentDashboard } from "./dashboard";
import { CodeEditor, type CodeEditorHandle } from "./editor";
import {
  ActivityPanel,
  LearningPlan,
  notMeasuredLabel,
  pretty,
  skillBlurb,
} from "./plan";
import { Shell, type Tab, useGlassSwap } from "./shell";
import { authClient } from "@/lib/auth/client";
import { SettingsView, type SettingsSection } from "./settings";

type Stage = "resuming" | "welcome" | "diagnostic" | "app";

type VisibleError = {
  message: string;
  kind: "network" | "http" | "timeout" | "unexpected";
  recovery?: "sign-out";
};

type SlowTutorAction = "begin";

const RESTART_NOTE =
  "The tutor restarted while you were away, so that exercise was closed. Your progress is saved — pick up where you left off.";
const TURN_BUSY_MESSAGE = "We're still checking your last answer.";
const TURN_TIMEOUT_MESSAGE = "This is taking longer than usual. Your answer was saved.";

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildLocalDayBuckets(activity: Activity) {
  const byDay = new Map<string, number>();
  for (const attempt of activity.attempts) {
    const at = new Date(attempt.at);
    byDay.set(at.toDateString(), (byDay.get(at.toDateString()) ?? 0) + 1);
  }
  return byDay;
}

function currentActivityStreak(activity: Activity | null) {
  if (!activity) return null;
  const byDay = buildLocalDayBuckets(activity);
  let streak = 0;
  let cursor = startOfLocalDay(new Date());
  while ((byDay.get(cursor.toDateString()) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function dayPart(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function useDayPart() {
  const [part, setPart] = useState(() => dayPart(new Date()));
  useEffect(() => {
    const refresh = () => setPart(dayPart(new Date()));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return part;
}

// The visible elapsed-time copy needs no finer cadence than seconds, and a one-second
// tick avoids spending renders on imperceptible sub-second changes.
const STATUS_TICK_MS = 1_000;

function EngineStatusBanner({ status }: { status: EngineStatus }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (status.paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [status.paused]);

  if (
    status.state === "online" ||
    (status.state === "checking" && !status.paused)
  ) return null;
  const copy = engineCopy(status);
  const wakingSeconds = Math.max(
    0,
    Math.floor((now - (status.wakeStartedAt ?? now)) / STATUS_TICK_MS),
  );
  const checkedSeconds = Math.max(
    0,
    Math.floor((now - (status.lastCheckedAt ?? now)) / STATUS_TICK_MS),
  );

  return (
    <div
      className={`note engine-status-note${status.state === "offline" ? " warn" : ""}`}
    >
      <div className="engine-status-live" role="status" aria-live="polite">
        <strong>{copy.title}</strong>
        <p className="engine-status-detail">{copy.detail}</p>
      </div>
      <p className="engine-status-meta">
        {status.paused
          ? "Paused while this tab is in the background — it resumes when you come back."
          : status.state === "waking" && status.attempts > 0
            ? `Trying for ${wakingSeconds} s · attempt ${status.attempts}`
            : status.state === "waking"
              ? "Getting ready to check the engine…"
              : `Last checked ${checkedSeconds} s ago`}
      </p>
      <button
        type="button"
        className="btn engine-retry"
        onClick={status.retry}
        disabled={status.probeInFlight}
      >
        {status.probeInFlight ? "Checking…" : "Try again now"}
      </button>
      {status.state === "offline" && (
        <p className="engine-status-help">
          Nothing you&apos;ve done is lost. If this lasts more than a few minutes, please
          come back later.
        </p>
      )}
    </div>
  );
}

function visibleAttemptTotal(plan: Plan, progress: Progress | null) {
  return typeof plan.total_attempts === "number"
    ? plan.total_attempts
    : progress?.total_attempts ?? null;
}

function isMissingSession(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

function isTurnBusy(error: unknown) {
  return error instanceof ApiError &&
    error.status === 409 &&
    error.message === TURN_BUSY_MESSAGE;
}

function dashboardFocus(plan: Plan, activeSkill: string | null) {
  const focusId = activeSkill ?? plan.suggested_next;
  if (!focusId) return null;
  return plan.skills.find((skill) => skill.skill === focusId) ?? null;
}

export default function Page() {
  const [stage, setStage] = useState<Stage>("resuming");
  const [tab, setTab] = useState<Tab>("plan");
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [language, setLanguage] = useState("");
  const [id, setId] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [turnPhase, setTurnPhase] = useState<TurnPhase>("idle");
  const [loadingTab, setLoadingTab] = useState<Tab | null>(null);
  const [beginningSkill, setBeginningSkill] = useState<string | null>(null);
  const [slowTutorAction, setSlowTutorAction] = useState<SlowTutorAction | null>(null);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [error, setError] = useState<VisibleError | null>(null);
  const [recoverySigningOut, setRecoverySigningOut] = useState(false);

  const [step, setStep] = useState<DiagnosticStep | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [view, setView] = useState<TutorView | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [code, setCode] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [shown, setShown] = useState(0);

  const { swap, sweeping } = useGlassSwap();
  const { data: accountSession, isPending: accountPending } = authClient.useSession();
  const engine = useEngineStatus();
  const health = engine.health;
  const statusCopy = engineCopy(engine);
  const previousEngineState = useRef(engine.state);
  const languageOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const navigationId = useRef(0);
  const recoveredDraft = useRef<{ skill: string; code: string } | null>(null);
  const turnInFlight = useRef(false);
  const meRequested = useRef(false);
  const resumeRequested = useRef(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const languageOptions = health?.languages ?? [];
  const accountEmail = accountSession?.user.email ?? "";
  const displayName =
    accountSession?.user.name?.trim() || accountEmail.split("@")[0] || "";
  const hasAccount = Boolean(accountSession?.user);
  const hasLanguagePicker = languageOptions.length > 1;
  const selectedLanguage =
    hasLanguagePicker && languageOptions.some((option) => option.value === language)
      ? language
      : hasLanguagePicker
        ? languageOptions[0]?.value ?? ""
        : "";
  const canStart = !starting && !accountPending && engine.state === "online";

  useEffect(() => {
    const options = health?.languages ?? [];
    languageOptionRefs.current = languageOptionRefs.current.slice(0, options.length);
    if (options.length <= 1) {
      if (language) setLanguage("");
      return;
    }
    if (!options.some((option) => option.value === language)) {
      setLanguage(options[0]?.value ?? "");
    }
  }, [health, language]);

  useEffect(() => {
    const recovered = previousEngineState.current !== "online" && engine.state === "online";
    previousEngineState.current = engine.state;
    if (recovered) {
      setError((current) => current?.kind === "network" ? null : current);
    }
  }, [engine.state]);

  useEffect(() => {
    const nextAction: SlowTutorAction | null = beginningSkill ? "begin" : null;
    setSlowTutorAction(null);
    if (!nextAction) return;
    const timer = window.setTimeout(() => setSlowTutorAction(nextAction), 3_000);
    return () => window.clearTimeout(timer);
  }, [beginningSkill]);

  const presentError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.kind === "network") engine.reportUnreachable();
      setError({ message: err.message, kind: err.kind, recovery: err.recovery });
      return;
    }
    console.warn("Unexpected tutoring interface error", err);
    setError({ message: "Something went wrong. Please try again.", kind: "unexpected" });
  }, [engine.reportUnreachable]);

  const guard = useCallback(async (
    work: () => Promise<void>,
    setInFlight: (value: boolean) => void,
  ) => {
    setInFlight(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      presentError(err);
    } finally {
      setInFlight(false);
    }
  }, [presentError]);

  const signOutAndTryAgain = useCallback(async () => {
    setRecoverySigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        console.warn("Neon Auth recovery sign-out failed", {
          route: "/api/auth/sign-out",
          status: result.error.status,
        });
        setError({
          message:
            result.error.status === 0 || result.error.status >= 500
              ? "We couldn't reach the sign-in service. Please try again."
              : "We couldn't sign you out. Please try again.",
          kind: "http",
          recovery: "sign-out",
        });
        return;
      }
      clearCachedJwt();
      window.location.assign("/auth/sign-in");
    } catch {
      console.warn("Neon Auth recovery sign-out failed", {
        route: "/api/auth/sign-out",
        status: 0,
      });
      setError({
        message: "We couldn't reach the sign-in service. Please try again.",
        kind: "http",
        recovery: "sign-out",
      });
    } finally {
      setRecoverySigningOut(false);
    }
  }, []);

  const moveLanguageSelection = (nextIndex: number) => {
    const option = languageOptions[nextIndex];
    if (!option) return;
    setLanguage(option.value);
    window.requestAnimationFrame(() => languageOptionRefs.current[nextIndex]?.focus());
  };

  const onLanguageKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % languageOptions.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + languageOptions.length) % languageOptions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = languageOptions.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    moveLanguageSelection(nextIndex);
  };

  // -------------------------------------------------------------- actions
  const editCode = (next: string) => {
    setCode(next);
    setSubmissionNotice(null);
  };

  const applyDiagnosticStep = useCallback((next: DiagnosticStep) => {
    setStep(next);
    setCode(next.complete ? "" : next.starter_code);
    setSubmissionNotice(null);
  }, []);

  const reopenSession = useCallback(async () => {
    const session = await api.startSession(displayName, selectedLanguage || undefined);
    setId(session.student_id);
    return session;
  }, [displayName, selectedLanguage]);

  const recoverDiagnostic = async () => {
    const session = await reopenSession();
    const next = await api.diagnosticQuestion(session.student_id);
    applyDiagnosticStep(next);
  };

  const recoverExercise = async (skill: string | null, expectedNavigationId: number) => {
    if (skill) recoveredDraft.current = { skill, code };
    setSubmissionNotice(null);
    const session = await reopenSession();
    setView(null);
    setHints([]);
    setShown(0);
    setRestartNote(RESTART_NOTE);

    // A tab click made while the session was being reopened remains authoritative.
    if (navigationId.current !== expectedNavigationId) return;
    const recoveryNavigationId = ++navigationId.current;
    setLoadingTab("plan");
    swap(() => {
      setStage("app");
      setTab("plan");
    });
    try {
      const nextPlan = await api.plan(session.student_id);
      if (navigationId.current === recoveryNavigationId) setPlan(nextPlan);
    } catch (recoveryError) {
      if (navigationId.current === recoveryNavigationId) throw recoveryError;
    } finally {
      if (navigationId.current === recoveryNavigationId) setLoadingTab(null);
    }
  };

  const enterLearning = useCallback(async () => {
    const session = await api.startSession(displayName, selectedLanguage || undefined);
    setId(session.student_id);
    if (session.needs_diagnostic) {
      let first: DiagnosticStep;
      try {
        first = await api.diagnosticQuestion(session.student_id);
      } catch (requestError) {
        if (!isMissingSession(requestError)) throw requestError;
        const reopened = await reopenSession();
        first = await api.diagnosticQuestion(reopened.student_id);
      }
      applyDiagnosticStep(first);
      swap(() => setStage("diagnostic"));
    } else {
      setPlan(await api.plan(session.student_id));
      swap(() => setStage("app"));
    }
  }, [applyDiagnosticStep, displayName, reopenSession, selectedLanguage, swap]);

  const begin = () => guard(enterLearning, setStarting);

  useEffect(() => {
    if (stage !== "resuming") return;

    const decision = startupDecision({
      accountPending,
      hasAccount,
      engineOnline: engine.state === "online",
      me,
    });

    if (decision === "sign-in") {
      window.location.replace("/auth/sign-in");
      return;
    }
    if (decision === "welcome") {
      setStage("welcome");
      return;
    }
    if (decision === "resume") {
      if (resumeRequested.current) return;
      resumeRequested.current = true;
      void enterLearning().catch((requestError) => {
        setStage("welcome");
        presentError(requestError);
      });
      return;
    }
    if (
      !accountPending &&
      hasAccount &&
      engine.state === "online" &&
      me === null &&
      !meRequested.current
    ) {
      meRequested.current = true;
      void api.me().then(setMe).catch((requestError) => {
        setStage("welcome");
        presentError(requestError);
      });
    }
  }, [
    accountPending,
    engine.state,
    enterLearning,
    hasAccount,
    me,
    presentError,
    stage,
  ]);

  const answer = (submitted: string) =>
    guard(async () => {
      if (!step || step.complete) return;
      try {
        await api.answerDiagnostic(id, step.skill, submitted);
        applyDiagnosticStep(await api.diagnosticQuestion(id));
      } catch (requestError) {
        if (!isMissingSession(requestError)) throw requestError;
        await recoverDiagnostic();
      }
    }, setActionBusy);

  const submitDiagnostic = () => {
    const check = checkSubmission(code);
    if (!check.ok) {
      setSubmissionNotice(check.message);
      editorRef.current?.focus();
      return;
    }
    setSubmissionNotice(null);
    return answer(code);
  };

  const enterApp = () =>
    guard(async () => {
      setPlan(await api.plan(id));
      swap(() => {
        setStage("app");
        setTab("plan");
      });
    }, setActionBusy);

  const startSkill = (skill: string) => {
    const actionNavigationId = ++navigationId.current;
    setSubmissionNotice(null);
    setLoadingTab(null);
    setBeginningSkill(skill);
    swap(() => setTab("learn"));
    return guard(async () => {
      try {
        const next = await api.beginTutoring(id, displayName, skill);
        const draft = recoveredDraft.current;
        const restoresDraft = Boolean(draft && draft.skill === next.target_skill);
        setView(next);
        setCode(restoresDraft && draft ? draft.code : next.problem?.starter_code ?? "");
        if (restoresDraft) recoveredDraft.current = null;
        setHints([]);
        setShown(0);
        setRestartNote(null);
      } catch (requestError) {
        if (!isMissingSession(requestError)) throw requestError;
        await recoverExercise(view?.target_skill ?? null, actionNavigationId);
      } finally {
        setBeginningSkill(null);
      }
    }, setActionBusy);
  };

  const applyCompletedTurn = async (next: TutorView) => {
    setView(next);
    setCode(settledView(next) ? next.problem?.starter_code ?? "" : "");
    setSubmissionNotice(null);
    setHints([]);
    setShown(0);
    setTurnPhase("idle");
    try {
      setPlan(await api.plan(id));
    } catch (requestError) {
      presentError(requestError);
    }
  };

  const pollTurn = async (
    initial: TutorView | null,
    startedAt: number,
    continueOnFailure = false,
  ) => {
    let next = initial;
    let canContinueFailure = continueOnFailure;
    while (true) {
      if (next === null) {
        next = await api.session(id);
        setView(next);
      }
      if (settledView(next) || next.phase === "idle") {
        await applyCompletedTurn(next);
        return;
      }
      if (next.phase === "failed") {
        if (canContinueFailure) {
          canContinueFailure = false;
          try {
            next = await api.continueTurn(id);
            setView(next);
          } catch (requestError) {
            if (!isTurnBusy(requestError)) throw requestError;
            next = null;
          }
          continue;
        }
        setView(next);
        setTurnPhase("failed");
        return;
      }
      if (!shouldKeepPolling(next, startedAt, Date.now())) {
        setView(next);
        setTurnPhase("timed-out");
        return;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, POLL_INTERVAL_MS);
      });
      next = await api.session(id);
      setView(next);
    }
  };

  const submit = () => {
    if (turnInFlight.current) return;
    const check = checkSubmission(code);
    if (!check.ok) {
      setSubmissionNotice(check.message);
      editorRef.current?.focus();
      return;
    }
    setSubmissionNotice(null);
    const actionNavigationId = navigationId.current;
    const startedAt = Date.now();
    turnInFlight.current = true;
    setTurnPhase("running-tests");
    setError(null);

    return (async () => {
      try {
        let next: TutorView;
        try {
          next = await api.submit(id, code, { phased: true });
        } catch (requestError) {
          if (requestError instanceof ApiError && requestError.status === 422) {
            setSubmissionNotice(requestError.message);
            editorRef.current?.focus();
            setTurnPhase("idle");
            return;
          }
          if (isTurnBusy(requestError)) {
            setSubmissionNotice(TURN_BUSY_MESSAGE);
            setTurnPhase("updating-plan");
            await pollTurn(null, startedAt);
            return;
          }
          if (!isMissingSession(requestError)) throw requestError;
          await recoverExercise(view?.target_skill ?? null, actionNavigationId);
          setTurnPhase("idle");
          return;
        }

        setView(next);
        if (next.phase === "updating") {
          setTurnPhase("updating-plan");
          await pollTurn(next, startedAt);
        } else if (next.phase === "failed") {
          setTurnPhase("failed");
        } else {
          await applyCompletedTurn(next);
        }
      } catch (requestError) {
        presentError(requestError);
        setTurnPhase("idle");
      } finally {
        turnInFlight.current = false;
      }
    })();
  };

  const resumeTurn = (checkServerFirst: boolean) => {
    if (turnInFlight.current) return;
    const fallbackPhase = turnPhase;
    const startedAt = Date.now();
    turnInFlight.current = true;
    setTurnPhase("updating-plan");
    setSubmissionNotice(null);
    setError(null);

    return (async () => {
      try {
        let next: TutorView | null = null;
        try {
          next = checkServerFirst
            ? await api.session(id)
            : await api.continueTurn(id);
        } catch (requestError) {
          if (!isTurnBusy(requestError)) throw requestError;
        }

        if (
          next === null ||
          next.phase === "updating" ||
          (checkServerFirst && next.phase === "failed")
        ) {
          await pollTurn(next, startedAt, checkServerFirst);
        } else if (next.phase === "failed") {
          setView(next);
          setTurnPhase("failed");
        } else {
          await applyCompletedTurn(next);
        }
      } catch (requestError) {
        presentError(requestError);
        setTurnPhase(fallbackPhase);
      } finally {
        turnInFlight.current = false;
      }
    })();
  };

  const askForHint = () => {
    if (turnPhase !== "idle") return;
    const actionNavigationId = navigationId.current;
    return guard(async () => {
      try {
        const ladder = hints.length ? hints : (await api.hints(id, code)).hints;
        setHints(ladder);
        setShown((n) => Math.min(n + 1, ladder.length));
      } catch (requestError) {
        if (!isMissingSession(requestError)) throw requestError;
        await recoverExercise(view?.target_skill ?? null, actionNavigationId);
      }
    }, setActionBusy);
  };

  const changeTab = (next: Tab) => {
    setSettingsSection(null);
    if (!id) return;
    const requestId = ++navigationId.current;
    setError(null);
    setSubmissionNotice(null);
    setLoadingTab(next === "learn" ? null : next);
    swap(() => setTab(next));

    if (next === "learn") return;
    void (async () => {
      try {
        if (next === "plan") {
          const nextPlan = await api.plan(id);
          if (navigationId.current === requestId) setPlan(nextPlan);
        }
        // The detail view reads the diagnoses off the student profile, so it needs the
        // same fetch Progress does -- otherwise it shows whatever was cached from a
        // Progress visit that may never have happened.
        if (next === "detail") {
          const nextProgress = await api.progress(id);
          if (navigationId.current === requestId) setProgress(nextProgress);
        }
        if (next === "progress") {
          const [nextProgress, nextActivity] = await Promise.all([
            api.progress(id),
            api.activity(id),
          ]);
          if (navigationId.current === requestId) {
            setProgress(nextProgress);
            setActivity(nextActivity);
          }
        }
      } catch (requestError) {
        if (navigationId.current === requestId) presentError(requestError);
      } finally {
        if (navigationId.current === requestId) setLoadingTab(null);
      }
    })();
  };

  const goHome = () => {
    setSettingsSection(null);
    if (stage === "app") changeTab("plan");
  };

  // -------------------------------------------------------------- render
  return (
    <Shell
      tab={tab}
      onTab={changeTab}
      name={displayName}
      email={accountEmail}
      image={accountSession?.user.image ?? null}
      identityPending={accountPending || !displayName}
      hasLearner={stage === "diagnostic" || stage === "app"}
      engine={engine}
      sweeping={sweeping}
      onHome={stage === "app" || settingsSection !== null ? goHome : undefined}
      onOpenSettings={setSettingsSection}
    >
      {settingsSection !== null && stage !== "resuming" ? (
        <SettingsView
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onBack={() => setSettingsSection(null)}
        />
      ) : (
        <>
      {(engine.state === "waking" || engine.state === "offline") && (
        <EngineStatusBanner status={engine} />
      )}

      {engine.state === "online" && health?.generation !== "live" && (
        <div className="note warn templates-banner">
          <strong>Running on built-in templates</strong>
          {statusCopy.detail}
        </div>
      )}
      {error && (
        <div className="row err" role="alert">
          <span>{error.message}</span>
          {error.recovery === "sign-out" && (
            <button
              type="button"
              className="btn ghost"
              onClick={signOutAndTryAgain}
              disabled={recoverySigningOut}
            >
              {recoverySigningOut ? "Signing out…" : "Sign out and try again"}
            </button>
          )}
        </div>
      )}

      {stage === "resuming" && (
        <div className="hero" aria-busy="true">
          <div className="skeleton skeleton-heading" aria-hidden="true" />
          <div className="feature-grid" aria-hidden="true">
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
          <p className="muted" role="status">Loading your learning plan…</p>
        </div>
      )}

      {stage === "welcome" && (
        <div className="hero">
          <div className="hero-pill">AI Tutor</div>
          <h1>
            Your personalized
            <br />
            learning journey starts here.
          </h1>
          <p className="sub">
            We&apos;ll find what you know, spot the gaps underneath, and pick your next
            challenge from there.
          </p>

          <div className="step-strip" aria-label="Tutor flow">
            <span>Assess</span>
            <span>Understand</span>
            <span>Adapt</span>
            <span>Improve</span>
          </div>

          <div className="name-block">
            {displayName && (
              <p className="welcome-account">Signed in as <strong>{displayName}</strong></p>
            )}
            <p className="muted">{accountEmail}</p>
            {hasLanguagePicker && (
              <div className="language-picker">
                <p id="language-picker-label" className="language-label">Which language?</p>
                <div className="language-toggle" role="radiogroup" aria-labelledby="language-picker-label">
                  {languageOptions.map((option, index) => (
                    <button
                      key={option.value}
                      ref={(node) => {
                        languageOptionRefs.current[index] = node;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selectedLanguage === option.value}
                      tabIndex={selectedLanguage === option.value ? 0 : -1}
                      onClick={() => setLanguage(option.value)}
                      onKeyDown={(event) => onLanguageKeyDown(event, index)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              className="btn hero-cta"
              onClick={begin}
              disabled={!canStart}
            >
              {starting ? "Starting…" : statusCopy.startLabel}
            </button>
          </div>

          <div className="feature-grid">
            <article className="feature">
              <span aria-hidden>◎</span>
              <h2 className="feature-title">Personalized</h2>
              <p className="muted">Adapts to your strengths and gaps</p>
            </article>
            <article className="feature">
              <span aria-hidden>✎</span>
              <h2 className="feature-title">Practice</h2>
              <p className="muted">Real code, run against real tests</p>
            </article>
            <article className="feature">
              <span aria-hidden>◷</span>
              <h2 className="feature-title">Progress</h2>
              <p className="muted">Track what you have actually shown</p>
            </article>
            <article className="feature">
              <span aria-hidden>✦</span>
              <h2 className="feature-title">AI Tutor</h2>
              <p className="muted">Guidance the moment you are stuck</p>
            </article>
          </div>
        </div>
      )}

      {stage === "diagnostic" && step && !step.complete && (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1>Quick check</h1>
          <p className="sub">
            No grade here — getting one wrong just means we start there.
            {Object.keys(step.skipped).length > 0 &&
              ` ${Object.keys(step.skipped).length} question(s) already skipped: you showed me the answer by missing what they build on.`}
          </p>
          <div className="card" style={{ marginTop: 18 }}>
            <div className="top">
              <h2 className="exercise-title">{pretty(step.skill)}</h2>
              <span className="chip">Question {step.answered + 1}</span>
            </div>
            <p className="desc" style={{ whiteSpace: "pre-wrap" }}>{step.prompt}</p>
            <CodeEditor
              value={code}
              onChange={editCode}
              ariaLabel="Diagnostic answer"
              ref={editorRef}
              invalid={submissionNotice !== null}
              describedBy={submissionNotice ? "submission-notice" : undefined}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={submitDiagnostic} disabled={actionBusy}>
                {actionBusy ? "Checking…" : "Submit"}
              </button>
              <button className="btn ghost" onClick={() => answer("")} disabled={actionBusy}>
                I don&apos;t know this one
              </button>
            </div>
            {submissionNotice && (
              <p id="submission-notice" className="err" role="alert">{submissionNotice}</p>
            )}
          </div>
        </div>
      )}

      {stage === "diagnostic" && step?.complete && (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1>Here is what I found</h1>
          <div className="card">
            <p>
              <strong>Start here:</strong>{" "}
              {step.weakest_skill ? pretty(step.weakest_skill) : "nothing — you are ahead of this course"}
            </p>
            {step.missing_prerequisites.length > 0 && (
              <p className="sub">
                Gaps underneath it: {step.missing_prerequisites.join(", ")}
              </p>
            )}
            <p className="muted">
              Confidence in this picture: {percent(step.confidence)}
            </p>
            <button className="btn" onClick={enterApp} disabled={actionBusy} style={{ marginTop: 10 }}>
              See my plan
            </button>
          </div>
        </div>
      )}

      {stage === "app" && tab === "plan" && (
        <div className="view-region" aria-busy={loadingTab === "plan"}>
          {loadingTab === "plan" && plan && (
            <p className="view-updating" role="status">Updating…</p>
          )}
          {restartNote && <div className="note info restart-note" role="status">{restartNote}</div>}
          {plan ? (
            <PlanDashboard
              plan={plan}
              activeSkill={view?.awaiting_student ? view.target_skill : null}
              view={view}
              progress={progress}
              activity={activity}
              name={displayName}
              onStart={startSkill}
              onHint={askForHint}
              hints={hints.slice(0, shown)}
              exhausted={shown > 0 && shown >= hints.length}
              busy={actionBusy || loadingTab === "plan" || turnPhase !== "idle"}
            />
          ) : loadingTab === "plan" ? (
            <LoadingView message="Loading your plan…" />
          ) : (
            <UnavailableView name="plan" />
          )}
        </div>
      )}

      {stage === "app" && tab === "learn" && (
        <div
          className="view-region"
          aria-busy={beginningSkill !== null || turnPhase !== "idle"}
        >
          {beginningSkill ? (
            <>
              {slowTutorAction === "begin" && (
                <p className="tutor-progress-note" role="status">
                  Writing your next exercise — this can take up to a minute.
                </p>
              )}
              <LoadingView message="Loading your exercise…" />
            </>
          ) : (
            <Learn
              view={view}
              code={code}
              setCode={editCode}
              submissionNotice={submissionNotice}
              editorRef={editorRef}
              onSubmit={submit}
              onHint={askForHint}
              hints={hints.slice(0, shown)}
              exhausted={shown > 0 && shown >= hints.length}
              turnPhase={turnPhase}
              hintBusy={actionBusy}
              onRetryTurn={() => resumeTurn(false)}
              onCheckTurn={() => resumeTurn(true)}
              languages={languageOptions}
            />
          )}
        </div>
      )}

      {stage === "app" && tab === "detail" && (
        <div className="view-region" aria-busy={loadingTab === "detail"}>
          {loadingTab === "detail" && progress && (
            <p className="view-updating" role="status">Updating…</p>
          )}
          {progress ? (
            <DetailView
              activity={view?.activity ?? []}
              events={view?.events}
              progress={progress}
            />
          ) : loadingTab === "detail" ? (
            <LoadingView message="Loading session detail…" />
          ) : (
            <UnavailableView name="session detail" />
          )}
        </div>
      )}

      {stage === "app" && tab === "progress" && (
        <div className="view-region" aria-busy={loadingTab === "progress"}>
          {loadingTab === "progress" && progress && activity && (
            <p className="view-updating" role="status">Updating…</p>
          )}
          {progress && activity ? (
            <ProgressView progress={progress} activity={activity} />
          ) : loadingTab === "progress" ? (
            <LoadingView message="Loading your progress…" />
          ) : (
            <UnavailableView name="progress" />
          )}
        </div>
      )}
        </>
      )}
    </Shell>
  );
}

function LoadingView({ message }: { message: string }) {
  return (
    <div className="view-loading" role="status">
      <span className="view-loading-mark" aria-hidden />
      <h1>{message}</h1>
      <p className="sub">One moment while the latest information arrives.</p>
    </div>
  );
}

function UnavailableView({ name }: { name: string }) {
  return (
    <div className="view-loading">
      <h1>Couldn&apos;t load {name}</h1>
      <p className="sub">Choose this section again to retry.</p>
    </div>
  );
}

function PlanDashboard({
  plan,
  activeSkill,
  view,
  progress,
  activity,
  name,
  onStart,
  onHint,
  hints,
  exhausted,
  busy,
}: {
  plan: Plan;
  activeSkill: string | null;
  view: TutorView | null;
  progress: Progress | null;
  activity: Activity | null;
  name: string;
  onStart: (skill: string) => void;
  onHint: () => void;
  hints: string[];
  exhausted: boolean;
  busy: boolean;
}) {
  const focus = dashboardFocus(plan, activeSkill);
  const rail = (
    <DashboardRail
      view={view}
      progress={progress}
      hints={hints}
      exhausted={exhausted}
      busy={busy}
      onHint={onHint}
    />
  );

  return (
    <div className="academic-layout">
      <section className="academic-main" aria-labelledby="dashboard-title">
        <GreetingBlock
          plan={plan}
          progress={progress}
          activity={activity}
          focus={focus}
          name={name}
          onStart={onStart}
          busy={busy}
        />
        <StatRow plan={plan} progress={progress} activity={activity} view={view} focus={focus} />
        {focus && (
          <FocusCard
            skill={focus}
            active={focus.skill === activeSkill}
            view={view}
            onStart={() => onStart(focus.skill)}
            busy={busy}
          />
        )}
        <div className="roadmap-title-row">
          <div>
            <h2 id="roadmap-title">Curriculum roadmap</h2>
            <p className="sub">Ordered by the engine&apos;s current Python fundamentals plan.</p>
          </div>
        </div>
        <LearningPlan
          plan={plan}
          activeSkill={activeSkill}
          onStart={onStart}
          busy={busy}
        />
      </section>
      {rail}
    </div>
  );
}

function GreetingBlock({
  plan,
  progress,
  activity,
  focus,
  name,
  onStart,
  busy,
}: {
  plan: Plan;
  progress: Progress | null;
  activity: Activity | null;
  focus: PlanSkill | null;
  name: string;
  onStart: (skill: string) => void;
  busy: boolean;
}) {
  const part = useDayPart();
  const attempts = visibleAttemptTotal(plan, progress);
  const streak = currentActivityStreak(activity);
  const summary =
    attempts === 0
      ? "Nothing recorded yet — your first exercise will start the streak."
      : [
          streak == null ? null : `${streak}-day streak`,
          attempts == null
            ? null
            : `${attempts} attempt${attempts === 1 ? "" : "s"}`,
          `${plan.counts.done} of ${plan.counts.total} confirmed`,
        ].filter(Boolean).join(" · ");

  return (
    <div className="greeting-block">
      <div className="greeting-copy">
        <p className="breadcrumb">
          PYTHON FUNDAMENTALS <span aria-hidden>/</span> {plan.counts.total} skills
        </p>
        <h1 id="dashboard-title">Good {part}, {name}</h1>
        <p className="sub">{summary}</p>
      </div>
      {focus && (
        <button
          type="button"
          className="btn continue-btn"
          onClick={() => onStart(focus.skill)}
          disabled={busy}
        >
          Continue {pretty(focus.skill)}
        </button>
      )}
    </div>
  );
}

function StatRow({
  plan,
  progress,
  activity,
  view,
  focus,
}: {
  plan: Plan;
  progress: Progress | null;
  activity: Activity | null;
  view: TutorView | null;
  focus: PlanSkill | null;
}) {
  const attempts = visibleAttemptTotal(plan, progress);
  const streak = currentActivityStreak(activity);
  const nextUp = plan.suggested_next
    ? plan.skills.find((skill) => skill.skill === plan.suggested_next) ?? null
    : null;
  const nextDemand =
    nextUp && view?.target_skill === nextUp.skill && view.difficulty_change?.demands
      ? view.difficulty_change.demands
      : nextUp
        ? skillBlurb(nextUp.skill)
        : "All skills are confirmed.";

  return (
    <div className="dashboard-stat-row">
      <div className="stat academic-stat done">
        <span>CONFIRMED</span>
        <b>{plan.counts.done}/{plan.counts.total}</b>
        <small>{plan.counts.total - plan.counts.done} still open</small>
      </div>
      <div className="stat academic-stat maybe" title="Looks good, not confirmed yet">
        <span>LOOKS GOOD</span>
        <b>{plan.counts.provisional}</b>
        <small>not confirmed yet</small>
      </div>
      <div className="stat academic-stat">
        <span>ATTEMPTS</span>
        <b>{attempts ?? "—"}</b>
        <small>
          {streak != null
            ? `${streak}-day streak`
            : attempts == null
              ? "Open Progress to load the total"
              : `${attempts} attempt${attempts === 1 ? "" : "s"} recorded`}
        </small>
      </div>
      <div className="stat academic-stat">
        <span>NEXT UP</span>
        <b>{nextUp ? pretty(nextUp.skill) : focus ? pretty(focus.skill) : "None"}</b>
        <small>{nextDemand}</small>
      </div>
    </div>
  );
}

function FocusCard({
  skill,
  active,
  view,
  onStart,
  busy,
}: {
  skill: PlanSkill;
  active: boolean;
  view: TutorView | null;
  onStart: () => void;
  busy: boolean;
}) {
  const unmeasured = !skill.measured;
  const blocked = skill.state === "locked";
  const demand =
    active && view?.target_skill === skill.skill && view.difficulty_change?.demands
      ? view.difficulty_change.demands
      : skillBlurb(skill.skill);

  return (
    <section className={`focus-card${active ? " active" : ""}`} aria-labelledby="focus-title">
      <div className="focus-copy">
        <p className="breadcrumb">{active ? "CURRENT FOCUS" : "NEXT UP"}</p>
        <h2 id="focus-title">{pretty(skill.skill)}</h2>
        <p className="sub">{demand}</p>
        {blocked && skill.not_measured_because !== null ? (
          <p className="muted">{notMeasuredLabel(skill.not_measured_because)}</p>
        ) : blocked && skill.blocked_by.length > 0 ? (
          <p className="muted">Waiting on {skill.blocked_by.map(pretty).join(", ")}</p>
        ) : null}
      </div>
      <div className="focus-meter">
        <span className={`chip ${skill.state === "completed" ? "done" : skill.state === "provisional" ? "maybe" : ""}`}>
          {skill.state}
        </span>
        <strong>
          {skill.mastery === null ? "Not checked yet" : percent(skill.mastery)}
        </strong>
        <small className="muted">{unmeasured ? "no measurement yet" : "mastery estimate"}</small>
        {!blocked && (
          <button type="button" className="btn continue-btn" onClick={onStart} disabled={busy}>
            Continue {pretty(skill.skill)}
          </button>
        )}
      </div>
    </section>
  );
}

function DashboardRail({
  view,
  progress,
  hints,
  exhausted,
  busy,
  onHint,
}: {
  view: TutorView | null;
  progress: Progress | null;
  hints: string[];
  exhausted: boolean;
  busy: boolean;
  onHint: () => void;
}) {
  const hasHintPanel = Boolean(view?.problem && view.awaiting_student);
  const hasRecentPanel = progress !== null;
  if (!hasHintPanel && !hasRecentPanel) return null;

  return (
    <aside className="dashboard-rail" aria-label="Secondary panels">
      {hasHintPanel && (
        <NextHintPanel
          view={view}
          hints={hints}
          exhausted={exhausted}
          busy={busy}
          onHint={onHint}
        />
      )}
      {progress && <RecentActivityPanel progress={progress} />}
    </aside>
  );
}

function NextHintPanel({
  view,
  hints,
  exhausted,
  busy,
  onHint,
}: {
  view: TutorView | null;
  hints: string[];
  exhausted: boolean;
  busy: boolean;
  onHint: () => void;
}) {
  if (!view?.problem || !view.awaiting_student) return null;

  return (
    <section className="panel hint-panel">
      <div className="head">
        <h2>Next hint</h2>
        <button type="button" className="reveal-btn" onClick={onHint} disabled={busy || exhausted}>
          {exhausted ? "No more hints" : "Reveal"}
        </button>
      </div>
      <p className="muted">{view.problem.title ?? pretty(view.target_skill ?? "current skill")}</p>
      {hints.map((hint, i) => (
        <div className="note info" key={i}>
          <strong>Hint {i + 1}</strong>
          {hint}
        </div>
      ))}
      {exhausted && (
        <p className="muted">
          That&apos;s as much as I can give you without doing it for you — have a go, and I&apos;ll tell you exactly what went wrong.
        </p>
      )}
    </section>
  );
}

function RecentActivityPanel({ progress }: { progress: Progress }) {
  return (
    <section className="panel recent-panel">
      <div className="head">
        <h2>Recent activity</h2>
      </div>
      {progress.recent_attempts.length === 0 && (
        <div className="event plain">
          <p>
            Nothing here yet. The quick check is a probe, not an attempt — this fills
            up once you start answering real exercises, and every line shows what your
            mastery did and why.
          </p>
        </div>
      )}
      {progress.recent_attempts.map((a, i) => (
        <div className={`event ${a.outcome === "CORRECT" ? "leaf" : "butter"}`} key={i}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="kind">{pretty(a.skill)}</span>
            <span className="when">
              {percent(a.mastery_before)} → {percent(a.mastery_after)}
            </span>
          </div>
          <p>{a.outcome.replace(/_/g, " ").toLowerCase()}</p>
        </div>
      ))}
    </section>
  );
}

function Learn({
  view,
  code,
  setCode,
  submissionNotice,
  editorRef,
  onSubmit,
  onHint,
  hints,
  exhausted,
  turnPhase,
  hintBusy,
  onRetryTurn,
  onCheckTurn,
  languages,
}: {
  view: TutorView | null;
  code: string;
  setCode: (v: string) => void;
  submissionNotice: string | null;
  editorRef: Ref<CodeEditorHandle>;
  onSubmit: () => void;
  onHint: () => void;
  hints: string[];
  exhausted: boolean;
  turnPhase: TurnPhase;
  hintBusy: boolean;
  onRetryTurn: () => void;
  onCheckTurn: () => void;
  languages: LanguageOption[];
}) {
  if (!view) {
    return (
      <div style={{ maxWidth: 620, margin: "6vh auto", textAlign: "center" }}>
        <h1>Nothing in progress</h1>
        <p className="sub">Pick a skill from your learning plan to begin.</p>
      </div>
    );
  }
  const fb = view.feedback;
  const runningLanguage = view.language
    ? languages.find((option) => option.value === view.language) ?? null
    : null;
  const defaultLanguageValue = languages[0]?.value ?? null;
  const languageChipLabel =
    runningLanguage && defaultLanguageValue && runningLanguage.value !== defaultLanguageValue
      ? runningLanguage.label
      : null;
  const activePhaseLabel = phaseLabel(turnPhase);
  const controlsBusy = turnPhase !== "idle" || hintBusy;
  return (
    <div className="columns">
      <section>
        {/* Our failure is never shown as the student's mistake. */}
        {/* A student moved to a harder problem with no explanation has been handed a
            harder problem for no visible reason, which reads as the system being
            arbitrary. Only the ladder-derived learner explanation belongs here. */}
        {view.difficulty_change && (
          <div className={`note ${view.difficulty_change.direction === "up" ? "info" : "warn"}`}>
            <strong>
              {view.difficulty_change.direction === "up"
                ? `Difficulty increased: ${view.difficulty_change.from} → ${view.difficulty_change.to}`
                : `Difficulty adjusted: ${view.difficulty_change.from} → ${view.difficulty_change.to}`}
            </strong>
            {view.difficulty_change.student_reason && (
              <>
                {view.difficulty_change.student_reason}
                {view.difficulty_change.concepts.length > 0 && (
                  <span className="muted" style={{ display: "block", marginTop: 6 }}>
                    Now testing: {view.difficulty_change.concepts.map((c) => c.replace(/_/g, " ")).join(", ")}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {fb?.was_our_fault && (
          <div className="note ours">
            <strong>Something on our side went wrong</strong>
            Your submission and your progress have been preserved, and nothing was
            counted against you.
            {/* The cause was always in this payload and was being discarded, so a
                student whose code was refused for importing `os` was told only that
                something went wrong. If we know what happened, say it. */}
            {fb.message ? <span className="muted"> {fb.message}</span> : null}
          </div>
        )}
        {fb && !fb.was_our_fault && fb.passed && (
          <div className="note good">
            <strong>Correct</strong>
            {fb.score != null && `Passed every test case (${(fb.score * 100).toFixed(0)}%).`}
          </div>
        )}
        {fb && !fb.was_our_fault && fb.passed === false && fb.message && (
          <div className="note warn">
            <strong>Not quite — but the mistake is a useful one</strong>
            {fb.message}
          </div>
        )}

        {/* The redirect, explained. Without this it reads from the student's side as
            the tutor changing the subject for no reason. */}
        {view.returning_to && view.returning_to !== view.target_skill && (
          <div className="note info">
            <strong>Let&apos;s back up for a moment</strong>
            We&apos;re working on <b>{view.target_skill}</b> first, then going straight
            back to <b>{view.returning_to}</b> — that is still what you came here for.
          </div>
        )}

        {view.problem && (view.awaiting_student || turnPhase !== "idle") ? (
          <div className="card">
            <div className="top">
              <h1 className="exercise-title">{view.problem.title}</h1>
              <div className="chip-row">
                <span className="chip">{view.difficulty}</span>
                {languageChipLabel && <span className="chip">{languageChipLabel}</span>}
              </div>
            </div>
            <p className="exercise-prompt">{view.problem.prompt}</p>
            {view.problem.expected_output && (
              <p className="muted">
                Expected output: <code>{view.problem.expected_output}</code>
              </p>
            )}
            <CodeEditor
              value={code}
              onChange={setCode}
              ariaLabel="Exercise answer"
              ref={editorRef}
              invalid={submissionNotice !== null}
              describedBy={submissionNotice ? "submission-notice" : undefined}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={onSubmit} disabled={controlsBusy}>
                {activePhaseLabel ?? "Submit"}
              </button>
              <button className="btn ghost" onClick={onHint} disabled={controlsBusy || exhausted}>
                {exhausted ? "No more hints" : "I'm stuck — give me a hint"}
              </button>
            </div>
            {submissionNotice && (
              <p id="submission-notice" className="err" role="alert">{submissionNotice}</p>
            )}
            {activePhaseLabel && (
              <p className="tutor-progress-note" role="status">
                {activePhaseLabel}
              </p>
            )}
            {turnPhase === "failed" && (
              <div className="row err" role="alert">
                <span>
                  {view.phase_error ??
                    "We couldn't finish updating your plan. Your answer was saved."}
                </span>
                <button type="button" className="btn ghost" onClick={onRetryTurn}>
                  Try again
                </button>
              </div>
            )}
            {turnPhase === "timed-out" && (
              <div className="row err" role="alert">
                <span>{TURN_TIMEOUT_MESSAGE}</span>
                <button type="button" className="btn ghost" onClick={onCheckTurn}>
                  Check again
                </button>
              </div>
            )}

            {hints.map((hint, i) => (
              <div className="note info" key={i} style={{ marginTop: 12 }}>
                <strong>Hint {i + 1}</strong>
                {hint}
              </div>
            ))}
            {exhausted && (
              <p className="muted" style={{ marginTop: 10 }}>
                That&apos;s as much as I can give you without doing it for you — have a
                go, and I&apos;ll tell you exactly what went wrong.
              </p>
            )}
            {/* This used to print the raw retrieval sources -- "04_loops.md#4.1 Why
                loops exist" -- which names our own filenames and tells a student
                nothing about what they are being asked to do. What is useful here is
                what the exercise is testing and how the submission will be judged. */}
            <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
              Testing <strong>{pretty(view.target_skill ?? "")}</strong>
              {view.difficulty ? ` · ${view.difficulty.toLowerCase()}` : ""}. Your code is
              run against real test cases and compared with the expected output above.
            </p>
          </div>
        ) : (
          <div className="card">
            <h1 className="exercise-title">Session {view.session_status ?? "finished"}</h1>
            {view.recommended_next && (
              <p className="sub">
                Recommended next: <code>{view.recommended_next}</code>
              </p>
            )}
          </div>
        )}
      </section>

      <aside className="panel">
        <div className="head">
          <h2>What the tutor believes</h2>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
          What we believe you know, and how much evidence sits behind each one. Skills we
          have not tested yet say so rather than showing a number.
        </p>
        {Object.entries(view.mastery)
          .sort((a, b) => a[1] - b[1])
          .map(([skill, value]) => {
            // A skill at its prior is not a skill at 30%: it is one we have never tested.
            // Showing the prior as a figure is how untested skills came to display 0.24
            // indistinguishably from a skill the student had genuinely failed.
            const measured = (view.measured ?? []).includes(skill);
            const confidence = view.confidence?.[skill] ?? 0;
            return (
              <div key={skill} style={{ marginBottom: 12 }}>
                <div className="spread">
                  <span style={{ fontWeight: skill === view.target_skill ? 700 : 400 }}>
                    {pretty(skill)}
                  </span>
                  <span className="muted">
                    {measured ? percent(value) : "not checked yet"}
                  </span>
                </div>
                <div className="bar">
                  <span
                    style={{
                      width: measured ? `${Math.min(1, value) * 100}%` : "0%",
                      opacity: measured ? 1 : 0.35,
                    }}
                  />
                </div>
                {measured && (
                  <div className="muted" style={{ fontSize: ".78rem", marginTop: 3 }}>
                    {percent(confidence)} confidence
                  </div>
                )}
              </div>
            );
          })}
      </aside>
    </div>
  );
}

/* Server-assigned standing, rendered. Deliberately a lookup rather than a threshold
   comparison: this file must never decide for itself what counts as mastered. */
const STANDING_CHIP: Record<string, string> = {
  unmeasured: "chip",
  completed: "chip done",
  provisional: "chip maybe",
  unproven: "chip",
};
const STANDING_LABEL: Record<string, string> = {
  unmeasured: "Not checked yet",
  completed: "Confirmed",
  provisional: "Looks good",
  unproven: "Not shown yet",
};

function measuredSummary(
  mastery: number | null,
  confidence: number | null,
  attempts: number,
) {
  if (mastery === null || confidence === null) return null;
  return `${beliefLine(mastery, confidence)} · ${attempts} attempt${attempts === 1 ? "" : "s"}`;
}

/* Learner-facing notes and activity are projected by the server and contain only the
 * reviewed explanations that help someone understand what the tutor did next. */
function DetailView({
  activity,
  events,
  progress,
}: {
  activity: LearnerActivity[];
  events?: TutorEvent[];
  progress: Progress | null;
}) {
  const open = (progress?.skills ?? []).flatMap((s) =>
    s.misconceptions.map((m) => ({ skill: s.skill, text: m })),
  );
  const past = (progress?.skills ?? []).flatMap((s) =>
    s.overcome.map((m) => ({ skill: s.skill, text: m })),
  );

  return (
    <div className="columns">
      <section>
        <h1>Session detail</h1>
        <p className="sub" style={{ marginBottom: 18 }}>
          What the tutor noticed in your code, and what it did next.
        </p>

        <h2 style={{ margin: "18px 0 10px" }}>What it noticed</h2>
        {open.length === 0 && past.length === 0 && (
          <div className="note">
            Nothing to show yet. Notes appear here once the tutor has seen enough of your
            work.
          </div>
        )}
        {open.map((m, i) => (
          <div className="note warn" key={`o${i}`}>
            <strong>Open · {pretty(m.skill)}</strong>
            {m.text}
          </div>
        ))}
        {past.map((m, i) => (
          <div className="note good" key={`p${i}`}>
            <strong>Resolved · {pretty(m.skill)}</strong>
            {m.text}
          </div>
        ))}
      </section>

      <ActivityPanel activity={activity} events={events} />
    </div>
  );
}

function ProgressView({ progress, activity }: { progress: Progress; activity: Activity }) {
  const overcome = progress.skills.flatMap((s) =>
    s.overcome.map((m) => ({ skill: s.skill, text: m })),
  );
  const active = progress.skills.flatMap((s) =>
    s.misconceptions.map((m) => ({ skill: s.skill, text: m })),
  );
  const confirmed = progress.skills.filter((s) => s.state === "completed").length;

  return (
    <div className="columns">
      <section>
        <h1>Progress</h1>

        <StudentDashboard activity={activity} />

        {/* The headline used to be an average mastery percentage, which read as "you are
            62% through the course" and sat directly beside "0 ATTEMPTS". It was the mean
            of the tutor's own estimates, most of which were priors. A count of what has
            actually been confirmed cannot be misread that way, and it agrees with the
            learning plan because both come from the same predicate. */}
        <div className="toolbar">
          <div className="stat done">
            <b>
              {confirmed}/{progress.skills.length}
            </b>
            <span>CONFIRMED</span>
          </div>
          <div className="stat">
            <b>{progress.total_attempts}</b>
            <span>ATTEMPTS</span>
          </div>
          <div className="stat maybe">
            <b>{overcome.length}</b>
            <span>OVERCOME</span>
          </div>
        </div>

        {/* The whole reason this screen exists, and for a long time the one thing it did
            not show. The engine returns mastery, confidence and attempts for every
            skill; the page rendered three aggregate numbers and a white void, so a
            student who clicked "Progress" to see how they were doing per topic learned
            nothing about any topic. */}
        <h2 style={{ margin: "10px 0 4px" }}>Where you stand</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          Weakest first. Confidence is how much evidence sits behind the estimate — a
          topic answered right once scores high and is believed very little.
        </p>

        {progress.skills.map((s) => {
          const unmeasured = s.state === "unmeasured";
          const summary = measuredSummary(s.mastery, s.confidence, s.attempts);
          return (
            <div className="standing" key={s.skill}>
              <div className="spread">
                <b>{pretty(s.skill)}</b>
                <span className={STANDING_CHIP[s.state]}>{STANDING_LABEL[s.state]}</span>
              </div>

              <div className="bar" style={{ margin: "8px 0 6px" }}>
                <span
                  style={{
                    width:
                      s.mastery === null
                        ? "0%"
                        : `${Math.max(2, Math.min(1, s.mastery) * 100)}%`,
                    opacity: unmeasured ? 0.35 : 1,
                  }}
                />
              </div>

              <p className="muted" style={{ margin: 0 }}>
                {summary === null
                  ? notMeasuredLabel(s.not_measured_because)
                  : summary}
              </p>
            </div>
          );
        })}

        {/* The prose here is the diagnoser's own wording -- "The student believes that
            Python function definitions require a return type..." -- written ABOUT a
            learner for the tutor's benefit, in the third person. Reading a clinical
            write-up of yourself is a bad moment, so the sentences moved to the session
            detail view where that voice is the point. What stays is the fact, in the
            second person, which is what a student can actually act on. */}
        {(overcome.length > 0 || active.length > 0) && (
          <>
            <h2 style={{ margin: "22px 0 12px" }}>Sticking points</h2>
            {overcome.length > 0 && (
              <div className="note good">
                <strong>You have grown out of {overcome.length}</strong>
                {[...new Set(overcome.map((m) => pretty(m.skill)))].join(", ")}
              </div>
            )}
            {active.length > 0 && (
              <div className="note warn">
                <strong>Still working on</strong>
                {[...new Set(active.map((m) => pretty(m.skill)))].join(", ")} — the tutor
                is targeting these next. Its notes are in Session detail, under More.
              </div>
            )}
          </>
        )}
      </section>

      <aside className="panel">
        <div className="head">
          <h2>Recent activity</h2>
        </div>
        {progress.recent_attempts.length === 0 && (
          <div className="event plain">
            <p>
              Nothing here yet. The quick check is a probe, not an attempt — this fills
              up once you start answering real exercises, and every line shows what your
              mastery did and why.
            </p>
          </div>
        )}
        {progress.recent_attempts.map((a, i) => (
          <div className={`event ${a.outcome === "CORRECT" ? "leaf" : "butter"}`} key={i}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="kind">{pretty(a.skill)}</span>
              <span className="when">
                {percent(a.mastery_before)} → {percent(a.mastery_after)}
              </span>
            </div>
            <p>{a.outcome.replace(/_/g, " ").toLowerCase()}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}
