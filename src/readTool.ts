import fs from "node:fs";
import path from "node:path";
import { resolveConfig } from "./env.js";

const MAX_FILE_BYTES = 200_000;

export const readSelfFileSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "Repo-relative path inside SELF_IMPROVING_AGENT_REPO_ROOT. Use \".\" to list the repo root. If the path is a directory, the tool returns a directory listing instead of file contents.",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export interface ReadSelfFileInput {
  path: string;
}

export type ReadSelfFileResult =
  | { kind: "file"; path: string; bytes: number; truncated: boolean; content: string }
  | { kind: "directory"; path: string; entries: string[] };

/**
 * Read a file (or list a directory) from the agent's own repo.
 *
 * The agent uses this to inspect its own prompts / tools / skills before
 * proposing a self-improvement diff. Path is resolved against the repo
 * root from `SELF_IMPROVING_AGENT_REPO_ROOT` (or `process.cwd()`), and
 * paths that escape the root are rejected.
 */
export function readSelfFile(input: ReadSelfFileInput): ReadSelfFileResult {
  const { repoRoot } = resolveConfig();
  const root = path.resolve(repoRoot);
  const requested = input.path === "" ? "." : input.path;
  const abs = path.resolve(root, requested);

  // Hard sandbox: reject anything that resolves outside repoRoot.
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(
      `read_self_file: path "${input.path}" escapes the repo root (${root}).`
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`read_self_file: no such path "${input.path}" under ${root}.`);
  }

  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(abs, { withFileTypes: true })
      // Skip dotfiles and obvious noise — keep the listing focused on
      // source / config the agent should care about.
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return { kind: "directory", path: requested, entries };
  }

  const buf = fs.readFileSync(abs);
  const truncated = buf.byteLength > MAX_FILE_BYTES;
  const content = truncated
    ? buf.subarray(0, MAX_FILE_BYTES).toString("utf-8") + `\n... [truncated; file is ${buf.byteLength} bytes]`
    : buf.toString("utf-8");
  return { kind: "file", path: requested, bytes: buf.byteLength, truncated, content };
}
