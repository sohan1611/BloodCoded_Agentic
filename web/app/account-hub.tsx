"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { clearCachedJwt } from "@/lib/api";
import { initialsFor, safeImageUrl } from "@/lib/account";
import { authClient } from "@/lib/auth/client";
import { engineCopy, type EngineStatus } from "@/lib/engine";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import {
  Book,
  ChevronDown,
  ExternalLink,
  Flag,
  LogOut,
  Notes,
  Shield,
  User,
} from "./icons";
import type { SettingsSection } from "./settings";

const THEME_OPTIONS: ThemeChoice[] = ["light", "dark", "system"];
const THEME_LABEL: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function Avatar({
  name,
  email,
  image,
  size,
}: {
  name: string;
  email: string;
  image?: string | null;
  size: number;
}) {
  const source = safeImageUrl(image);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [source]);

  return (
    <span
      className="account-avatar"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {source && !imageFailed ? (
        <img
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initialsFor(name, email)
      )}
    </span>
  );
}

export function ProfileButton({
  name,
  email,
  image,
  open,
  buttonRef,
  onClick,
}: {
  name: string;
  email: string;
  image?: string | null;
  open: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="who profile-button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="account-hub"
      aria-label={`Account menu for ${name}`}
      onClick={onClick}
    >
      <Avatar name={name} email={email} image={image} size={32} />
      <span className="profile-button-name">{name}</span>
      <ChevronDown className="profile-chevron" />
    </button>
  );
}

export async function signOutThisDevice(): Promise<string | null> {
  try {
    const result = await authClient.signOut();
    if (result.error) {
      return result.error.status === 0 || result.error.status >= 500
        ? "We couldn't reach the sign-in service. Please try again."
        : "Something went wrong. Please try again.";
    }
    clearCachedJwt();
    window.location.assign("/auth/sign-in");
    return null;
  } catch {
    return "We couldn't reach the sign-in service. Please try again.";
  }
}

function useDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return desktop;
}

function ThemeSegments({ onChoose }: { onChoose: () => void }) {
  const { theme, setTheme } = useTheme();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectWithArrow = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + direction + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    const next = THEME_OPTIONS[nextIndex];
    setTheme(next);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div className="hub-theme-control" role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((option, index) => (
        <button
          key={option}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={theme === option}
          tabIndex={theme === option ? 0 : -1}
          data-hub-item
          onClick={() => {
            setTheme(option);
            onChoose();
          }}
          onKeyDown={(event) => selectWithArrow(event, index)}
        >
          {THEME_LABEL[option]}
        </button>
      ))}
    </div>
  );
}

export function AccountHub({
  name,
  email,
  image,
  hasLearner,
  engine,
  forceMobile,
  triggerRef,
  onClose,
  onOpenSettings,
  onOpenDetail,
}: {
  name: string;
  email: string;
  image?: string | null;
  hasLearner: boolean;
  engine: EngineStatus;
  forceMobile: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (returnFocus?: boolean) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenDetail: () => void;
}) {
  const desktop = useDesktop();
  const mobile = forceMobile || !desktop;
  const panelRef = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const copy = engineCopy(engine);
  const templates = engine.health?.generation === "deterministic-templates";
  const status = templates
    ? "templates"
    : engine.state === "online"
      ? "online"
      : engine.state === "offline"
        ? "offline"
        : "waking";

  const chooseSettings = (section: SettingsSection) => {
    onClose();
    onOpenSettings(section);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("[data-hub-item]:not([disabled])")
        ?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(true);
        return;
      }
      if (mobile && event.key === "Tab") {
        const panel = panelRef.current;
        const focusable = Array.from(
          panel?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled])',
          ) ?? [],
        ).filter((item) => item.tabIndex >= 0);
        if (!panel || !focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !panel.contains(active))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>("[data-hub-item]:not([disabled])") ?? [],
      );
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = current < 0
        ? 0
        : (current + direction + items.length) % items.length;
      event.preventDefault();
      items[next]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobile, onClose]);

  useEffect(() => {
    if (!mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobile]);

  useEffect(() => {
    if (mobile) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [mobile, onClose, triggerRef]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutError(null);
    const message = await signOutThisDevice();
    setSignOutError(message);
    setSigningOut(false);
  }, []);

  const panel = (
    <div
      ref={panelRef}
      id="account-hub"
      className={`account-hub ${mobile ? "account-hub-sheet" : "account-hub-popover"}`}
      role="dialog"
      aria-label="Account"
      aria-modal={mobile ? true : undefined}
      onBlur={(event) => {
        if (mobile) return;
        const next = event.relatedTarget;
        if (next === null) return;
        if (
          next instanceof Node
          && (event.currentTarget.contains(next) || triggerRef.current?.contains(next))
        ) return;
        onClose();
      }}
    >
      <div className="hub-identity">
        <Avatar name={name} email={email} image={image} size={40} />
        <div>
          <strong>{name}</strong>
          <span>{email}</span>
        </div>
      </div>

      <div className="hub-group">
        <button type="button" className="hub-item" data-hub-item onClick={() => chooseSettings("profile")}>
          <User /><span>Profile</span>
        </button>
        <button type="button" className="hub-item" data-hub-item onClick={() => chooseSettings("security")}>
          <Shield /><span>Security</span>
        </button>
      </div>

      <div className="hub-group hub-theme-row">
        <span className="hub-theme-label">Theme</span>
        <ThemeSegments onChoose={() => onClose()} />
      </div>

      <div className="hub-group">
        <button
          type="button"
          className="hub-item"
          data-hub-item
          disabled={!hasLearner}
          onClick={() => {
            onClose();
            onOpenDetail();
          }}
        >
          <Notes />
          <span>
            Session detail
            {!hasLearner && <small>Available once you&apos;ve started.</small>}
          </span>
        </button>
        <div className="hub-engine-row">
          <span className={`hub-status-dot ${status}`} aria-hidden="true" />
          <div>
            <strong>{copy.title}</strong>
            {(engine.state !== "online" || templates) && <small>{copy.detail}</small>}
          </div>
          {engine.state === "offline" && (
            <button
              type="button"
              className="hub-retry"
              data-hub-item
              onClick={() => {
                engine.retry();
                onClose();
              }}
              disabled={engine.probeInFlight}
            >
              {engine.probeInFlight ? "Checking…" : "Try again"}
            </button>
          )}
        </div>
      </div>

      <div className="hub-group">
        <p className="hub-group-heading">Help &amp; feedback</p>
        <a
          className="hub-item"
          href="https://github.com/sohan1611/BloodCoded_Agentic#readme"
          target="_blank"
          rel="noopener noreferrer"
          data-hub-item
          onClick={() => onClose()}
        >
          <Book /><span>Documentation</span><ExternalLink size={15} className="hub-external" />
        </a>
        <a
          className="hub-item"
          href="https://github.com/sohan1611/BloodCoded_Agentic/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          data-hub-item
          onClick={() => onClose()}
        >
          <Flag /><span>Report a problem</span><ExternalLink size={15} className="hub-external" />
        </a>
      </div>

      <div className="hub-group hub-signout-group">
        <button
          type="button"
          className="hub-item hub-signout"
          data-hub-item
          onClick={signOut}
          disabled={signingOut}
        >
          <LogOut /><span>{signingOut ? "Signing out…" : "Sign out"}</span>
        </button>
        {signOutError && <p className="hub-error" role="alert">{signOutError}</p>}
      </div>
    </div>
  );

  if (!mobile) return panel;
  return createPortal(
    <div
      className="more-backdrop account-hub-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      {panel}
    </div>,
    document.body,
  );
}
