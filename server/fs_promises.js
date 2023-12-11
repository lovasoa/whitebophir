const fs = require("fs");

if (typeof fs.promises === "undefined") {
  console.warn("Using an old node version without fs.promises");

  const util = require("util");
  fs.promises = {};
  Object.entries(fs)
    .filter(([_, v]) => typeof v === "function")
    .forEach(([k, v]) => (fs.promises[k] = util.promisify(v)));
}

module.exports = fs;
