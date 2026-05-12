import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightCli = path.join(root, "node_modules", "playwright", "cli.js");

/**
 * @param {string | undefined} value
 * @param {string} option
 * @returns {string}
 */
function appendNodeOption(value, option) {
  if (!value) return option;
  return value.split(/\s+/).includes(option) ? value : `${value} ${option}`;
}

const env = { ...process.env };
delete env.NO_COLOR;
env.NODE_OPTIONS = appendNodeOption(
  env.NODE_OPTIONS,
  "--disable-warning=DEP0205",
);

const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
