"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const THEME_KEY = "cogniflow-theme";
const THEME_EVENT = "cogniflow-theme-change";

function isTheme(value: string | null): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

function stampTheme(theme: ThemeChoice) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (isTheme(stored)) {
        setThemeState(stored);
        stampTheme(stored);
      }
    } catch {
      const stamped = document.documentElement.dataset.theme;
      setThemeState(stamped === "light" || stamped === "dark" ? stamped : "system");
    }
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof CustomEvent && isTheme(event.detail)) {
        setThemeState(event.detail);
        stampTheme(event.detail);
        return;
      }
      if (event instanceof StorageEvent && event.key !== THEME_KEY) return;
      let next: string | null = null;
      try {
        next = localStorage.getItem(THEME_KEY);
      } catch {}
      if (isTheme(next)) {
        setThemeState(next);
        stampTheme(next);
      }
    };
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    stampTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  }, []);

  return { theme, setTheme };
}
