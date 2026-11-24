const SVG_NS = "http://www.w3.org/2000/svg";

/** @param {string} className */
export function createUiIcon(className) {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("class", className);
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.appendChild(document.createElementNS(SVG_NS, "use"));
  return icon;
}

/**
 * @param {SVGSVGElement} icon
 * @param {string} url
 */
export function setUiIconUrl(icon, url) {
  const use = icon.firstElementChild;
  const href = `${url}#icon`;
  if (use && use.getAttribute("href") !== href) use.setAttribute("href", href);
}
