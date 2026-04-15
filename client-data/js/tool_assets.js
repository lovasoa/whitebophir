const DEFAULT_ICON_FILE = "icon.svg";
const DEFAULT_SECONDARY_ICON_FILE = "icon-secondary.svg";

/**
 * @typedef {{
 *   dir?: string,
 *   moduleFile?: string,
 *   iconPath?: string,
 *   iconFile?: string,
 *   secondaryIconPath?: string,
 *   secondaryIconFile?: string,
 *   stylesheetPath?: string,
 *   stylesheetFile?: string,
 * }} ToolAssetOverride
 */

/**
 * Transitional asset overrides while tool files still use legacy directory and
 * filename conventions.
 */
/** @type {Record<string, ToolAssetOverride>} */
const TOOL_ASSET_OVERRIDES = {
  Cursor: {
    dir: "cursor",
    moduleFile: "cursor.js",
    iconPath: "tools/pencil/icon.svg",
  },
  "Straight line": {
    dir: "line",
    moduleFile: "line.js",
    iconFile: "icon.svg",
    secondaryIconFile: "icon-straight.svg",
    stylesheetFile: "line.css",
  },
  Rectangle: {
    dir: "rect",
    moduleFile: "rect.js",
    iconFile: "icon.svg",
    secondaryIconFile: "icon-square.svg",
    stylesheetFile: "rect.css",
  },
  Ellipse: {
    dir: "ellipse",
    moduleFile: "ellipse.js",
    iconFile: "icon-ellipse.svg",
    secondaryIconFile: "icon-circle.svg",
    stylesheetFile: "ellipse.css",
  },
  Pencil: {
    dir: "pencil",
    moduleFile: "pencil.js",
    iconFile: "icon.svg",
    secondaryIconFile: "whiteout_tape.svg",
    stylesheetFile: "pencil.css",
  },
  Text: {
    dir: "text",
    moduleFile: "text.js",
    iconFile: "icon.svg",
    stylesheetFile: "text.css",
  },
  Eraser: {
    dir: "eraser",
    moduleFile: "eraser.js",
    iconFile: "icon.svg",
  },
  Hand: {
    dir: "hand",
    moduleFile: "hand.js",
    iconFile: "hand.svg",
    secondaryIconFile: "selector.svg",
  },
  Grid: {
    dir: "grid",
    moduleFile: "grid.js",
    iconFile: "icon.svg",
  },
  Download: {
    dir: "download",
    moduleFile: "download.js",
    iconFile: "download.svg",
  },
  Zoom: {
    dir: "zoom",
    moduleFile: "zoom.js",
    iconFile: "icon.svg",
  },
  Clear: {
    dir: "clear",
    moduleFile: "clear.js",
    iconFile: "clear.svg",
  },
};

/**
 * @param {string} toolName
 * @returns {string}
 */
export function toolStem(toolName) {
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
export function getToolAssetDescriptor(toolName) {
  const override = TOOL_ASSET_OVERRIDES[toolName] || {};
  const dir = override.dir || toolStem(toolName);
  const moduleFile = override.moduleFile || `${dir}.js`;
  const iconPath =
    override.iconPath ||
    `tools/${dir}/${override.iconFile || DEFAULT_ICON_FILE}`;
  const secondaryIconPath = override.secondaryIconPath
    ? override.secondaryIconPath
    : override.secondaryIconFile
      ? `tools/${dir}/${override.secondaryIconFile}`
      : null;
  const stylesheetPath = override.stylesheetPath
    ? override.stylesheetPath
    : override.stylesheetFile
      ? `tools/${dir}/${override.stylesheetFile}`
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
export function getToolIconPath(toolName) {
  return getToolAssetDescriptor(toolName).iconPath;
}

/**
 * @param {string} toolName
 * @returns {string | null}
 */
export function getToolSecondaryIconPath(toolName) {
  return getToolAssetDescriptor(toolName).secondaryIconPath;
}

/**
 * @param {string} toolName
 * @returns {string | null}
 */
export function getToolStylesheetPath(toolName) {
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
export function toBoardPageAssetPath(assetPath) {
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
