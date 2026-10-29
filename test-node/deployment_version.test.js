import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import packageJson from "../package.json" with { type: "json" };

test("release preparation accepts only upstream master CI or validated upstream tags", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  const condition = workflow
    .match(/^ {2}prepare:\n[\s\S]*?^ {4}if: >-\n((?: {6}.*\n)+)/m)?.[1]
    ?.replace(/needs\.validate-tag/g, "needs['validate-tag']");
  assert.ok(condition, "release preparation must have a job condition");
  /** @param {any} [overrides] */
  const eligible = (overrides = {}) =>
    // Apart from the hyphenated job name, the condition is JavaScript-compatible.
    runInNewContext(condition, {
      cancelled: () => overrides.cancelled ?? false,
      needs: { "validate-tag": { result: overrides.tagResult ?? "skipped" } },
      github: {
        repository: overrides.repository ?? "lovasoa/whitebophir",
        event: {
          workflow_run: {
            conclusion: "success",
            event: "push",
            head_repository: { full_name: "lovasoa/whitebophir" },
            head_branch: "master",
            ...overrides.run,
          },
        },
      },
    });
  assert.equal(eligible(), true);
  assert.equal(eligible({ run: { event: "workflow_dispatch" } }), true);
  assert.equal(
    eligible({ tagResult: "success", run: { conclusion: "" } }),
    true,
  );
  for (const overrides of [
    { repository: "contributor/whitebophir", tagResult: "success" },
    {
      repository: "contributor/whitebophir",
      run: { head_repository: { full_name: "contributor/whitebophir" } },
    },
    { run: { event: "pull_request" } },
    { run: { head_repository: { full_name: "contributor/whitebophir" } } },
    { run: { head_branch: "feature" } },
    { run: { conclusion: "failure" } },
    { run: { conclusion: "cancelled" } },
    { tagResult: "failure", run: { conclusion: "" } },
    { cancelled: true },
    { cancelled: true, tagResult: "success" },
  ]) {
    assert.equal(eligible(overrides), false, JSON.stringify(overrides));
  }
});

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

test("automatic releases reject fork and missing repository identities before writing", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wbo-release-rejected-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, "output");
  const script = path.resolve("bin/prepare-release");
  for (const repository of [
    "contributor/whitebophir",
    "lovasoa/other",
    "",
    undefined,
  ]) {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, GITHUB_OUTPUT: output };
    delete env.GITHUB_REPOSITORY;
    if (repository !== undefined) env.GITHUB_REPOSITORY = repository;
    // No Git checkout: rejection must happen before fetching or mutating a repo.
    const result = spawnSync("sh", [script, "tested-head"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Refusing to release outside lovasoa\/whitebophir/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }
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
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: "lovasoa/whitebophir",
      },
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
