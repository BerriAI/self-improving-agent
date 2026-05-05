import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Proposal } from "./proposal.js";

export interface ApplyResult {
  branch: string;
  prUrl: string;
  commitSha: string;
}

export interface ApplyOptions {
  /** Absolute path to the git working tree to operate on. Must be a clean repo. */
  repoRoot: string;
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
}

function execGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Apply a proposal end-to-end: create branch, replace snippet exactly once,
 * commit, push, and open a draft PR via the `gh` CLI.
 *
 * Throws if:
 *  - `repoRoot` is not a git root
 *  - working tree is dirty
 *  - target file is missing
 *  - `originalSnippet` does not appear exactly once
 *  - `gh pr create` fails (gh not installed, no remote auth, etc.)
 *
 * The caller is responsible for any "did the user actually approve this?"
 * check before invoking — this function does not validate intent.
 */
export function applyProposal(
  proposal: Proposal,
  opts: ApplyOptions
): ApplyResult {
  const root = path.resolve(opts.repoRoot);
  const top = execGit(["rev-parse", "--show-toplevel"], root).trim();
  if (path.resolve(top) !== root) {
    throw new Error(`repoRoot ${root} is not a git root (got ${top})`);
  }

  const dirty = execGit(["status", "--porcelain"], root).trim();
  if (dirty) {
    throw new Error(
      "Working tree is not clean. Commit, stash, or clean before applying."
    );
  }

  const absFile = path.resolve(root, proposal.file);
  if (!absFile.startsWith(root + path.sep) && absFile !== root) {
    throw new Error(`Invalid file path: ${proposal.file}`);
  }
  if (!fs.existsSync(absFile)) {
    throw new Error(`File not found: ${proposal.file}`);
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
  execGit(["commit", "-m", commitMessage], root);
  const commitSha = execGit(["rev-parse", "HEAD"], root).trim();
  execGit(["push", "-u", "origin", branch], root);

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

  const draft = opts.draft !== false;
  const ghArgs = [
    "pr",
    "create",
    ...(draft ? ["--draft"] : []),
    "--title",
    title,
    "--body",
    body,
  ];

  const ghOut = execFileSync("gh", ghArgs, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  const urlMatch = ghOut.match(/https:\/\/github\.com\/\S+/);
  const prUrl =
    urlMatch?.[0] ??
    ghOut
      .split("\n")
      .filter((l) => l.startsWith("http"))
      .pop()
      ?.trim() ??
    ghOut;

  return { branch, prUrl, commitSha };
}
