import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** A single proposed self-improvement diff. */
export interface Proposal {
  /** Repo-relative path of the file to change. */
  file: string;
  /**
   * Exact contiguous substring from the file. Must appear exactly once
   * for `applyProposal` to succeed.
   */
  originalSnippet: string;
  /** Replacement text for `originalSnippet`. */
  proposedSnippet: string;
  /** 1–3 sentences: why this change. */
  reason: string;
  /** "low" = wording/docs · "medium" = behavior · "high" = infra/auth. */
  risk: "low" | "medium" | "high";
}

export interface SavedProposal extends Proposal {
  proposalId: string;
  createdAt: string;
}

/**
 * Persist a proposal to `<dir>/<proposalId>.json` and return the absolute path
 * plus the generated id.
 *
 * The id is short and URL-safe so callers can pass it back to `apply_proposal`
 * without escaping.
 */
export function saveProposal(
  proposal: Proposal,
  dir: string
): { proposalId: string; path: string } {
  fs.mkdirSync(dir, { recursive: true });
  const proposalId = crypto.randomBytes(6).toString("hex");
  const filePath = path.join(dir, `${proposalId}.json`);
  const record: SavedProposal = {
    proposalId,
    createdAt: new Date().toISOString(),
    ...proposal,
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
  return { proposalId, path: filePath };
}

/** Load a previously saved proposal by id from `dir`. */
export function loadProposal(dir: string, proposalId: string): SavedProposal {
  if (!/^[a-zA-Z0-9_-]+$/.test(proposalId)) {
    throw new Error(`Invalid proposalId: ${proposalId}`);
  }
  const filePath = path.join(dir, `${proposalId}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as SavedProposal;
  for (const k of ["file", "originalSnippet", "proposedSnippet", "reason", "risk"] as const) {
    if (typeof data[k] !== "string") {
      throw new Error(`Invalid proposal ${proposalId}: missing ${k}`);
    }
  }
  return data;
}
