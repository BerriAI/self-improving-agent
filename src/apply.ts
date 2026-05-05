import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Proposal } from "./proposal.js";
import type { RepoRef } from "./env.js";

export interface ApplyResult {
  branch: string;
  prUrl: string;
  commitSha: string;
}

export interface ApplyOptions {
  repo: RepoRef;
  /** PAT used to clone, push, and open the PR. */
  token: string;
  /** Where the lib keeps a working clone of the repo. */
  cacheDir: string;
  /** Base branch for the PR. Default: "main". */
  baseBranch?: string;
  /** Branch name prefix. Default: "improvement". */
  branchPrefix?: string;
  /** PR title. Default: "Self-improve: <file>". */
  prTitle?: string;
  /** PR body. Default: an auto-generated diff summary. */
  prBody?: string;
  /** Open the PR as a draft. Default: true. */
  draft?: boolean;
  /** Custom commit message. Default: derived from `proposal.reason`. */
  commitMessage?: string;
  /** Override the GitHub API base. Default: https://api.github.com. */
  apiBase?: string;
}

function execGit(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Run a git command with one-shot HTTP auth. Uses HTTP Basic with the
 * `x-access-token` username convention so it works for both classic and
 * fine-grained PATs. The token rides in argv for the lifetime of the
 * call only — never persisted to `.git/config`.
 */
function execGitWithAuth(args: string[], token: string, cwd?: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString(
    "base64"
  );
  return execGit(
    ["-c", `http.extraheader=AUTHORIZATION: Basic ${basic}`, ...args],
    cwd
  );
}

/**
 * Ensure the cache clone exists and is on a clean copy of `baseBranch`.
 * Idempotent: clones if missing, otherwise fetches + resets to origin.
 */
export function ensureClone(opts: {
  repo: RepoRef;
  token: string;
  cacheDir: string;
  baseBranch: string;
}): void {
  const remoteUrl = `https://github.com/${opts.repo.owner}/${opts.repo.name}.git`;

  if (!fs.existsSync(path.join(opts.cacheDir, ".git"))) {
    fs.mkdirSync(path.dirname(opts.cacheDir), { recursive: true });
    execGitWithAuth(
      ["clone", "--depth", "50", remoteUrl, opts.cacheDir],
      opts.token
    );
    return;
  }

  // Refresh existing clone. Discard any leftover branch/commits from prior runs.
  execGitWithAuth(["fetch", "--prune", "origin"], opts.token, opts.cacheDir);
  // If a previous run left us on a feature branch, hop back to base.
  try {
    execGit(["checkout", opts.baseBranch], opts.cacheDir);
  } catch {
    execGit(
      ["checkout", "-B", opts.baseBranch, `origin/${opts.baseBranch}`],
      opts.cacheDir
    );
  }
  execGit(
    ["reset", "--hard", `origin/${opts.baseBranch}`],
    opts.cacheDir
  );
  // Prune any local feature branches from prior applies.
  const branches = execGit(["branch", "--list"], opts.cacheDir)
    .split("\n")
    .map((b) => b.replace(/^[* ]+/, "").trim())
    .filter((b) => b && b !== opts.baseBranch);
  for (const b of branches) {
    try {
      execGit(["branch", "-D", b], opts.cacheDir);
    } catch {
      // ignore
    }
  }
}

interface CreatePrInput {
  repo: RepoRef;
  token: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft: boolean;
  apiBase: string;
}

async function createPullRequest(input: CreatePrInput): Promise<string> {
  const url = `${input.apiBase}/repos/${input.repo.owner}/${input.repo.name}/pulls`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.branch,
      base: input.baseBranch,
      draft: input.draft,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub API failed creating PR: ${res.status} ${res.statusText} — ${text}`
    );
  }
  const data = (await res.json()) as { html_url?: string };
  if (!data.html_url) {
    throw new Error(`GitHub API returned no html_url: ${JSON.stringify(data)}`);
  }
  return data.html_url;
}

/**
 * Apply a proposal end-to-end against the GitHub repo:
 *   1. Ensure the cache clone is fresh on `baseBranch`.
 *   2. Create a feature branch, replace the snippet exactly once, commit.
 *   3. Push the branch using the token (no token persisted to disk).
 *   4. Open a PR via the GitHub REST API.
 *
 * Throws if:
 *  - target file is missing in the repo
 *  - `originalSnippet` does not appear exactly once in that file
 *  - git push or the GitHub API rejects the call (bad token, permissions, etc.)
 *
 * The caller is responsible for any "did the user actually approve this?"
 * check before invoking — this function does not validate intent.
 */
export async function applyProposal(
  proposal: Proposal,
  opts: ApplyOptions
): Promise<ApplyResult> {
  const baseBranch = opts.baseBranch ?? "main";
  ensureClone({
    repo: opts.repo,
    token: opts.token,
    cacheDir: opts.cacheDir,
    baseBranch,
  });

  const root = path.resolve(opts.cacheDir);
  const absFile = path.resolve(root, proposal.file);
  if (!absFile.startsWith(root + path.sep) && absFile !== root) {
    throw new Error(`Invalid file path: ${proposal.file}`);
  }
  if (!fs.existsSync(absFile)) {
    throw new Error(`File not found in ${opts.repo.owner}/${opts.repo.name}: ${proposal.file}`);
  }

  let content = fs.readFileSync(absFile, "utf-8");
  const occurrences = content.split(proposal.originalSnippet).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `originalSnippet must appear exactly once in ${proposal.file}, found ${occurrences}`
    );
  }

  const slug =
    proposal.file
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "edit";
  const prefix = opts.branchPrefix ?? "improvement";
  const branch = `${prefix}/${slug}-${Date.now()}`;
  execGit(["checkout", "-b", branch], root);

  content = content.replace(proposal.originalSnippet, proposal.proposedSnippet);
  fs.writeFileSync(absFile, content, "utf-8");

  execGit(["add", "--", proposal.file], root);

  const reasonLine =
    proposal.reason.split("\n")[0]!.trim().slice(0, 200) || "self-improvement";
  const commitMessage =
    opts.commitMessage ??
    `chore: self-improve — ${proposal.file} — ${reasonLine}`;
  execGit(
    [
      "-c",
      "user.name=self-improving-agent",
      "-c",
      "user.email=self-improving-agent@users.noreply.github.com",
      "commit",
      "-m",
      commitMessage,
    ],
    root
  );
  const commitSha = execGit(["rev-parse", "HEAD"], root).trim();

  execGitWithAuth(
    ["push", "--set-upstream", "origin", branch],
    opts.token,
    root
  );

  const title = opts.prTitle ?? `Self-improve: ${proposal.file}`;
  const body =
    opts.prBody ??
    [
      "Automated proposal from `self-improving-agent`.",
      "",
      `**Risk:** ${proposal.risk}`,
      "",
      "**Reason:**",
      proposal.reason,
      "",
      "**Original (excerpt):**",
      "```",
      proposal.originalSnippet.length > 2_000
        ? proposal.originalSnippet.slice(0, 2_000) + "\n…"
        : proposal.originalSnippet,
      "```",
      "",
      "**Proposed (excerpt):**",
      "```",
      proposal.proposedSnippet.length > 2_000
        ? proposal.proposedSnippet.slice(0, 2_000) + "\n…"
        : proposal.proposedSnippet,
      "```",
    ].join("\n");

  const prUrl = await createPullRequest({
    repo: opts.repo,
    token: opts.token,
    branch,
    baseBranch,
    title,
    body,
    draft: opts.draft !== false,
    apiBase: opts.apiBase ?? "https://api.github.com",
  });

  return { branch, prUrl, commitSha };
}
