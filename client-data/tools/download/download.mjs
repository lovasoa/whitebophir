export function createTool(runtime) {
  function downloadSVGFile() {
    const canvasCopy = runtime.svgElement.cloneNode(true);
    canvasCopy.removeAttribute("style"); // Remove css transform
    const styleNode = document.createElement("style");

    // Copy the stylesheets from the whiteboard to the exported SVG
    styleNode.innerHTML = Array.from(document.styleSheets)
      .filter((stylesheet) => {
        if (
          stylesheet.href &&
          (stylesheet.href.match(/boards\/tools\/.*\.css/) ||
            stylesheet.href.match(/board\.css/))
        ) {
          // This is a Stylesheet from a Tool or the Board itself, so we should include it
          return true;
        }
        // Not a stylesheet of the tool, so we can ignore it for export
        return false;
      })
      .map((stylesheet) =>
        Array.from(stylesheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n"),
      )
      .join("\n");

    canvasCopy.appendChild(styleNode);
    const outerHTML =
      canvasCopy.outerHTML || new XMLSerializer().serializeToString(canvasCopy);
    const blob = new Blob([outerHTML], { type: "image/svg+xml;charset=utf-8" });
    downloadContent(blob, `${runtime.boardName}.svg`);
  }

  function downloadContent(blob, filename) {
    const msSaveBlob = window.navigator.msSaveBlob;
    if (typeof msSaveBlob === "function") {
      // Internet Explorer
      msSaveBlob.call(window.navigator, blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const element = document.createElement("a");
      element.setAttribute("href", url);
      element.setAttribute("download", filename);
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      window.URL.revokeObjectURL(url);
    }
  }

  return {
    name: "Download",
    shortcut: "d",
    listeners: {},
    icon: "tools/download/download.svg",
    oneTouch: true,
    onstart: downloadSVGFile,
    mouseCursor: "crosshair",
  };
}
