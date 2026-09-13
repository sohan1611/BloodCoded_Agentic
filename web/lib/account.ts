export function initialsFor(name: string, email: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  if (initials) return initials;
  return email.trim()[0]?.toUpperCase() ?? "";
}

export function safeImageUrl(image: string | null | undefined): string | null {
  if (!image) return null;
  try {
    const url = new URL(image);
    return url.protocol === "https:" || url.protocol === "http:" ? image : null;
  } catch {
    return null;
  }
}

export function providerLabel(providerId: string): string {
  if (providerId === "google") return "Google";
  if (providerId === "credential") return "Email and password";
  return providerId;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const platform = /iPhone/.test(userAgent)
    ? "iPhone"
    : /Windows NT/.test(userAgent)
      ? "Windows"
      : /Macintosh|Mac OS X/.test(userAgent)
        ? "macOS"
        : null;

  return browser && platform ? `${browser} on ${platform}` : "Unknown device";
}

export function relativeTime(date: Date | string, now: Date): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "Unknown date";

  const elapsed = Math.max(0, now.getTime() - value.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(elapsed / 86_400_000);
  if (days <= 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter your full name.";
  if (trimmed.length > 64) return "Use 64 characters or fewer.";
  return null;
}

export function validatePasswordChange(input: {
  current: string;
  next: string;
  confirm: string;
}): string | null {
  if (!input.current) return "Enter your current password.";
  if (input.next.length < 8) return "Use at least 8 characters for your new password.";
  if (input.next === input.current) {
    return "Choose a password different from your current password.";
  }
  if (input.confirm !== input.next) return "The new passwords do not match.";
  return null;
}

export type EditorTextSize = "default" | "large" | "larger";

export const EDITOR_FONT_PX: Record<EditorTextSize, number> = {
  default: 16,
  large: 18,
  larger: 20,
};

const DEFAULT_PREFERENCES: { editorTextSize: EditorTextSize } = {
  editorTextSize: "default",
};

export function parsePreferences(raw: string | null): { editorTextSize: EditorTextSize } {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFERENCES };
    const editorTextSize = (parsed as { editorTextSize?: unknown }).editorTextSize;
    if (editorTextSize === "default" || editorTextSize === "large" || editorTextSize === "larger") {
      return { editorTextSize };
    }
  } catch {}
  return { ...DEFAULT_PREFERENCES };
}
