import { applyProposal, ensureClone, type ApplyOptions, type ApplyResult } from "./apply.js";
import { resolveConfig, type PartialConfigOpts } from "./env.js";
import {
  loadProposal,
  saveProposal,
  type Proposal,
  type SavedProposal,
} from "./proposal.js";

/**
 * JSON Schema (draft-07 compatible) for `write_improvement_proposal`.
 * Most LLM SDKs accept this shape directly.
 */
export const writeImprovementProposalSchema = {
  type: "object",
  properties: {
    file: {
      type: "string",
      description:
        "Repo-relative path of the file to change, e.g. src/prompts/system.md",
    },
    originalSnippet: {
      type: "string",
      description:
        "Exact contiguous substring from the current file. Must appear exactly once when applied.",
    },
    proposedSnippet: {
      type: "string",
      description: "Replacement text for originalSnippet.",
    },
    reason: {
      type: "string",
      description:
        "1–3 sentences: what failure mode this fixes and why this diff addresses it.",
    },
    risk: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "low = wording/docs · medium = behavior change · high = infra/auth/data.",
    },
  },
  required: ["file", "originalSnippet", "proposedSnippet", "reason", "risk"],
  additionalProperties: false,
} as const;

/** JSON Schema for `apply_proposal`. */
export const applyProposalSchema = {
  type: "object",
  properties: {
    proposalId: {
      type: "string",
      description:
        "The proposalId returned by a prior write_improvement_proposal call.",
    },
    userConfirmedInThisMessage: {
      type: "boolean",
      description:
        "MUST be true. Only set to true if the user's most recent message is an explicit approval (e.g. 'approve', 'yes apply', 'ship it'). Calling with false or without explicit approval is a violation and will be rejected.",
    },
  },
  required: ["proposalId", "userConfirmedInThisMessage"],
  additionalProperties: false,
} as const;

export interface WriteImprovementProposalInput extends Proposal {}

export interface WriteImprovementProposalResult {
  proposalId: string;
  path: string;
  message: string;
}

export interface ApplyProposalInput {
  proposalId: string;
  userConfirmedInThisMessage: boolean;
}

export interface ApplyProposalResult extends ApplyResult {
  proposalId: string;
  message: string;
}

export interface FeedbackToolsContext {
  /** The most recent user message in the conversation, if available. */
  lastUserMessage?: string;
}

export interface FeedbackToolsOptions extends PartialConfigOpts {
  /** Forwarded to `applyProposal` as PR/branch/commit defaults. */
  applyOptions?: Omit<ApplyOptions, "repo" | "token" | "cacheDir" | "baseBranch">;
  /**
   * Optional gate. Throw or return `false` to reject `apply_proposal`.
   * Receives the loaded proposal and the agent-supplied input. Use this
   * to enforce server-side approval policies (matching message intent,
   * checking allowlists, rate-limiting, etc.).
   */
  onBeforeApply?: (
    proposal: SavedProposal,
    input: ApplyProposalInput,
    context: FeedbackToolsContext
  ) => void | boolean | Promise<void | boolean>;
  /**
   * Called after a successful apply. Useful for posting the PR URL back
   * to wherever the user is.
   */
  onApplied?: (
    result: ApplyProposalResult,
    proposal: SavedProposal
  ) => void | Promise<void>;
  /**
   * Called after a successful proposal save. Useful for posting the
   * proposal card back to the user.
   */
  onProposed?: (
    proposal: SavedProposal,
    result: WriteImprovementProposalResult
  ) => void | Promise<void>;
  /**
   * If true (default), kick off a background clone/refresh of the cache
   * when `feedbackTools()` is called so the agent's source is on disk
   * by the time it reads files. Set false to defer until first apply.
   */
  prefetch?: boolean;
}

/** Generic tool definition. Adapt to your framework. */
export interface FeedbackTool<I, O> {
  name: string;
  description: string;
  parameters: object;
  execute: (input: I, context?: FeedbackToolsContext) => Promise<O>;
}

/**
 * Build the two feedback tools.
 *
 * The returned objects are framework-agnostic: `name`, `description`,
 * `parameters` (JSON Schema), and an async `execute(input, context)`.
 *
 * Adapt them to your framework's tool shape — see examples/.
 */
