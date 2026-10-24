import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {string} cwd */
export function prepareRelease(cwd) {
  /** @param {...string} args */
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const source = git("rev-parse", "HEAD");
  const tags = git("tag", "--list", "v*", "--sort=-version:refname")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));

  // A retry must reuse the tagged version commit, even after a partial deploy.
  for (const tag of tags) {
    const [sha, parents, subject] = git(
      "show",
      "--no-patch",
      "--format=%H%n%P%n%s",
      `${tag}^{commit}`,
    ).split("\n");
    if (sha && parents === source && subject === `Release ${tag}`) {
      return { tag, sha };
    }
  }

  /** @type {{ version: string }} */
  const { version } = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Expected a stable package version, got ${version}`);
  }
  const versions = [version, ...tags.map((tag) => tag.slice(1))];
  versions.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const latest = versions.pop() ?? version;
  const tag = `v${latest.replace(/\d+$/, (patch) => String(Number(patch) + 1))}`;
  git("checkout", "--detach", source);
  execFileSync(
    "npm",
    ["version", tag.slice(1), "--no-git-tag-version", "--ignore-scripts"],
    { cwd, stdio: "inherit" },
  );
  git("add", "package.json", "package-lock.json");
  git(
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    `Release ${tag}`,
  );
  git("tag", tag);
  return { tag, sha: git("rev-parse", "HEAD") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  const { tag, sha } = prepareRelease(process.cwd());
  appendFileSync(output, `tag=${tag}\nsha=${sha}\n`);
}
