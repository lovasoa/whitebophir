import { getToolRuntimeAssetPath } from "../tools/tool-defaults.js";

/**
 * Creates the shared circular tool-icon badge used by remote cursor pills and
 * connected-user rows.
 * @param {string} badgeClass
 * @param {string} iconClass
 * @returns {{badge: HTMLSpanElement, icon: HTMLImageElement}}
 */
export function createToolIconBadge(badgeClass, iconClass) {
  const badge = document.createElement("span");
  badge.setAttribute("class", badgeClass);
  const icon = document.createElement("img");
  icon.setAttribute("class", iconClass);
  icon.alt = "";
  icon.width = 16;
  icon.height = 16;
  badge.appendChild(icon);
  return { badge, icon };
}

/**
 * Updates a shared circular tool-icon badge.
 * @param {HTMLImageElement} icon
 * @param {string} toolId
 * @param {string} label
 */
export function updateToolIconBadge(icon, toolId, label) {
  icon.src = `../${getToolRuntimeAssetPath(toolId || "hand", "icon.svg")}`;
  icon.title = label;
}
