// Keep this loader independent of the release-pinned runtime so a stale page
// can still recover when a deployment removes its release.
const root = document.documentElement;
const release = root.dataset.wboVersion || "";
const entry = new URL(
  `../assets/${release}/js/board_boot.js`,
  document.baseURI,
);
let runtimeLoaded = false;

void import(entry.href)
  .then((runtime) => {
    runtimeLoaded = true;
    return runtime.boardReady;
  })
  .catch((error) => {
    // Refresh only before connecting, where no queued edit can be lost.
    const canRefresh = !["connecting", "ready"].includes(
      root.dataset.boardPhase || "",
    );
    root.dataset.boardPhase = "error";
    document.dispatchEvent(
      new CustomEvent("wbo:board-phase", { detail: { phase: "error" } }),
    );
    if (!runtimeLoaded) {
      console.error("[wbo]", "boot.page_failed", {
        errorMessage: String(error),
      });
    }
    if (canRefresh && claimRefresh()) return;
    showReloadNotice();
  });

/**
 * Starts at most one reload per release, so a page that still fails after
 * reloading asks for a refresh instead of looping.
 *
 * @returns {boolean} whether a reload was started
 */
function claimRefresh() {
  const key = "wbo.asset-reload-version";
  try {
    if (sessionStorage.getItem(key) === release) return false;
    sessionStorage.setItem(key, release);
  } catch {
    return false; // Ask for a refresh rather than risk a reload loop.
  }
  location.reload();
  return true;
}

function showReloadNotice() {
  const tools = window.WBOApp;
  if (tools?.status) {
    tools.status.showUnknownMutationError("");
    return;
  }
  // Before hydration, set the notice from this page's own translations.
  try {
    const translations = JSON.parse(
      document.getElementById("translations")?.textContent || "{}",
    );
    const title = document.getElementById("boardStatusTitle");
    if (title) title.textContent = translations.unknown_error_reload_page;
  } catch {
    // Keep the rendered title when translations cannot be read.
  }
}
