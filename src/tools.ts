import { applyProposal, type ApplyOptions, type ApplyResult } from "./apply.js";
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

export interface FeedbackToolsOptions {
  /** Absolute path to the git working tree this agent can modify. */
  repoRoot: string;
  /** Directory where proposal JSON files are persisted. */
  proposalsDir: string;
  /** Forwarded to `applyProposal` as PR/branch/commit defaults. */
  applyOptions?: Omit<ApplyOptions, "repoRoot">;
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
export function feedbackTools(opts: FeedbackToolsOptions): {
  writeImprovementProposal: FeedbackTool<
    WriteImprovementProposalInput,
    WriteImprovementProposalResult
  >;
  applyProposal: FeedbackTool<ApplyProposalInput, ApplyProposalResult>;
} {
  const writeImprovementProposal: FeedbackTool<
    WriteImprovementProposalInput,
    WriteImprovementProposalResult
  > = {
    name: "write_improvement_proposal",
    description:
      "Save a single minimal self-improvement diff (file + snippet replacement). " +
      "Always preview the diff in chat first; never call apply_proposal in the same turn.",
    parameters: writeImprovementProposalSchema as unknown as object,
    execute: async (input) => {
      const { proposalId, path } = saveProposal(input, opts.proposalsDir);
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
      "Apply a previously saved proposal: create a branch, commit the change, push, and open a draft PR. " +
      "ONLY call this after the user has explicitly approved in their latest message. " +
      "Pass userConfirmedInThisMessage: true to acknowledge the approval policy.",
    parameters: applyProposalSchema as unknown as object,
    execute: async (input, context) => {
      if (!input.userConfirmedInThisMessage) {
        throw new Error(
          "apply_proposal requires userConfirmedInThisMessage=true. The user must explicitly approve."
        );
      }
      const proposal = loadProposal(opts.proposalsDir, input.proposalId);
      if (opts.onBeforeApply) {
        const ok = await opts.onBeforeApply(proposal, input, context ?? {});
        if (ok === false) {
          throw new Error("apply_proposal rejected by onBeforeApply policy.");
        }
      }
      const applyResult = applyProposal(proposal, {
        repoRoot: opts.repoRoot,
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
