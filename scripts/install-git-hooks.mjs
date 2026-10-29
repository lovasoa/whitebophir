import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const hooksPath = ".githooks";

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "--local", "core.hooksPath", hooksPath], {
    cwd: repoRoot,
    stdio: "ignore",
  });
} catch {
  // Ignore non-git installs, such as tarball packaging.
}
