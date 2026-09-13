"use client";

import { useCallback, useEffect, useState } from "react";
import { parsePreferences, type EditorTextSize } from "./account";

const PREFERENCES_KEY = "cogniflow-preferences";
const PREFERENCES_EVENT = "cogniflow-preferences-change";

function readPreferences() {
  try {
    return parsePreferences(localStorage.getItem(PREFERENCES_KEY));
  } catch {
    return parsePreferences(null);
  }
}

export function usePreferences() {
  const [editorTextSize, setEditorTextSizeState] = useState<EditorTextSize>("default");

  useEffect(() => {
    setEditorTextSizeState(readPreferences().editorTextSize);
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        (event.detail === "default" || event.detail === "large" || event.detail === "larger")
      ) {
        setEditorTextSizeState(event.detail);
        return;
      }
      if (event instanceof StorageEvent && event.key !== PREFERENCES_KEY) return;
      setEditorTextSizeState(readPreferences().editorTextSize);
    };
    window.addEventListener(PREFERENCES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setEditorTextSize = useCallback((next: EditorTextSize) => {
    setEditorTextSizeState(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ editorTextSize: next }));
    } catch {}
    window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: next }));
  }, []);

  return { editorTextSize, setEditorTextSize };
}
