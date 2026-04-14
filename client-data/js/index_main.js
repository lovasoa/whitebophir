(() => {
  const assetVersion = document.documentElement.dataset.version;
  const versionSuffix = assetVersion
    ? `?v=${encodeURIComponent(assetVersion)}`
    : "";

  async function bootIndexPage() {
    await import(`./board_page_state.js${versionSuffix}`);
    await import(`./index.js${versionSuffix}`);
  }

  bootIndexPage().catch((error) => {
    console.error("Failed to boot index page:", error);
  });
})();
