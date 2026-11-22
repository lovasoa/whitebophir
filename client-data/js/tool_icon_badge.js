import { getToolIconPath } from "../tools/tool-defaults.js";
import { createUiIcon, setUiIconUrl } from "./ui_icon.js";

const assetBase = new URL("../", import.meta.url).href;

/**
 * Creates the shared circular tool-icon badge used by remote cursor pills and
 * connected-user rows.
 * @param {string} badgeClass
 * @param {string} iconClass
 * @returns {{badge: HTMLSpanElement, icon: SVGSVGElement}}
 */
export function createToolIconBadge(badgeClass, iconClass) {
  const badge = document.createElement("span");
  badge.setAttribute("class", badgeClass);
  const icon = createUiIcon(iconClass);
  badge.appendChild(icon);
  return { badge, icon };
}

/**
 * Updates a shared circular tool-icon badge.
 * @param {SVGSVGElement} icon
 * @param {string} toolId
 * @param {string} label
 */
export function updateToolIconBadge(icon, toolId, label) {
  setUiIconUrl(icon, assetBase + getToolIconPath(toolId || "hand"));
  const badge = icon.parentElement;
  if (badge && badge.title !== label) badge.title = label;
}
