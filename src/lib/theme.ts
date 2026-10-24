import { useCallback, useEffect, useRef, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "tools-view.theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage 不可用时回退到系统偏好
  }
  const prefersLight =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

/** 用户是否手动选择过主题（选过则不再跟随系统） */
function hasExplicitChoice(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark";
  } catch {
    return false;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const explicitRef = useRef(hasExplicitChoice());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (explicitRef.current) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // 忽略存储失败
      }
    }
  }, [theme]);

  // 未手动选择过时，实时跟随系统深浅色切换
  useEffect(() => {
    if (explicitRef.current) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "light" : "dark");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    explicitRef.current = true;
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
