import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

test("release hook requires the tag to match the package version", {
  skip: process.platform === "win32",
}, () => {
  /** @param {string} tag */
  const run = (tag) =>
    spawnSync("sh", ["bin/ci-pre-deploy"], {
      env: { ...process.env, GITHUB_REF_NAME: tag },
      encoding: "utf8",
    });
  assert.equal(run(`v${packageJson.version}`).status, 0);
  assert.notEqual(run("v0.0.0").status, 0);
  assert.notEqual(run("").status, 0);
});
