const STORED_SVG_FORMAT = "whitebophir-svg-v1";

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function unescapeHtml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * @param {string} rawAttributes
 * @returns {{[name: string]: string}}
 */
function parseAttributes(rawAttributes) {
  /** @type {{[name: string]: string}} */
  const attributes = {};
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g;
  let match = pattern.exec(rawAttributes);
  while (match) {
    const [, name, value] = match;
    if (name && value !== undefined) {
      attributes[name] = unescapeHtml(value);
    }
    match = pattern.exec(rawAttributes);
  }
  return attributes;
}

/**
 * @param {string} svg
 * @returns {{openTagStart: number, openTagEnd: number, attributesText: string, attributes: {[name: string]: string}}}
 */
function parseSvgOpenTag(svg) {
  const svgStart = svg.indexOf("<svg");
  if (svgStart === -1) throw new Error("Missing <svg> root");
  const openTagEnd = svg.indexOf(">", svgStart);
  if (openTagEnd === -1) throw new Error("Unterminated <svg> root");
  const attributesText = svg.slice(svgStart + 4, openTagEnd);
  return {
    openTagStart: svgStart,
    openTagEnd,
    attributesText,
    attributes: parseAttributes(attributesText),
  };
}

/**
 * @param {string} svg
 * @param {number} fromIndex
 * @returns {{openTagStart: number, openTagEnd: number, contentStart: number, contentEnd: number}}
 */
function findDrawingAreaBounds(svg, fromIndex = 0) {
  const tagPattern = /<(\/?)g\b([^>]*)>/g;
  tagPattern.lastIndex = fromIndex;
  let match = tagPattern.exec(svg);
  while (match) {
    const isClosing = match[1] === "/";
    const tagStart = match.index;
    const tagEnd = tagPattern.lastIndex;
    if (!isClosing) {
      const attributes = parseAttributes(match[2] || "");
      if (attributes.id === "drawingArea") {
        let depth = 1;
        let innerMatch = tagPattern.exec(svg);
        while (innerMatch) {
          if (innerMatch[1] === "/") {
            depth -= 1;
          } else {
            depth += 1;
          }
          if (depth === 0) {
            return {
              openTagStart: tagStart,
              openTagEnd: tagEnd,
              contentStart: tagEnd,
              contentEnd: innerMatch.index,
            };
          }
          innerMatch = tagPattern.exec(svg);
        }
        throw new Error("Unterminated drawingArea group");
      }
    }
    match = tagPattern.exec(svg);
  }
  throw new Error("Missing drawingArea group");
}

/**
 * @param {string} svg
 * @returns {{
 *   prefix: string,
 *   drawingAreaContent: string,
 *   suffix: string,
 *   rootAttributes: {[name: string]: string},
 * }}
 */
function parseStoredSvgEnvelope(svg) {
  const root = parseSvgOpenTag(svg);
  const drawingArea = findDrawingAreaBounds(svg, root.openTagEnd);
  return {
    prefix: svg.slice(0, drawingArea.contentStart),
    drawingAreaContent: svg.slice(
      drawingArea.contentStart,
      drawingArea.contentEnd,
    ),
    suffix: svg.slice(drawingArea.contentEnd),
    rootAttributes: root.attributes,
  };
}

/**
 * @param {string} drawingAreaContent
 * @returns {Array<{raw: string, attributes: {[name: string]: string}}>}
 */
function parseStoredSvgItems(drawingAreaContent) {
  /** @type {Array<{raw: string, attributes: {[name: string]: string}}>} */
  const items = [];
  const itemPattern = /<g\b([^>]*)><\/g>/g;
  let match = itemPattern.exec(drawingAreaContent);
  while (match) {
    const raw = match[0];
    const attributes = parseAttributes(match[1] || "");
    if (attributes["data-wbo-item"]) {
      items.push({ raw, attributes });
    }
    match = itemPattern.exec(drawingAreaContent);
  }
  return items;
}

/**
 * @param {string} prefix
 * @param {{readonly: boolean}} metadata
 * @param {number} seq
 * @returns {string}
 */
function updateRootMetadata(prefix, metadata, seq) {
  const root = parseSvgOpenTag(prefix);
  let openTag = prefix.slice(root.openTagStart, root.openTagEnd + 1);
  const nextAttributes = {
    ...root.attributes,
    "data-wbo-format": STORED_SVG_FORMAT,
    "data-wbo-seq": String(seq),
    "data-wbo-readonly": metadata.readonly ? "true" : "false",
  };
  Object.entries(nextAttributes).forEach(([name, value]) => {
    const attributePattern = new RegExp(`\\s${name}="[^"]*"`);
    const encoded = ` ${name}="${escapeHtml(value)}"`;
    if (attributePattern.test(openTag)) {
      openTag = openTag.replace(attributePattern, encoded);
    } else {
      openTag = `${openTag.slice(0, -1)}${encoded}>`;
    }
  });
  return `${prefix.slice(0, root.openTagStart)}${openTag}${prefix.slice(root.openTagEnd + 1)}`;
}

/**
 * @param {string[]} itemTags
 * @returns {string}
 */
function joinStoredSvgItems(itemTags) {
  return itemTags.join("");
}

/**
 * @param {string} prefix
 * @param {string[]} itemTags
 * @param {string} suffix
 * @returns {string}
 */
function serializeStoredSvgEnvelope(prefix, itemTags, suffix) {
  return `${prefix}${joinStoredSvgItems(itemTags)}${suffix}`;
}

/**
 * @param {{readonly: boolean}} metadata
 * @param {number} seq
 * @returns {{prefix: string, suffix: string}}
 */
function createDefaultStoredSvgEnvelope(metadata, seq) {
  return {
    prefix:
      `<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
      `width="500" height="500" data-wbo-format="${STORED_SVG_FORMAT}" ` +
      `data-wbo-seq="${seq}" data-wbo-readonly="${metadata.readonly ? "true" : "false"}">` +
      `<defs id="defs"></defs><g id="drawingArea">`,
    suffix: `</g><g id="cursors"></g></svg>`,
  };
}

export {
  STORED_SVG_FORMAT,
  createDefaultStoredSvgEnvelope,
  parseAttributes,
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
  serializeStoredSvgEnvelope,
  updateRootMetadata,
};
