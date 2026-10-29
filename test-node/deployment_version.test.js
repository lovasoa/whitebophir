import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

test("release hook requires the tag to match the package version", {
  skip: process.platform === "win32",
}, () => {
  /** @param {string} tag @param {string} [branch] */
  const run = (tag, branch = "") =>
    spawnSync("sh", ["bin/ci-pre-deploy"], {
      env: { ...process.env, GITHUB_REF_NAME: tag, CI_BRANCH_NAME: branch },
      encoding: "utf8",
    });
  assert.equal(run(`v${packageJson.version}`).status, 0);
  assert.notEqual(run("v0.0.0").status, 0);
  assert.notEqual(run("").status, 0);
  assert.equal(run("master", `v${packageJson.version}`).status, 0);
  assert.notEqual(run(`v${packageJson.version}`, "v0.0.0").status, 0);
});

// Local repositories exercise the real version/tag push without publishing.
test("automatic releases bump both manifests and skip stale CI", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wbo-release-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const checkout = path.join(root, "checkout");
  const output = path.join(root, "output");
  const script = path.resolve("bin/prepare-release");
  /** @param {string} command @param {string[]} args @param {string} [cwd] */
  const run = (command, args, cwd = checkout) => {
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  run("git", ["init", "--bare", "--initial-branch=master", remote], root);
  run("git", ["clone", remote, checkout], root);
  run("git", ["config", "user.name", "Release test"]);
  run("git", ["config", "user.email", "release@example.invalid"]);
  await fs.writeFile(
    path.join(checkout, "package.json"),
    JSON.stringify({
      name: "release-test",
      version: "1.0.0",
    }),
  );
  await fs.writeFile(
    path.join(checkout, "package-lock.json"),
    JSON.stringify({
      name: "release-test",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: { "": { name: "release-test", version: "1.0.0" } },
    }),
  );
  run("git", ["add", "."]);
  run("git", ["-c", "core.hooksPath=/dev/null", "commit", "-m", "Initial"]);
  run("git", ["push", "origin", "master"]);
  const tested = run("git", ["rev-parse", "HEAD"]);
  run("sh", [script, tested]);
  assert.equal(await fs.readFile(output, "utf8"), "tag=v1.0.1\n");
  for (const file of ["package.json", "package-lock.json"]) {
    const data = JSON.parse(
      await fs.readFile(path.join(checkout, file), "utf8"),
    );
    assert.equal(data.version, "1.0.1");
    if (file === "package-lock.json")
      assert.equal(data.packages[""].version, "1.0.1");
  }
  const released = run("git", ["rev-parse", "HEAD"]);
  assert.equal(run("git", ["rev-parse", "origin/master"]), released);
  assert.equal(run("git", ["rev-parse", "v1.0.1"]), released);
  assert.equal(run("git", ["rev-parse", "HEAD^"]), tested);

  // Re-running an old CI result must not create another version or tag.
  await fs.writeFile(output, "");
  run("git", ["checkout", "--detach", tested]);
  run("sh", [script, tested]);
  assert.equal(await fs.readFile(output, "utf8"), "");
  assert.equal(run("git", ["tag"]), "v1.0.1");
  assert.equal(run("git", ["rev-parse", "origin/master"]), released);
});
