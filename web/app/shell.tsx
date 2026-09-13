"use client";

/**
 * The chrome: dark shell, glass nav, and the transition that carries one view into the
 * next.
 *
 * The glass is a finish painted OVER a swap, never the mechanism of it. An earlier
 * version drove the swap through the View Transitions API, which morphs beautifully and
 * silently dropped state changes when React was mid-render. A decorative effect must
 * never be able to eat a state transition, so the sweep is now a plain overlay: same
 * feel, works in every browser, and cannot fail in a way that costs the user anything.
 */

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { type EngineStatus } from "@/lib/engine";
import { isPlainLeftClick } from "@/lib/home";
import { AccountHub, ProfileButton } from "./account-hub";
import type { SettingsSection } from "./settings";

/** Kept in step with the .glass-sweep animation in globals.css. */
const SWEEP_MS = 620;

/** "detail" is deliberately NOT in TABS. It is the tutor's own working notes -- the
 *  decision trail and its diagnoses -- which are written ABOUT a student rather than to
 *  them, so it is reachable from the account hub and never occupies a bottom-bar slot a
 *  learner has to walk past. */
export type Tab = "plan" | "learn" | "progress" | "detail";

const TABS: { id: Tab; label: string; mobileLabel: string; icon: string }[] = [
  { id: "plan", label: "Learning Plan", mobileLabel: "Plan", icon: "◎" },
  { id: "learn", label: "Learn", mobileLabel: "Learn", icon: "✎" },
  { id: "progress", label: "Progress", mobileLabel: "Progress", icon: "◷" },
];
/** Swap a view behind a sheet of glass. */
export function useGlassSwap() {
  const [sweeping, setSweeping] = useState(false);

  const swap = useCallback((change: () => void) => {
    setSweeping(true);
    window.setTimeout(() => setSweeping(false), SWEEP_MS);

    // The state change is applied here, unconditionally, and NOT from inside a
    // transition callback.
    //
    // The tempting version wraps it in `startViewTransition(() => flushSync(change))`,
    // which gives a true cross-fade morph. It also loses the change: flushSync silently
    // no-ops while React is already rendering, and after a fifteen-second API call it
    // very often is. That cost a tab switch that never happened while the data behind
    // it had loaded fine -- a decorative effect quietly eating a state transition.
    //
    // So the glass is painted over the swap rather than driving it. The sweep is a
    // fixed overlay with its own backdrop-filter; it animates identically in every
    // browser, needs no API support, and cannot swallow anything.
    change();
  }, []);

  return { swap, sweeping };
}

export function Shell({
  tab,
  onTab,
  name,
  email,
  image,
  identityPending,
  hasLearner,
  engine,
  children,
  sweeping,
  onHome,
  onOpenSettings,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  name: string;
  email: string;
  image?: string | null;
  identityPending: boolean;
  hasLearner: boolean;
  engine: EngineStatus;
  children: React.ReactNode;
  sweeping: boolean;
  /** Where a plain logo click goes inside the app; absent means an ordinary link. */
  onHome?: () => void;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [forceMobileHub, setForceMobileHub] = useState(false);
  const headerTriggerRef = useRef<HTMLButtonElement>(null);
  const bottomTriggerRef = useRef<HTMLButtonElement>(null);
  const dotTriggerRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const hasTemplateNotice = engine.health?.generation === "deterministic-templates";

  const openMore = (trigger: HTMLButtonElement | null, forceMobile: boolean) => {
    if (moreOpen && lastTriggerRef.current === trigger) {
      setMoreOpen(false);
      return;
    }
    lastTriggerRef.current = trigger;
    setForceMobileHub(forceMobile);
    setMoreOpen(true);
  };

  const closeMore = useCallback((returnFocus = false) => {
    setMoreOpen(false);
    if (returnFocus) {
      window.setTimeout(() => lastTriggerRef.current?.focus({ preventScroll: true }), 0);
    }
  }, []);

  const selectTab = (next: Tab) => {
    setMoreOpen(false);
    onTab(next);
  };

  return (
    <>
      {sweeping && <div className="glass-sweep" aria-hidden />}
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <Link
              href="/"
              className="brand-home"
              aria-label="CogniFlow home"
              onClick={(event) => {
                // Inside the app a plain click returns to the learning plan without a
                // reload; any other click keeps normal link behaviour (new tab, window).
                if (onHome && isPlainLeftClick(event)) {
                  event.preventDefault();
                  setMoreOpen(false);
                  onHome();
                }
              }}
            >
              <img
                className="cogniflow-logo cogniflow-logo-light"
                src="/brand/cogniflow-icon-light.png"
                width={158}
                height={132}
                alt=""
              />
              <img
                className="cogniflow-logo cogniflow-logo-dark"
                src="/brand/cogniflow-icon-dark.png"
                width={158}
                height={135}
                alt=""
              />
            </Link>
            <div className="brand-copy">
              {hasTemplateNotice && (
                <div className="brand-line">
                  <button
                    ref={dotTriggerRef}
                    type="button"
                    className="engine-dot engine-dot-inline"
                    aria-label="Built-in templates status"
                    aria-expanded={moreOpen}
                    aria-haspopup="dialog"
                    aria-controls="account-hub"
                    onClick={() => openMore(dotTriggerRef.current, true)}
                  >
                    <span aria-hidden />
                  </button>
                </div>
              )}
              <p className="tagline">AI-powered adaptive learning</p>
            </div>
          </div>

          <nav className="nav" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                aria-current={hasLearner && tab === t.id ? "page" : undefined}
                onClick={() => selectTab(t.id)}
                disabled={!hasLearner}
                title={!hasLearner ? "Start learning first" : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="who-anchor">
            {identityPending ? (
              <span className="who skeleton identity-skeleton" aria-hidden="true" />
            ) : (
              <ProfileButton
                name={name}
                email={email}
                image={image}
                open={moreOpen}
                buttonRef={headerTriggerRef}
                onClick={() => openMore(headerTriggerRef.current, false)}
              />
            )}
            {moreOpen && (
              <AccountHub
                name={name}
                email={email}
                image={image}
                hasLearner={hasLearner}
                engine={engine}
                forceMobile={forceMobileHub}
                triggerRef={lastTriggerRef}
                onClose={closeMore}
                onOpenSettings={onOpenSettings}
                onOpenDetail={() => selectTab("detail")}
              />
            )}
          </div>
        </header>

        <div className="plate" style={{ viewTransitionName: "plate" }}>
          {children}
        </div>
      </div>

      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={hasLearner && tab === t.id ? "page" : undefined}
            onClick={() => selectTab(t.id)}
            disabled={!hasLearner}
            title={!hasLearner ? "Start learning first" : undefined}
          >
            <span aria-hidden>{t.icon}</span>
            {t.mobileLabel}
          </button>
        ))}
        <button
          ref={bottomTriggerRef}
          type="button"
          className={moreOpen ? "open" : undefined}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          aria-controls="account-hub"
          onClick={() => openMore(bottomTriggerRef.current, true)}
        >
          <span aria-hidden>•••</span>
          More
        </button>
      </nav>

    </>
  );
}
