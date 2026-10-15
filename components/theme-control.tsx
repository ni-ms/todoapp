"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
type Theme = "system" | "light" | "dark";
function getTheme(): Theme {
  try {
    const value = localStorage.getItem("daymark-theme");
    return value === "dark" || value === "light" ? value : "system";
  } catch {
    return "system";
  }
}
function subscribe(callback: () => void) {
  window.addEventListener("daymark-theme", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("daymark-theme", callback);
    window.removeEventListener("storage", callback);
  };
}
export function ThemeControl() {
  const theme = useSyncExternalStore(
    subscribe,
    getTheme,
    () => "system" as Theme,
  );
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  }, [theme]);
  const next: Theme =
    theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${theme}. Switch to ${next}`}
      title={`Theme: ${theme}`}
      onClick={() => {
        try {
          localStorage.setItem("daymark-theme", next);
        } catch {
          /* System appearance remains available if storage is disabled. */
        }
        window.dispatchEvent(new Event("daymark-theme"));
      }}
    >
      {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
    </Button>
  );
}
