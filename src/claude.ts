/**
 * Drop-in tools for the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * Zero-config usage:
 *
 *   import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
 *   import { feedbackTools } from "self-improving-agent/claude";
 *
 *   const sia = createSdkMcpServer({ name: "sia", version: "0.1.0", tools: feedbackTools });
 *
 *   for await (const _ of query({
 *     prompt,
 *     options: { mcpServers: { sia } },   // your existing systemPrompt stays as-is
 *   })) { ... }
 *
 * Config falls back to env vars (see ./env.ts). For callbacks, use
 * `createFeedbackTools({ onProposed, onApplied, onBeforeApply })`.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { feedbackTools as buildFeedbackTools, type FeedbackToolsOptions } from "./tools.js";

const readShape = {
  path: z
    .string()
    .describe(
      "Repo-relative path inside SELF_IMPROVING_AGENT_REPO_ROOT. Use \".\" to list the repo root."
    ),
};

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
 * Build the two feedback tools as `SdkMcpToolDefinition[]`.
 *
 * Wrap with `createSdkMcpServer({ name, tools })` and pass the result into
 * `query({ options: { mcpServers: { ... } } })`.
 *
 * Use this factory when you need callbacks (`onProposed`, `onApplied`,
 * `onBeforeApply`) or want to override `repoRoot` / `proposalsDir`.
 */
export function createFeedbackTools(opts: FeedbackToolsOptions = {}) {
  const fb = buildFeedbackTools(opts);

  const readTool = tool(
    fb.readSelfFile.name,
    fb.readSelfFile.description,
    readShape,
    async (args) => {
      const result = await fb.readSelfFile.execute(args);
      const text =
        result.kind === "directory"
          ? `${result.path}/\n${result.entries.map((e) => `  ${e}`).join("\n")}`
          : `${result.path} (${result.bytes} bytes${result.truncated ? ", truncated" : ""}):\n${result.content}`;
      return { content: [{ type: "text", text }] };
    }
  );

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

  return [readTool, writeTool, applyTool];
}

/**
 * Zero-config tools array. Reads `SELF_IMPROVING_AGENT_REPO_ROOT` and
 * `SELF_IMPROVING_AGENT_PROPOSALS_DIR` from the environment at call time.
 *
 *   const sia = createSdkMcpServer({ name: "sia", tools: feedbackTools });
 */
export const feedbackTools = createFeedbackTools();

export { feedbackSkill } from "./skill.js";
