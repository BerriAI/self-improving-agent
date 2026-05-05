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
 * or want to override `repo` / `token` / `cacheDir` / `proposalsDir`.
 */
export function createFeedbackTools(opts: FeedbackToolsOptions = {}): AgentTool[] {
  const fb = buildFeedbackTools(opts);

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

  return [writeTool as AgentTool, applyTool as AgentTool];
}

/**
 * Zero-config tool array. Reads `SELF_IMPROVING_AGENT_REPO`,
 * `SELF_IMPROVING_AGENT_GITHUB_TOKEN`, and (optionally)
 * `SELF_IMPROVING_AGENT_CACHE_DIR` / `SELF_IMPROVING_AGENT_PROPOSALS_DIR`
 * from the environment at call time.
 *
 * Spread directly into `tools: [...feedbackTools]` in your Agent state.
 */
export const feedbackTools: AgentTool[] = createFeedbackTools();

export { feedbackSkill } from "./skill.js";
