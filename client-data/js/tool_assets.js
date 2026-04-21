import { getToolCatalogEntry } from "./tool_catalog.js";

const DEFAULT_ICON_FILE = "icon.svg";

/**
 * @param {string} toolName
 * @returns {string}
 */
function toolStem(toolName) {
  return toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * @param {string} toolName
 * @returns {{
 *   dir: string,
 *   iconPath: string,
 *   secondaryIconPath: string | null,
 *   stylesheetPath: string | null,
 * }}
 */
function getToolAssetDescriptor(toolName) {
  const metadata = /** @type {any} */ (
    (toolName === "Cursor"
      ? { iconPath: "tools/pencil/icon.svg" }
      : getToolCatalogEntry(toolName)) || {}
  );
  const {
    iconFile = DEFAULT_ICON_FILE,
    iconPath,
    secondaryIconFile,
    secondaryIconPath,
    stylesheetFile,
    stylesheetPath,
    drawsOnBoard,
  } = metadata;
  const dir = toolStem(toolName);
  return {
    dir,
    iconPath: iconPath || `tools/${dir}/${iconFile}`,
    secondaryIconPath: secondaryIconPath || withToolDir(dir, secondaryIconFile),
    stylesheetPath:
      stylesheetPath ||
      withToolDir(
        dir,
        stylesheetFile || (drawsOnBoard ? `${dir}.css` : undefined),
      ),
  };
}

/**
 * @param {string} dir
 * @param {string | undefined} file
 * @returns {string | null}
 */
function withToolDir(dir, file) {
  return file ? `tools/${dir}/${file}` : null;
}

/**
 * @param {string} toolName
 * @returns {string}
 */
export function getToolModuleImportPath(toolName) {
  const descriptor = getToolAssetDescriptor(toolName);
  return `../tools/${descriptor.dir}/${descriptor.dir}.js`;
}

/**
 * @param {string} toolName
 * @returns {string}
 */
function getToolIconPath(toolName) {
  return getToolAssetDescriptor(toolName).iconPath;
}

/**
 * @param {string} toolName
 * @returns {string | null}
 */
function getToolStylesheetPath(toolName) {
  return getToolAssetDescriptor(toolName).stylesheetPath;
}

/**
 * @param {string} toolName
 * @param {string} assetFile
 * @returns {string}
 */
export function getToolRuntimeAssetPath(toolName, assetFile) {
  const descriptor = getToolAssetDescriptor(toolName);
  return `tools/${descriptor.dir}/${assetFile}`;
}

/**
 * @param {string} assetPath
 * @param {string} version
 * @returns {string}
 */
export function withVersion(assetPath, version) {
  if (!version) return assetPath;
  const separator = assetPath.includes("?") ? "&" : "?";
  return `${assetPath}${separator}v=${encodeURIComponent(version)}`;
}

/**
 * @param {string} assetPath
 * @returns {string}
 */
function toBoardPageAssetPath(assetPath) {
  return `../${assetPath}`;
}

/**
 * @param {string} toolName
 * @param {string} version
 * @returns {string}
 */
export function getToolIconUrl(toolName, version) {
  return withVersion(toBoardPageAssetPath(getToolIconPath(toolName)), version);
}

/**
 * @param {string} toolName
 * @param {string} version
 * @returns {string | null}
 */
export function getToolStylesheetUrl(toolName, version) {
  const stylesheetPath = getToolStylesheetPath(toolName);
  return stylesheetPath
    ? withVersion(toBoardPageAssetPath(stylesheetPath), version)
    : null;
}
