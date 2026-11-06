// Keep this loader independent of the versioned runtime so it can recover even
// when a deployment happens between loading the HTML and its first module.
const root = document.documentElement;
const assetBase =
  root.dataset.assetBase || `../assets/${root.dataset.wboVersion}/`;
const entry = new URL(`${assetBase}js/board_boot.js`, document.baseURI);
let runtimeLoaded = false;

void import(entry.href)
  .then((runtime) => {
    runtimeLoaded = true;
    return runtime.boardReady;
  })
  .catch(async (error) => {
    const canReload = !["connecting", "ready"].includes(
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
    try {
      const response = await fetch(entry, {
        method: "HEAD",
        cache: "no-store",
      });
      if (response.status !== 409) return;
      try {
        const key = "wbo.asset-reload-version";
        if (
          canReload &&
          sessionStorage.getItem(key) !== root.dataset.wboVersion
        ) {
          sessionStorage.setItem(key, root.dataset.wboVersion || "");
          location.reload();
          return;
        }
      } catch {
        // Without session storage, ask for a refresh rather than risk a loop.
      }
      const tools = window.WBOApp;
      if (tools?.status) {
        tools.status.showUnknownMutationError("");
      } else {
        const translations = JSON.parse(
          document.getElementById("translations")?.textContent || "{}",
        );
        const title = document.getElementById("boardStatusTitle");
        if (title) title.textContent = translations.unknown_error_reload_page;
      }
    } catch {
      // Only a confirmed version mismatch warrants a refresh.
    }
  });
