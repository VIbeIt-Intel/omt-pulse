import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("ob-theme") as Theme;
      if (stored === "light" || stored === "dark") return stored;
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    // Marketing landing can force dark without changing the signed-in app preference.
    const forced = root.dataset.forceTheme;
    if (forced === "light" || forced === "dark") {
      root.classList.remove("light", "dark");
      root.classList.add(forced);
      return;
    }
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("ob-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
