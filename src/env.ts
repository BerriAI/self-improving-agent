/**
 * Resolve configuration with env-var fallbacks.
 *
 * Recognized vars:
 *   SELF_IMPROVING_AGENT_REPO_ROOT       absolute path to git working tree
 *   SELF_IMPROVING_AGENT_PROPOSALS_DIR   where proposal JSON files are saved
 */

export interface ResolvedConfig {
  repoRoot: string;
  proposalsDir: string;
}

let warnedAboutMissingRepoRoot = false;

export function resolveConfig(opts?: Partial<ResolvedConfig>): ResolvedConfig {
  const explicitRepoRoot =
    opts?.repoRoot ?? process.env.SELF_IMPROVING_AGENT_REPO_ROOT;

  if (!explicitRepoRoot && !warnedAboutMissingRepoRoot) {
    warnedAboutMissingRepoRoot = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[self-improving-agent] SELF_IMPROVING_AGENT_REPO_ROOT is not set. " +
        "Falling back to process.cwd() — but the agent won't be told where its " +
        "own source lives. Set the env var to the absolute path of the repo " +
        "whose prompts/code the agent should propose diffs for."
    );
  }

  const repoRoot = explicitRepoRoot ?? process.cwd();

  const proposalsDir =
    opts?.proposalsDir ??
    process.env.SELF_IMPROVING_AGENT_PROPOSALS_DIR ??
    "./runs/improvements";

  return { repoRoot, proposalsDir };
}
