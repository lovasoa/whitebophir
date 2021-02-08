const fs = require("./fs_promises.js"),
  path = require("path"),
  wboPencilPoint = require("../client-data/tools/pencil/wbo_pencil_point.js")
    .wboPencilPoint;

function htmlspecialchars(str) {
  if (typeof str !== "string") return "";

  return str.replace(/[<>&"']/g, function (c) {
    switch (c) {
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
    }
  });
}

function renderPath(el, pathstring) {
  return (
    "<path " +
    (el.id ? 'id="' + htmlspecialchars(el.id) + '" ' : "") +
    'stroke-width="' +
    (el.size | 0) +
    '" ' +
    (el.opacity ? 'opacity="' + parseFloat(el.opacity) + '" ' : "") +
    'stroke="' +
    htmlspecialchars(el.color) +
    '" ' +
    'd="' +
    pathstring +
    '" ' +
    (el.deltax || el.deltay
      ? 'transform="translate(' + +el.deltax + "," + +el.deltay + ')"'
      : "") +
    "/>"
  );
}

const Tools = {
  /**
   * @return {string}
   */
  Text: function (el) {
    return (
      "<text " +
      'id="' +
      htmlspecialchars(el.id || "t") +
      '" ' +
      'x="' +
      (el.x | 0) +
      '" ' +
      'y="' +
      (el.y | 0) +
      '" ' +
      'font-size="' +
      (el.size | 0) +
      '" ' +
      'fill="' +
      htmlspecialchars(el.color || "#000") +
      '" ' +
      (el.deltax || el.deltay
        ? 'transform="translate(' +
          (el.deltax || 0) +
          "," +
          (el.deltay || 0) +
          ')"'
        : "") +
      ">" +
      htmlspecialchars(el.txt || "") +
      "</text>"
    );
  },
  /**
   * @return {string}
   */
  Pencil: function (el) {
    if (!el._children) return "";
    let pts = el._children.reduce(function (pts, point) {
      return wboPencilPoint(pts, point.x, point.y);
    }, []);
    const pathstring = pts
      .map(function (op) {
        return op.type + " " + op.values.join(" ");
      })
      .join(" ");
    return renderPath(el, pathstring);
  },
  /**
   * @return {string}
   */
  Rectangle: function (el) {
    return (
      "<rect " +
      (el.id ? 'id="' + htmlspecialchars(el.id) + '" ' : "") +
      'x="' +
      (el.x || 0) +
      '" ' +
      'y="' +
      (el.y || 0) +
      '" ' +
      'width="' +
      (el.x2 - el.x) +
      '" ' +
      'height="' +
      (el.y2 - el.y) +
      '" ' +
      'stroke="' +
      htmlspecialchars(el.color) +
      '" ' +
      'stroke-width="' +
      (el.size | 0) +
      '" ' +
      (el.deltax || el.deltay
        ? 'transform="translate(' +
          (el.deltax || 0) +
          "," +
          (el.deltay || 0) +
          ')"'
        : "") +
      "/>"
    );
  },
  /**
   * @return {string}
   */
  Ellipse: function (el) {
    const cx = Math.round((el.x2 + el.x) / 2);
    const cy = Math.round((el.y2 + el.y) / 2);
    const rx = Math.abs(el.x2 - el.x) / 2;
    const ry = Math.abs(el.y2 - el.y) / 2;
    const pathstring =
      "M" +
      (cx - rx) +
      " " +
      cy +
      "a" +
      rx +
      "," +
      ry +
      " 0 1,0 " +
      rx * 2 +
      ",0" +
      "a" +
      rx +
      "," +
      ry +
      " 0 1,0 " +
      rx * -2 +
      ",0";
    return renderPath(el, pathstring);
  },
  /**
   * @return {string}
   */
  "Straight line": function (el) {
    const pathstring = "M" + el.x + " " + el.y + "L" + el.x2 + " " + el.y2;
    return renderPath(el, pathstring);
  },
};

/**
 * Writes the given board as an svg to the given writeable stream
 * @param {Object[string, BoardElem]} obj
 * @param {WritableStream} writeable
 */
async function toSVG(obj, writeable) {
  const margin = 400;
  const elems = Object.values(obj);
  const dim = elems.reduce(
    function (dim, elem) {
      if (elem._children && elem._children.length) elem = elem._children[0];
      return [
        Math.max((elem.x + margin + (elem.deltax | 0)) | 0, dim[0]),
        Math.max((elem.y + margin + (elem.deltay | 0)) | 0, dim[1]),
      ];
    },
    [margin, margin]
  );
  writeable.write(
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
      'width="' +
      dim[0] +
      '" height="' +
      dim[1] +
      '">' +
      '<defs><style type="text/css"><![CDATA[' +
      'text {font-family:"Arial"}' +
      "path {fill:none;stroke-linecap:round;stroke-linejoin:round;}" +
      "rect {fill:none}" +
      "]]></style></defs>"
  );
  await Promise.all(
    elems.map(async function (elem) {
      await Promise.resolve(); // Do not block the event loop
      const renderFun = Tools[elem.tool];
      if (renderFun) writeable.write(renderFun(elem));
      else console.warn("Missing render function for tool", elem.tool);
    })
  );
  writeable.write("</svg>");
}

async function renderBoard(file, stream) {
  const data = await fs.promises.readFile(file);
  var board = JSON.parse(data);
  return toSVG(board, stream);
}

if (require.main === module) {
  const config = require("./configuration.js");
  const HISTORY_FILE =
    process.argv[2] || path.join(config.HISTORY_DIR, "board-anonymous.json");

  renderBoard(HISTORY_FILE, process.stdout).catch(console.error.bind(console));
} else {
  module.exports = { renderBoard: renderBoard };
}
