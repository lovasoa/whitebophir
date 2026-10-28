/** @param {{github: any, context: any}} options */
module.exports = async function mergeDependabot({ github, context }) {
  const run = context.payload.workflow_run;
  const { owner, repo } = context.repo;
  const repository = `${owner}/${repo}`;
  if (
    run.conclusion !== "success" ||
    run.event !== "pull_request" ||
    run.head_repository?.full_name !== repository ||
    run.actor?.login !== "dependabot[bot]"
  )
    return;

  const { data: pulls } = await github.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${run.head_branch}`,
    base: "master",
    state: "all",
  });
  const pull = pulls.find(
    /** @param {any} candidate */
    (candidate) =>
      candidate.user?.login === "dependabot[bot]" &&
      candidate.head.repo?.full_name === repository &&
      candidate.head.sha === run.head_sha &&
      (candidate.state === "open" || candidate.merged_at) &&
      !candidate.draft,
  );
  if (!pull) return;

  if (!pull.merged_at) {
    const { data: result } = await github.rest.pulls.merge({
      owner,
      repo,
      pull_number: pull.number,
      sha: run.head_sha,
      merge_method: "squash",
    });
    if (!result.merged) throw new Error("Dependency update was not merged");
  }

  // Token-authored merges do not trigger push workflows.
  await github.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: "CI.yml",
    ref: "master",
  });
};
