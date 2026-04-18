const DEFAULT_ICON_FILE = "icon.svg";

/**
 * @typedef {{
 *   iconPath?: string,
 *   iconFile?: string,
 *   secondaryIconPath?: string,
 *   secondaryIconFile?: string,
 *   stylesheetPath?: string,
 *   stylesheetFile?: string,
 * }} ToolAssetOverride
 */

/**
 * Explicit asset metadata for tools whose icons or stylesheets do not match
 * the default derived filenames.
 */
/** @type {Record<string, ToolAssetOverride>} */
const TOOL_ASSET_METADATA = {
  Cursor: {
    iconPath: "tools/pencil/icon.svg",
  },
  "Straight line": {
    secondaryIconFile: "icon-straight.svg",
    stylesheetFile: "straight-line.css",
  },
  Rectangle: {
    secondaryIconFile: "icon-square.svg",
    stylesheetFile: "rectangle.css",
  },
  Ellipse: {
    iconFile: "icon-ellipse.svg",
    secondaryIconFile: "icon-circle.svg",
    stylesheetFile: "ellipse.css",
  },
  Pencil: {
    secondaryIconFile: "whiteout_tape.svg",
    stylesheetFile: "pencil.css",
  },
  Text: {
    stylesheetFile: "text.css",
  },
  Hand: {
    iconFile: "hand.svg",
    secondaryIconFile: "selector.svg",
  },
  Download: {
    iconFile: "download.svg",
  },
  Clear: {
    iconFile: "clear.svg",
  },
};

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
 *   moduleFile: string,
 *   iconPath: string,
 *   secondaryIconPath: string | null,
 *   stylesheetPath: string | null,
 * }}
 */
function getToolAssetDescriptor(toolName) {
  const metadata = TOOL_ASSET_METADATA[toolName] || {};
  const dir = toolStem(toolName);
  const moduleFile = `${dir}.js`;
  const iconPath =
    metadata.iconPath ||
    `tools/${dir}/${metadata.iconFile || DEFAULT_ICON_FILE}`;
  const secondaryIconPath = metadata.secondaryIconPath
    ? metadata.secondaryIconPath
    : metadata.secondaryIconFile
      ? `tools/${dir}/${metadata.secondaryIconFile}`
      : null;
  const stylesheetPath = metadata.stylesheetPath
    ? metadata.stylesheetPath
    : metadata.stylesheetFile
      ? `tools/${dir}/${metadata.stylesheetFile}`
      : null;
  return {
    dir: dir,
    moduleFile: moduleFile,
    iconPath: iconPath,
    secondaryIconPath: secondaryIconPath,
    stylesheetPath: stylesheetPath,
  };
}

/**
 * @param {string} toolName
 * @returns {string}
 */
export function getToolModuleImportPath(toolName) {
  const descriptor = getToolAssetDescriptor(toolName);
  return `../tools/${descriptor.dir}/${descriptor.moduleFile}`;
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
