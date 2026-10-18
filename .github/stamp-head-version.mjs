import fs from "node:fs";

// Deployment SDK configuration lives outside the vendor-neutral application.
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || ""))
  throw new Error("Expected a release patch version");
const path = process.env.WBO_HTML_HEAD_SNIPPET_PATH;
if (path) {
  const source = fs.readFileSync(path, "utf8");
  const pattern = /\bversion\s*:\s*(["'])([^"']+)\1/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1)
    throw new Error("Expected exactly one deployment SDK version");
  if (matches[0][2] !== version) {
    const backup = `${path}.before-v${version}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(path, backup);
    const updated = source.replace(pattern, `version: "${version}"`);
    const temporary = `${path}.next-v${version}`;
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(path).mode });
    fs.renameSync(temporary, path);
  }
}
console.log(`Deployment head ready: ${version}`);
