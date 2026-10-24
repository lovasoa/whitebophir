import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareRelease } from "../.github/scripts/prepare-release.mjs";
import packageJson from "../package.json" with { type: "json" };

test("release hook requires the tag to match the package version", {
  skip: process.platform === "win32",
}, () => {
  /** @param {string} tag */
  const run = (tag) =>
    spawnSync("sh", ["bin/ci-pre-deploy"], {
      env: { ...process.env, RELEASE_TAG: tag },
      encoding: "utf8",
    });
  assert.equal(run(`v${packageJson.version}`).status, 0);
  assert.notEqual(run("v0.0.0").status, 0);
  assert.notEqual(run("").status, 0);
});

test("automatic releases version the tested snapshot and reuse tags on retry", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "wbo-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  /** @param {...string} args */
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "--initial-branch=master");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.com");
  const pkg = { name: "release-test", version: "1.2.3" };
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify(pkg));
  writeFileSync(
    path.join(cwd, "package-lock.json"),
    JSON.stringify({
      ...pkg,
      lockfileVersion: 3,
      packages: { "": pkg },
    }),
  );
  git("add", ".");
  git("commit", "-m", "Tested source");
  const source = git("rev-parse", "HEAD");
  git("tag", "v1.2.9");
  git("tag", "v1.3.0-beta.1");

  const release = prepareRelease(cwd);
  assert.equal(release.tag, "v1.2.10");
  assert.equal(git("rev-parse", `${release.tag}^`), source);
  assert.equal(git("rev-parse", "master"), source);
  assert.equal(
    git("diff", "--name-only", source, release.sha),
    "package-lock.json\npackage.json",
  );
  const lock = JSON.parse(
    readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
  );
  assert.equal(lock.version, "1.2.10");
  assert.equal(lock.packages[""].version, "1.2.10");

  git("checkout", "--detach", source);
  assert.deepEqual(prepareRelease(cwd), release);
  git("checkout", "master");
  git("commit", "--allow-empty", "-m", "Next tested source");
  const next = prepareRelease(cwd);
  assert.equal(next.tag, "v1.2.11");
});
