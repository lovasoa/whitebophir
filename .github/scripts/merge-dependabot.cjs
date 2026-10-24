/** @param {{ github: any, context: any, core: any }} options */
module.exports = async ({ github, context, core }) => {
  const run = context.payload.workflow_run;
  const repo = context.repo;
  const repository = `${repo.owner}/${repo.repo}`;
  if (
    run.event !== "pull_request" ||
    run.conclusion !== "success" ||
    run.head_repository?.full_name !== repository
  )
    return;

  for (const candidate of run.pull_requests) {
    const { data: pr } = await github.rest.pulls.get({
      ...repo,
      pull_number: candidate.number,
    });
    if (
      (pr.state !== "open" && !pr.merged) ||
      pr.draft ||
      pr.user.login !== "dependabot[bot]" ||
      pr.user.type !== "Bot" ||
      pr.base.ref !== "master" ||
      pr.base.repo.full_name !== repository ||
      pr.head.repo?.full_name !== repository ||
      pr.head.sha !== run.head_sha
    )
      continue;

    /** @type {any[]} */
    const commits = await github.paginate(github.rest.pulls.listCommits, {
      ...repo,
      pull_number: pr.number,
      per_page: 100,
    });
    if (
      !commits.length ||
      commits.length !== pr.commits ||
      commits.some(
        (commit) =>
          commit.author?.login !== "dependabot[bot]" ||
          !commit.commit.verification?.verified,
      )
    ) {
      core.warning(
        `PR #${pr.number} contains commits not verified as Dependabot.`,
      );
      continue;
    }

    // The SHA precondition rejects a push racing with signature verification.
    if (!pr.merged) {
      const { data: result } = await github.rest.pulls.merge({
        ...repo,
        pull_number: pr.number,
        sha: run.head_sha,
        merge_method: "merge",
      });
      if (!result.merged) throw new Error(result.message);
    }

    // GITHUB_TOKEN merges emit no push workflow; explicitly test and release master.
    await github.rest.actions.createWorkflowDispatch({
      ...repo,
      workflow_id: "CI.yml",
      ref: "master",
    });
    core.info(`Merged verified Dependabot PR #${pr.number}.`);
  }
};
