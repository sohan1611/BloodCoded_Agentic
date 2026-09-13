"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import {
  deviceLabel,
  providerLabel,
  relativeTime,
  safeImageUrl,
  validateName,
  validatePasswordChange,
  type EditorTextSize,
} from "@/lib/account";
import { clearCachedJwt } from "@/lib/api";
import { authClient } from "@/lib/auth/client";
import { usePreferences } from "@/lib/preferences";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { PasswordField } from "./auth/auth-ui";
import { Avatar, signOutThisDevice } from "./account-hub";
import { Check, Palette, Shield, Sliders, User } from "./icons";

export type SettingsSection = "profile" | "preferences" | "appearance" | "security";

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof User;
}> = [
  { id: "profile", label: "Profile", icon: User },
  { id: "preferences", label: "Preferences", icon: Sliders },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "security", label: "Security", icon: Shield },
];

const TEXT_SIZE_OPTIONS: Array<{ value: EditorTextSize; label: string }> = [
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

type ListedAccount = { providerId: string };
type ListedSession = {
  token: string;
  userAgent?: string | null;
  createdAt: Date | string;
};

function authFailureMessage(error: unknown) {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (status === 0 || (typeof status === "number" && status >= 500)) {
      return "We couldn't reach the sign-in service. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

function isRejectedCurrentPassword(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; code?: unknown };
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
  return record.status === 400 || record.status === 401 || code.includes("INVALID_PASSWORD");
}

function moveRadio<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  options: readonly T[],
  refs: MutableRefObject<Array<HTMLButtonElement | null>>,
  select: (value: T) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = (index + direction + options.length) % options.length;
  const next = options[nextIndex];
  if (next !== undefined) select(next);
  refs.current[nextIndex]?.focus();
}

export function SettingsView({
  section,
  onSectionChange,
  onBack,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onBack: () => void;
}) {
  return (
    <div className="settings-view">
      <div className="settings-heading">
        <div>
          <h1>Settings</h1>
          <p className="muted">Manage your CogniFlow account and experience.</p>
        </div>
        <button type="button" className="btn ghost settings-back" onClick={onBack}>Back</button>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => onSectionChange(item.id)}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {section === "profile" && <ProfileSettings />}
          {section === "preferences" && <PreferenceSettings />}
          {section === "appearance" && <AppearanceSettings />}
          {section === "security" && <SecuritySettings />}
        </div>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { data } = authClient.useSession();
  const user = data?.user;
  const sessionName = user?.name?.trim() ?? "";
  const email = user?.email ?? "";
  const image = user?.image ?? null;
  const [name, setName] = useState(sessionName);
  const [baselineName, setBaselineName] = useState(sessionName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameError = validateName(name);
  const changed = name.trim() !== baselineName;

  useEffect(() => {
    setName(sessionName);
    setBaselineName(sessionName);
  }, [sessionName]);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const save = async () => {
    const validation = validateName(name);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await authClient.updateUser({ name: name.trim() });
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      clearCachedJwt();
      try {
        await authClient.getSession({ query: { disableCookieCache: true } });
      } catch {
        // The profile update succeeded even if refreshing the cached session did not.
      }
      setName(name.trim());
      setBaselineName(name.trim());
      setSaved(true);
    } catch (requestError) {
      setError(authFailureMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const createdAt = user?.createdAt instanceof Date
    ? user.createdAt
    : user?.createdAt
      ? new Date(user.createdAt)
      : null;
  const memberSince = createdAt
    ? createdAt.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <section className="settings-section" aria-labelledby="settings-profile-title">
      <div className="settings-section-intro">
        <h2 id="settings-profile-title">Profile</h2>
        <p>Keep the name shown across your learning experience up to date.</p>
      </div>

      <div className="settings-control settings-profile-photo">
        <Avatar name={sessionName} email={email} image={image} size={64} />
        <p className="muted">
          {safeImageUrl(image)
            ? "Your photo comes from your Google account."
            : "CogniFlow shows your initials. It does not store photos."}
        </p>
      </div>

      <div className="settings-control">
        <div className="auth-field">
          <label htmlFor="settings-full-name">Full name</label>
          <input
            id="settings-full-name"
            value={name}
            maxLength={64}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
              setSaved(false);
            }}
            aria-invalid={changed && nameError ? "true" : "false"}
            aria-describedby={changed && nameError ? "settings-name-error" : undefined}
          />
        </div>
        {changed && nameError && <p id="settings-name-error" className="settings-error" role="alert">{nameError}</p>}
        <div className="settings-action-row">
          <button type="button" className="btn" onClick={save} disabled={!changed || Boolean(nameError) || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="settings-success settings-saved-status" role="status"><Check size={16} /> Saved</span>}
        </div>
        {error && <p className="settings-error" role="alert">{error}</p>}
      </div>

      <div className="settings-control">
        <div className="auth-field">
          <label htmlFor="settings-email">Email</label>
          <input id="settings-email" value={email} readOnly />
        </div>
        <p className="settings-helper">This is the address you sign in with.</p>
      </div>

      <div className="settings-control settings-static-row">
        <span>Member since</span>
        <strong>{memberSince}</strong>
      </div>
    </section>
  );
}

function PreferenceSettings() {
  const { editorTextSize, setEditorTextSize } = usePreferences();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const values = TEXT_SIZE_OPTIONS.map((option) => option.value);

  return (
    <section className="settings-section" aria-labelledby="settings-preferences-title">
      <div className="settings-section-intro">
        <h2 id="settings-preferences-title">Preferences</h2>
        <p>Adjust how your learning workspace feels on this device.</p>
      </div>
      <div className="settings-control">
        <h3 id="editor-size-label">Code editor text size</h3>
        <div className="settings-segments" role="radiogroup" aria-labelledby="editor-size-label">
          {TEXT_SIZE_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={editorTextSize === option.value}
              tabIndex={editorTextSize === option.value ? 0 : -1}
              onClick={() => setEditorTextSize(option.value)}
              onKeyDown={(event) => moveRadio(event, index, values, refs, setEditorTextSize)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="settings-helper">Applies to exercise and quick-check editors. Saved on this device.</p>
      </div>
    </section>
  );
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const values = THEME_OPTIONS.map((option) => option.value);

  return (
    <section className="settings-section" aria-labelledby="settings-appearance-title">
      <div className="settings-section-intro">
        <h2 id="settings-appearance-title">Appearance</h2>
        <p>Choose the theme CogniFlow uses in this browser.</p>
      </div>
      <div className="settings-control">
        <div className="appearance-options" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              tabIndex={theme === option.value ? 0 : -1}
              onClick={() => setTheme(option.value)}
              onKeyDown={(event) => moveRadio(event, index, values, refs, setTheme)}
            >
              <span className={`appearance-swatch ${option.value}`} aria-hidden="true">
                {option.value === "system" && <><i /><i /></>}
              </span>
              <span>{option.label}</span>
              {theme === option.value && <Check className="appearance-check" />}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function SecuritySettings() {
  const { data } = authClient.useSession();
  const currentToken = data?.session.token ?? null;
  const [accounts, setAccounts] = useState<ListedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeAfterPassword, setRevokeAfterPassword] = useState(true);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const hasCredential = accounts.some((account) => account.providerId === "credential");

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const result = await authClient.listAccounts();
      if (result.error) {
        setAccountsError(authFailureMessage(result.error));
      } else {
        setAccounts(result.data ?? []);
      }
    } catch (error) {
      setAccountsError(authFailureMessage(error));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const result = await authClient.listSessions();
      if (result.error) {
        setSessionsError(authFailureMessage(result.error));
      } else {
        setSessions(result.data ?? []);
      }
    } catch (error) {
      setSessionsError(authFailureMessage(error));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadSessions();
  }, [loadAccounts, loadSessions]);

  const changePassword = async () => {
    const validation = validatePasswordChange({
      current: currentPassword,
      next: newPassword,
      confirm: confirmPassword,
    });
    if (validation) {
      setPasswordError(validation);
      return;
    }
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordSaved(false);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: revokeAfterPassword,
      });
      if (result.error) {
        setPasswordError(
          isRejectedCurrentPassword(result.error)
            ? "Your current password is incorrect."
            : authFailureMessage(result.error),
        );
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      if (revokeAfterPassword) await loadSessions();
    } catch (error) {
      setPasswordError(authFailureMessage(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  const revokeSession = async (token: string) => {
    setRevokingToken(token);
    setSessionsError(null);
    try {
      const result = await authClient.revokeSession({ token });
      if (result.error) {
        setSessionsError(authFailureMessage(result.error));
      } else {
        await loadSessions();
      }
    } catch (error) {
      setSessionsError(authFailureMessage(error));
    } finally {
      setRevokingToken(null);
    }
  };

  const revokeOtherSessions = async () => {
    setRevokingOthers(true);
    setSessionsError(null);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        setSessionsError(authFailureMessage(result.error));
      } else {
        setConfirmOthers(false);
        await loadSessions();
      }
    } catch (error) {
      setSessionsError(authFailureMessage(error));
    } finally {
      setRevokingOthers(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    setSignOutError(await signOutThisDevice());
    setSigningOut(false);
  };

  return (
    <section className="settings-section" aria-labelledby="settings-security-title">
      <div className="settings-section-intro">
        <h2 id="settings-security-title">Security</h2>
        <p>Review how you sign in and where your account is active.</p>
      </div>

      <div className="settings-control">
        <h3>Sign-in methods</h3>
        {accountsLoading ? (
          <div className="settings-skeleton-list" aria-label="Loading sign-in methods">
            <span className="settings-skeleton-row skeleton" /><span className="settings-skeleton-row skeleton" />
          </div>
        ) : accountsError ? (
          <div className="settings-inline-error" role="alert">
            <span>{accountsError}</span>
            <button type="button" className="btn ghost" onClick={loadAccounts}>Retry</button>
          </div>
        ) : (
          <div className="settings-list">
            {accounts.map((account) => (
              <div className="settings-list-row" key={account.providerId}>
                <span>{providerLabel(account.providerId)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-control">
        <h3>Password</h3>
        {accountsLoading ? (
          <span className="settings-skeleton-row skeleton" aria-label="Loading password options" />
        ) : hasCredential ? (
          <form className="settings-password-form" onSubmit={(event) => { event.preventDefault(); void changePassword(); }}>
            <PasswordField id="current-password" label="Current password" value={currentPassword} onChange={(value) => { setCurrentPassword(value); setPasswordError(null); setPasswordSaved(false); }} autoComplete="current-password" />
            <PasswordField id="new-password" label="New password" value={newPassword} onChange={(value) => { setNewPassword(value); setPasswordError(null); setPasswordSaved(false); }} autoComplete="new-password" />
            <PasswordField id="confirm-new-password" label="Confirm new password" value={confirmPassword} onChange={(value) => { setConfirmPassword(value); setPasswordError(null); setPasswordSaved(false); }} autoComplete="new-password" />
            <label className="settings-checkbox">
              <input type="checkbox" checked={revokeAfterPassword} onChange={(event) => setRevokeAfterPassword(event.target.checked)} />
              <span>Sign out of other devices</span>
            </label>
            <div className="settings-action-row">
              <button type="submit" className="btn" disabled={passwordBusy}>
                {passwordBusy ? "Changing…" : "Change password"}
              </button>
              {passwordSaved && <span className="settings-success" role="status"><Check size={16} /> Password changed</span>}
            </div>
            {passwordError && <p className="settings-error" role="alert">{passwordError}</p>}
          </form>
        ) : accountsError ? null : (
          <p className="settings-helper">You sign in with Google, so there is no CogniFlow password to change.</p>
        )}
      </div>

      <div className="settings-control">
        <h3>Active sessions</h3>
        {sessionsLoading ? (
          <div className="settings-skeleton-list" aria-label="Loading active sessions">
            <span className="settings-skeleton-row skeleton" /><span className="settings-skeleton-row skeleton" />
          </div>
        ) : sessionsError ? (
          <div className="settings-inline-error" role="alert">
            <span>{sessionsError}</span>
            <button type="button" className="btn ghost" onClick={loadSessions}>Retry</button>
          </div>
        ) : (
          <>
            <div className="settings-list">
              {sessions.map((session) => {
                const current = Boolean(currentToken && session.token === currentToken);
                return (
                  <div className="settings-list-row settings-session-row" key={session.token}>
                    <div>
                      <strong>{deviceLabel(session.userAgent)}</strong>
                      <span>{relativeTime(session.createdAt, new Date())}</span>
                    </div>
                    {current ? (
                      <span className="settings-current-badge">This device</span>
                    ) : (
                      <button type="button" className="btn ghost settings-small-button" onClick={() => revokeSession(session.token)} disabled={revokingToken === session.token}>
                        {revokingToken === session.token ? "Signing out…" : "Sign out"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="settings-confirm-row">
              {!confirmOthers ? (
                <button type="button" className="btn ghost" onClick={() => setConfirmOthers(true)}>Sign out of all other devices</button>
              ) : (
                <>
                  <button type="button" className="btn" onClick={revokeOtherSessions} disabled={revokingOthers}>{revokingOthers ? "Signing out…" : "Confirm"}</button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmOthers(false)} disabled={revokingOthers}>Cancel</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="settings-control">
        <h3>Sign out of this device</h3>
        <button type="button" className="btn ghost settings-danger-button" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError && <p className="settings-error" role="alert">{signOutError}</p>}
      </div>
    </section>
  );
}
