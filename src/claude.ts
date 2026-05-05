/**
 * Drop-in custom tools for the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`).
 *
 * `feedbackTools` is an array of `SdkMcpToolDefinition` objects — the exact
 * shape returned by the SDK's `tool()` helper. They run in-process, just
 * like any other custom tool you build. Mix them with your own tools and
 * bundle once with `createSdkMcpServer`:
 *
 *   import { tool, createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
 *   import { feedbackTools } from "self-improving-agent/claude";
 *
 *   const server = createSdkMcpServer({
 *     name: "my-agent",
 *     version: "1.0.0",
 *     tools: [...myTools, ...feedbackTools],
 *   });
 *
 *   for await (const _ of query({
 *     prompt,
 *     options: {
 *       mcpServers: { "my-agent": server },
 *       allowedTools: [
 *         "mcp__my-agent__write_improvement_proposal",
 *         "mcp__my-agent__apply_proposal",
 *       ],
 *     },
 *   })) { ... }
 *
 * See https://code.claude.com/docs/en/agent-sdk/custom-tools for the full
 * custom-tool surface (it's all in-process — no external MCP).
 *
 * Config falls back to env vars (see ./env.ts). For callbacks, use
 * `createFeedbackTools({ onProposed, onApplied, onBeforeApply })`.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { feedbackTools as buildFeedbackTools, type FeedbackToolsOptions } from "./tools.js";

const SERVER_NAME = "self_improving_agent";
const SERVER_VERSION = "0.5.0";

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

  return [writeTool, applyTool];
}

/**
 * Zero-config tools array. Reads `SELF_IMPROVING_AGENT_REPO_ROOT` and
 * `SELF_IMPROVING_AGENT_PROPOSALS_DIR` from the environment at call time.
 *
 *   const sia = createSdkMcpServer({ name: "sia", tools: feedbackTools });
 */
export const feedbackTools = createFeedbackTools();

/**
 * One-liner integration. Returns `{ mcpServers, allowedTools }` ready
 * to spread into your `query({ options })`:
 *
 *   import { query } from "@anthropic-ai/claude-agent-sdk";
 *   import { feedbackMcp } from "self-improving-agent/claude";
 *
 *   await query({ prompt, options: feedbackMcp() });
 *
 * If you already have your own `mcpServers` / `allowedTools`, merge:
 *
 *   const fb = feedbackMcp();
 *   await query({
 *     prompt,
 *     options: {
 *       mcpServers:  { ...myServers,  ...fb.mcpServers  },
 *       allowedTools: [ ...myAllowed, ...fb.allowedTools ],
 *     },
 *   });
 *
 * The Claude SDK addresses custom tools as `mcp__{server}__{tool}`, so the
 * MCP wrapping and tool-name prefixing are unavoidable — this helper just
 * hides them.
 */
export function feedbackMcp(opts: FeedbackToolsOptions = {}) {
  const tools = createFeedbackTools(opts);
  const server = createSdkMcpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools,
  });
  return {
    mcpServers: { [SERVER_NAME]: server },
    allowedTools: [
      `mcp__${SERVER_NAME}__write_improvement_proposal`,
      `mcp__${SERVER_NAME}__apply_proposal`,
    ],
  };
}

export { feedbackSkill } from "./skill.js";
