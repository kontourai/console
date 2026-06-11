import { useEffect, useState } from "react";

const STORAGE_KEY = "kontour.console.theme.v1";

type Theme = "dark" | "light";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return "dark";
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === "light") {
    html.setAttribute("data-theme", "light");
  } else {
    html.removeAttribute("data-theme");
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  return { theme, toggleTheme };
}
