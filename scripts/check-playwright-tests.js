const fs = require("node:fs");
const path = require("node:path");

const testDir = path.join(__dirname, "..", "playwright", "tests");
const forbiddenPattern = /waitForTimeout\(|\bsleep\(|\bpause\(/;
const allowedExtensions = new Set([".js", ".cjs", ".mjs", ".ts"]);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (
      entry.isFile() &&
      allowedExtensions.has(path.extname(entry.name))
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function findMatches(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const matches = [];
  const relativeFilePath = path.relative(process.cwd(), filePath);

  for (const [index, line] of lines.entries()) {
    if (forbiddenPattern.test(line)) {
      matches.push(`${relativeFilePath}:${index + 1}:${line}`);
    }
  }

  return matches;
}

const matches = walk(testDir).flatMap(findMatches);

if (matches.length > 0) {
  process.stderr.write(`${matches.join("\n")}\n`);
  process.stderr.write(
    "Forbidden fixed-delay helper found in Playwright test files. Use web-first waits or expect.poll instead.\n",
  );
  process.exit(1);
}
