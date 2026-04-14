async function bootLegacyBoardModules() {
  await import("./intersect.mjs");
  await import("../tools/pencil/wbo_pencil_point.mjs");
  await import("../tools/pencil/pencil.mjs");
  await import("../tools/cursor/cursor.mjs");
  await import("../tools/line/line.mjs");
  await import("../tools/rect/rect.mjs");
  await import("../tools/ellipse/ellipse.mjs");
  await import("../tools/text/text.mjs");
  await import("../tools/eraser/eraser.mjs");
  await import("../tools/hand/hand.mjs");
  await import("../tools/grid/grid.mjs");
  await import("../tools/download/download.mjs");
  await import("../tools/zoom/zoom.mjs");
  if (document.documentElement.hasAttribute("data-moderator")) {
    await import("../tools/clear/clear.mjs");
  }
  await import("./canvascolor.mjs");
}

bootLegacyBoardModules().catch((error) => {
  console.error("Failed to boot board modules:", error);
});
