/**
 * Drop-in tools for `@mariozechner/pi-agent-core`.
 *
 * Zero-config usage:
 *
 *   import { feedbackTools, feedbackSkill } from "self-improving-agent/pi";
 *   import { Agent } from "@mariozechner/pi-agent-core";
 *
 *   const agent = new Agent({
 *     initialState: {
 *       systemPrompt: `${myPrompt}\n\n${feedbackSkill}`,
 *       tools: [...myTools, ...feedbackTools],
 *       messages: [],
 *       model,
 *       thinkingLevel: "high",
 *     },
 *     getApiKey,
 *     toolExecution: "sequential",
 *   });
 *
 * Config falls back to env vars (see ./env.ts). For callbacks, use
 * `createFeedbackTools({ onProposed, onApplied, onBeforeApply })`.
 */
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import {
  feedbackTools as buildFeedbackTools,
  type FeedbackToolsOptions,
} from "./tools.js";

const ReadParams = Type.Object({
  path: Type.String({
    description:
      "Repo-relative path inside SELF_IMPROVING_AGENT_REPO_ROOT. Use \".\" to list the repo root.",
  }),
});

const WriteParams = Type.Object({
  file: Type.String({ description: "Repo-relative path of the file to change." }),
  originalSnippet: Type.String({
    description: "Exact contiguous substring from the current file. Must appear exactly once.",
  }),
  proposedSnippet: Type.String({ description: "Replacement text for originalSnippet." }),
  reason: Type.String({
    description: "1–3 sentences: what failure mode this fixes and why this diff addresses it.",
  }),
  risk: Type.Union(
    [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
    {
      description: "low = wording/docs · medium = behavior change · high = infra/auth/data.",
    }
  ),
});

const ApplyParams = Type.Object({
  proposalId: Type.String({
    description: "The proposalId returned by a prior write_improvement_proposal call.",
  }),
  userConfirmedInThisMessage: Type.Boolean({
    description:
      "MUST be true. Only set if the user's most recent message is an explicit approval.",
  }),
});

/**
 * Build the two pi-agent-core tools.
 *
 * Use this when you need callbacks (`onProposed`, `onApplied`, `onBeforeApply`)
 * or want to override `repoRoot` / `proposalsDir`.
 */
export function createFeedbackTools(opts: FeedbackToolsOptions = {}): AgentTool[] {
  const fb = buildFeedbackTools(opts);

  const readTool: AgentTool<typeof ReadParams> = {
    name: fb.readSelfFile.name,
    label: "Read self file",
    description: fb.readSelfFile.description,
    parameters: ReadParams,
    execute: async (_id, input) => {
      const r = await fb.readSelfFile.execute(input);
      const text =
        r.kind === "directory"
          ? `${r.path}/\n${r.entries.map((e) => `  ${e}`).join("\n")}`
          : `${r.path} (${r.bytes} bytes${r.truncated ? ", truncated" : ""}):\n${r.content}`;
      return {
        content: [{ type: "text" as const, text }],
        details: { kind: r.kind, path: r.path },
      };
    },
  };

  const writeTool: AgentTool<typeof WriteParams> = {
    name: fb.writeImprovementProposal.name,
    label: "Write improvement proposal",
    description: fb.writeImprovementProposal.description,
    parameters: WriteParams,
    execute: async (_id, input) => {
      const r = await fb.writeImprovementProposal.execute(input);
      return {
        content: [{ type: "text" as const, text: r.message }],
        details: { proposalId: r.proposalId, risk: input.risk },
      };
    },
  };

  const applyTool: AgentTool<typeof ApplyParams> = {
    name: fb.applyProposal.name,
    label: "Apply proposal",
    description: fb.applyProposal.description,
    parameters: ApplyParams,
    execute: async (_id, input) => {
      const r = await fb.applyProposal.execute(input);
      return {
        content: [{ type: "text" as const, text: r.message }],
        details: { prUrl: r.prUrl, branch: r.branch },
        terminate: true,
      };
    },
  };

  return [readTool as AgentTool, writeTool as AgentTool, applyTool as AgentTool];
}

/**
 * Zero-config tool array. Reads `SELF_IMPROVING_AGENT_REPO_ROOT` and
 * `SELF_IMPROVING_AGENT_PROPOSALS_DIR` from the environment at call time.
 *
 * Spread directly into `tools: [...feedbackTools]` in your Agent state.
 */
export const feedbackTools: AgentTool[] = createFeedbackTools();

export { feedbackSkill } from "./skill.js";
