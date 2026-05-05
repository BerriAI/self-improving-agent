/**
 * Drop-in tools for the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * Zero-config usage:
 *
 *   import { feedbackServer, feedbackSkill } from "self-improving-agent/claude";
 *   import { query } from "@anthropic-ai/claude-agent-sdk";
 *
 *   for await (const _ of query({
 *     prompt,
 *     options: {
 *       systemPrompt: feedbackSkill,
 *       mcpServers: { sia: feedbackServer },
 *     },
 *   })) { ... }
 *
 * Config falls back to env vars (see ./env.ts). For callbacks, use
 * `createFeedbackServer({ onProposed, onApplied, onBeforeApply })`.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { feedbackTools, type FeedbackToolsOptions } from "./tools.js";

const writeShape = {
  file: z.string().describe("Repo-relative path of the file to change."),
  originalSnippet: z
    .string()
    .describe("Exact contiguous substring from the current file. Must appear exactly once."),
  proposedSnippet: z.string().describe("Replacement text for originalSnippet."),
  reason: z
    .string()
    .describe("1–3 sentences: what failure mode this fixes and why this diff addresses it."),
  risk: z
    .enum(["low", "medium", "high"])
    .describe("low = wording/docs · medium = behavior change · high = infra/auth/data."),
};

const applyShape = {
  proposalId: z
    .string()
    .describe("The proposalId returned by a prior write_improvement_proposal call."),
  userConfirmedInThisMessage: z
    .boolean()
    .describe(
      "MUST be true. Only set if the user's most recent message is an explicit approval."
    ),
};

/**
 * Build a Claude SDK MCP server containing both feedback tools.
 *
 * Use this when you need callbacks (`onProposed`, `onApplied`, `onBeforeApply`)
 * or want to override `repoRoot` / `proposalsDir` at construction time.
 */
export function createFeedbackServer(opts: FeedbackToolsOptions = {}) {
  const fb = feedbackTools(opts);

  const writeTool = tool(
    fb.writeImprovementProposal.name,
    fb.writeImprovementProposal.description,
    writeShape,
    async (args) => {
      const result = await fb.writeImprovementProposal.execute(args);
      return { content: [{ type: "text", text: result.message }] };
    }
  );

  const applyTool = tool(
    fb.applyProposal.name,
    fb.applyProposal.description,
    applyShape,
    async (args) => {
      const result = await fb.applyProposal.execute(args);
      return { content: [{ type: "text", text: result.message }] };
    }
  );

  return createSdkMcpServer({
    name: "self-improving-agent",
    version: "0.2.0",
    tools: [writeTool, applyTool],
  });
}

/**
 * Zero-config feedback server. Reads `SELF_IMPROVING_AGENT_REPO_ROOT` and
 * `SELF_IMPROVING_AGENT_PROPOSALS_DIR` from the environment at call time.
 *
 * Pass this directly into `query({ options: { mcpServers: { sia: feedbackServer } } })`.
 */
export const feedbackServer = createFeedbackServer();

export { feedbackSkill } from "./skill.js";