export function feedbackTools(opts: FeedbackToolsOptions = {}): {
  writeImprovementProposal: FeedbackTool<
    WriteImprovementProposalInput,
    WriteImprovementProposalResult
  >;
  applyProposal: FeedbackTool<ApplyProposalInput, ApplyProposalResult>;
} {
  // Lenient resolution at construction so we can bake the cache path /
  // repo into the tool description without crashing if env vars are
  // missing — `apply_proposal` re-resolves strictly at execute time.
  const constructionCfg = resolveConfig({ ...opts, lenient: true });

  // Kick off the clone in the background so the agent can read source
  // files via shell `cat` / a read tool before its first tool call.
  // We swallow errors here — they'll resurface clearly on apply.
  if (opts.prefetch !== false && constructionCfg.token) {
    queueMicrotask(() => {
      try {
        ensureClone({
          repo: constructionCfg.repo,
          token: constructionCfg.token,
          cacheDir: constructionCfg.cacheDir,
          baseBranch: constructionCfg.baseBranch,
        });
      } catch {
        // Logged on apply if it fails again.
      }
    });
  }

  const repoSlug = `${constructionCfg.repo.owner}/${constructionCfg.repo.name}`;

  const writeImprovementProposal: FeedbackTool<
    WriteImprovementProposalInput,
    WriteImprovementProposalResult
  > = {
    name: "write_improvement_proposal",
    description:
      "Use this when the user is critiquing YOU (your prompts, tools, skills, decisions) and asking you to fix yourself — e.g. \"you keep skipping the setup step\", \"your repro plan is too vague\", \"feedback: rewrite your prompt to handle X\". Do NOT use for normal product work or bug reports unrelated to your own configuration.\n\n" +
      `YOUR OWN SOURCE CODE for the GitHub repo ${repoSlug} is checked out at:\n  ${constructionCfg.cacheDir}\n` +
      "This is a working clone the lib keeps fresh on the base branch — read from it with whatever read tool you have (shell with `cat`/`grep`, a file-reading tool, etc.). The `file` argument below is repo-relative to that path. If the directory doesn't exist yet (first run), the lib will clone it on `apply_proposal`; you can also fetch the file via the GitHub API for `" + repoSlug + "` if you don't want to wait.\n\n" +
      "Workflow:\n" +
      "1. Read the file you intend to change first (don't propose blind).\n" +
      "2. Call this tool with ONE minimal diff: file path (repo-relative), exact originalSnippet (must appear exactly once — copy it verbatim from the file), proposedSnippet, reason, and risk.\n" +
      "3. Write a short reply summarizing the proposal and asking for approval. Do NOT paste the diff as a fenced ```diff``` block in chat in lieu of calling this tool — the tool call IS the proposal; pasting markdown produces no proposalId, no record, and no path to a PR.\n" +
      "4. Wait for explicit approval (\"approve\", \"ship it\", \"lgtm\"). Only then call apply_proposal — never in the same turn as this call.\n\n" +
      "If the snippet appears more than once, expand originalSnippet until unique. One file per proposal — propose multi-file fixes sequentially.",
    parameters: writeImprovementProposalSchema as unknown as object,
    execute: async (input) => {
      const { proposalsDir } = resolveConfig({ ...opts, lenient: true });
      const { proposalId, path } = saveProposal(input, proposalsDir);
      const result: WriteImprovementProposalResult = {
        proposalId,
        path,
        message: `Proposal ${proposalId} saved (risk: ${input.risk}). Show the diff to the user; only call apply_proposal after explicit approval.`,
      };
      if (opts.onProposed) {
        await opts.onProposed({ ...input, proposalId, createdAt: new Date().toISOString() }, result);
      }
      return result;
    },
  };

  const applyProposalTool: FeedbackTool<ApplyProposalInput, ApplyProposalResult> = {
    name: "apply_proposal",
    description:
      `Apply a previously saved proposal against ${repoSlug}: create a branch, commit, push using the configured PAT, and open a draft PR via the GitHub REST API.\n\n` +
      "HARD RULE: Only call this if the user's MOST RECENT message is an unambiguous approval (\"approve\", \"yes apply\", \"ship it\", \"lgtm\"). If the latest message is anything else — a question, a tweak request, silence, ambiguity — do not call this tool, ask instead.\n\n" +
      "Pass userConfirmedInThisMessage: true to acknowledge the approval policy. Setting it to true without explicit approval is a violation and will be rejected.",
    parameters: applyProposalSchema as unknown as object,
    execute: async (input, context) => {
      if (!input.userConfirmedInThisMessage) {
        throw new Error(
          "apply_proposal requires userConfirmedInThisMessage=true. The user must explicitly approve."
        );
      }
      const cfg = resolveConfig(opts);
      const proposal = loadProposal(cfg.proposalsDir, input.proposalId);
      if (opts.onBeforeApply) {
        const ok = await opts.onBeforeApply(proposal, input, context ?? {});
        if (ok === false) {
          throw new Error("apply_proposal rejected by onBeforeApply policy.");
        }
      }
      const applyResult = await applyProposal(proposal, {
        repo: cfg.repo,
        token: cfg.token,
        cacheDir: cfg.cacheDir,
        baseBranch: cfg.baseBranch,
        ...opts.applyOptions,
      });
      const result: ApplyProposalResult = {
        ...applyResult,
        proposalId: input.proposalId,
        message: `Draft PR opened: ${applyResult.prUrl}`,
      };
      if (opts.onApplied) await opts.onApplied(result, proposal);
      return result;
    },
  };

  return {
    writeImprovementProposal,
    applyProposal: applyProposalTool,
  };
}
