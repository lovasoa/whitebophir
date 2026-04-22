/**
 * @param {string} toolId
 * @returns {string}
 */
export function getToolTranslationKey(toolId) {
  return toolId.replace(/-/g, "_");
}

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getDefaultToolLabel(toolId) {
  return toolId
    .split("-")
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part.toLowerCase(),
    )
    .join(" ");
}

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getToolIconPath(toolId) {
  return `tools/${toolId}/icon.svg`;
}

/**
 * @param {string} toolId
 * @param {boolean} drawsOnBoard
 * @returns {string | null}
 */
export function getToolStylesheetPath(toolId, drawsOnBoard) {
  return drawsOnBoard ? `tools/${toolId}/${toolId}.css` : null;
}

/**
 * @param {string} toolId
 * @param {string} assetFile
 * @returns {string}
 */
export function getToolRuntimeAssetPath(toolId, assetFile) {
  return `tools/${toolId}/${assetFile}`;
}

/**
 * @param {string} toolId
 * @returns {string}
 */
export function getToolModuleImportPath(toolId) {
  return `../tools/${toolId}/index.js`;
}
