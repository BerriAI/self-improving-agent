/**
 * Example: wiring self-improving-agent into @mariozechner/pi-agent-core.
 *
 * Install:
 *   pnpm add @mariozechner/pi-agent-core @mariozechner/pi-ai typebox self-improving-agent
 *
 * pi-agent-core uses `typebox` schemas for tool parameters and a tuple
 * `(toolCallId, input)` execute signature, so we wrap the framework-agnostic
 * tools from this lib in `AgentTool` adapters.
 */
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { feedbackSkill, feedbackTools } from "self-improving-agent";

const tools = feedbackTools({
  repoRoot: process.cwd(),
  proposalsDir: "./runs/improvements",
  onProposed: async (p) => {
    console.log(`[proposed ${p.proposalId}] ${p.file}  risk=${p.risk}`);
  },
  onApplied: async (r) => {
    console.log(`[applied] ${r.prUrl}`);
  },
});

// pi-agent-core expects typebox schemas. We re-declare the params here in
// typebox; the JSON-schema versions in `tools.parameters` stay available
// for other frameworks.
const WriteParams = Type.Object({
  file: Type.String(),
  originalSnippet: Type.String(),
  proposedSnippet: Type.String(),
  reason: Type.String(),
  risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
});
const ApplyParams = Type.Object({
  proposalId: Type.String(),
  userConfirmedInThisMessage: Type.Boolean(),
});

export const writeProposalAgentTool: AgentTool<typeof WriteParams> = {
  name: tools.writeImprovementProposal.name,
  label: "Write improvement proposal",
  description: tools.writeImprovementProposal.description,
  parameters: WriteParams,
  execute: async (_id, input) => {
    const result = await tools.writeImprovementProposal.execute(input);
    return {
      content: [{ type: "text" as const, text: result.message }],
      details: { proposalId: result.proposalId, risk: input.risk },
    };
  },
};

export const applyProposalAgentTool: AgentTool<typeof ApplyParams> = {
  name: tools.applyProposal.name,
  label: "Apply proposal",
  description: tools.applyProposal.description,
  parameters: ApplyParams,
  execute: async (_id, input) => {
    const result = await tools.applyProposal.execute(input);
    return {
      content: [{ type: "text" as const, text: result.message }],
      details: { prUrl: result.prUrl, branch: result.branch },
      terminate: true,
    };
  },
};

// Drop both tools onto the agent and concat the skill into the system prompt.
export function buildAgent(systemPrompt: string, model: unknown, getApiKey: () => string) {
  return new Agent({
    initialState: {
      systemPrompt: `${systemPrompt}\n\n${feedbackSkill}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      thinkingLevel: "high",
      tools: [
        writeProposalAgentTool as AgentTool,
        applyProposalAgentTool as AgentTool,
      ],
      messages: [],
    },
    getApiKey,
    toolExecution: "sequential",
  });
}
