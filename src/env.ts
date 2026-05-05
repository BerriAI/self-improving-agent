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

export function resolveConfig(opts?: Partial<ResolvedConfig>): ResolvedConfig {
  const repoRoot =
    opts?.repoRoot ??
    process.env.SELF_IMPROVING_AGENT_REPO_ROOT ??
    process.cwd();

  const proposalsDir =
    opts?.proposalsDir ??
    process.env.SELF_IMPROVING_AGENT_PROPOSALS_DIR ??
    "./runs/improvements";

  return { repoRoot, proposalsDir };
}
