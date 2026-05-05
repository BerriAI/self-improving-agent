/**
 * Resolve configuration with env-var fallbacks.
 *
 * Recognized vars:
 *   SELF_IMPROVING_AGENT_REPO            "owner/name" of the GitHub repo
 *                                        whose code/prompts the agent can PR
 *   SELF_IMPROVING_AGENT_GITHUB_TOKEN    PAT with contents:write +
 *                                        pull_requests:write on that repo
 *   SELF_IMPROVING_AGENT_PROPOSALS_DIR   where proposal JSON files are saved
 *                                        (default: ./runs/improvements)
 *   SELF_IMPROVING_AGENT_CACHE_DIR       where the lib clones the repo
 *                                        (default: ~/.cache/self-improving-agent/<owner>__<name>)
 *   SELF_IMPROVING_AGENT_BASE_BRANCH     base branch for PRs (default: main)
 */

import os from "node:os";
import path from "node:path";

export interface RepoRef {
  owner: string;
  name: string;
}

export interface ResolvedConfig {
  repo: RepoRef;
  /** May be empty during partial resolution (e.g. building tool descriptions). */
  token: string;
  cacheDir: string;
  proposalsDir: string;
  baseBranch: string;
}

export interface PartialConfigOpts {
  repo?: string | RepoRef;
  token?: string;
  cacheDir?: string;
  proposalsDir?: string;
  baseBranch?: string;
}

export interface ResolveOpts extends PartialConfigOpts {
  /**
   * If true, return placeholders instead of throwing when required vars
   * are missing. Used at construction time to bake whatever we know into
   * the tool description without crashing on import.
   */
  lenient?: boolean;
}

function parseRepo(input: string): RepoRef {
  const m = input.trim().match(/^([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) {
    throw new Error(
      `SELF_IMPROVING_AGENT_REPO must be "owner/name" (got: ${JSON.stringify(input)})`
    );
  }
  return { owner: m[1]!, name: m[2]! };
}

function defaultCacheDir(repo: RepoRef): string {
  const xdgCache =
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(
    xdgCache,
    "self-improving-agent",
    `${repo.owner}__${repo.name}`
  );
}

let warnedAboutMissingRepo = false;

/**
 * Resolve the runtime config. Throws on missing required vars unless
 * `lenient: true` is passed (in which case missing fields come back as
 * empty strings / a placeholder repo and the warning fires once).
 */
export function resolveConfig(opts: ResolveOpts = {}): ResolvedConfig {
  const repoInput = opts.repo ?? process.env.SELF_IMPROVING_AGENT_REPO;
  let repo: RepoRef;
  if (!repoInput) {
    if (!opts.lenient) {
      throw new Error(
        "SELF_IMPROVING_AGENT_REPO is required (e.g. 'BerriAI/shin-builder-oss')."
      );
    }
    if (!warnedAboutMissingRepo) {
      warnedAboutMissingRepo = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[self-improving-agent] SELF_IMPROVING_AGENT_REPO is not set. " +
          "Tools will fail when called. Set it to 'owner/name' of the GitHub " +
          "repo the agent should propose PRs against."
      );
    }
    repo = { owner: "OWNER", name: "REPO" };
  } else if (typeof repoInput === "string") {
    repo = parseRepo(repoInput);
  } else {
    repo = repoInput;
  }

  const token = opts.token ?? process.env.SELF_IMPROVING_AGENT_GITHUB_TOKEN ?? "";
  if (!token && !opts.lenient) {
    throw new Error(
      "SELF_IMPROVING_AGENT_GITHUB_TOKEN is required. Use a fine-grained PAT " +
        "with 'contents: write' and 'pull requests: write' on the repo."
    );
  }

  const cacheDir =
    opts.cacheDir ??
    process.env.SELF_IMPROVING_AGENT_CACHE_DIR ??
    defaultCacheDir(repo);

  const proposalsDir =
    opts.proposalsDir ??
    process.env.SELF_IMPROVING_AGENT_PROPOSALS_DIR ??
    "./runs/improvements";

  const baseBranch =
    opts.baseBranch ?? process.env.SELF_IMPROVING_AGENT_BASE_BRANCH ?? "main";

  return { repo, token, cacheDir, proposalsDir, baseBranch };
}
