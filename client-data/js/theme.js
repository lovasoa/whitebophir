/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

(function () {
  // Theme management
  const ThemeManager = {
    STORAGE_KEY: "wbo-theme-preference",
    systemThemeListener: null,

    getStoredTheme: function () {
      try {
        return localStorage.getItem(this.STORAGE_KEY);
      } catch (e) {
        return null;
      }
    },

    setStoredTheme: function (theme) {
      try {
        localStorage.setItem(this.STORAGE_KEY, theme);
      } catch (e) {
        // Ignore localStorage errors
      }
    },

    getSystemTheme: function () {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    },

    getCurrentTheme: function () {
      const stored = this.getStoredTheme();
      return stored || this.getSystemTheme();
    },

    applyTheme: function (theme) {
      const root = document.documentElement;
      if (theme === "dark") {
        root.setAttribute("data-theme", "dark");
      } else if (theme === "light") {
        root.setAttribute("data-theme", "light");
      } else {
        // Auto/system preference
        root.removeAttribute("data-theme");
      }
      this.updateThemeIcon(theme);
      this.updateAriaPressed(theme);
    },

    updateAriaPressed: function (theme) {
      const toggleBtn = document.getElementById("theme-toggle");
      if (!toggleBtn) return;
      toggleBtn.setAttribute(
        "aria-pressed",
        theme === "dark" ? "true" : "false",
      );
    },

    updateThemeIcon: function (theme) {
      const toggleBtn = document.getElementById("theme-toggle");
      if (!toggleBtn) return;

      const icon = toggleBtn.querySelector(".theme-icon");
      const label = toggleBtn.querySelector(".theme-label");

      if (theme === "dark") {
        if (icon) icon.textContent = "☀️";
        if (label) label.textContent = "Light";
      } else {
        if (icon) icon.textContent = "🌙";
        if (label) label.textContent = "Dark";
      }
    },

    toggleTheme: function () {
      const current = this.getCurrentTheme();
      const newTheme = current === "dark" ? "light" : "dark";
      this.setStoredTheme(newTheme);
      this.applyTheme(newTheme);
    },

    cleanup: function () {
      if (this.systemThemeListener) {
        window
          .matchMedia("(prefers-color-scheme: dark)")
          .removeEventListener("change", this.systemThemeListener);
        this.systemThemeListener = null;
      }
    },

    init: function () {
      const self = this;

      // Apply initial theme
      const current = this.getCurrentTheme();
      this.applyTheme(current);

      // Listen for system theme changes
      this.systemThemeListener = function (e) {
        if (!self.getStoredTheme()) {
          self.applyTheme(e.matches ? "dark" : "light");
        }
      };
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", this.systemThemeListener);

      // Set up toggle button
      const toggleBtn = document.getElementById("theme-toggle");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", function () {
          self.toggleTheme();
        });
      }

      // Cleanup on page unload
      window.addEventListener("beforeunload", function () {
        self.cleanup();
      });
    },
  };

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ThemeManager.init();
    });
  } else {
    ThemeManager.init();
  }

  // Expose for debugging
  window.ThemeManager = ThemeManager;
})();
