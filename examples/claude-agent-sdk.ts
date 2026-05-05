/**
 * Example: wiring self-improving-agent into the official Claude Agent SDK.
 *
 * Install:
 *   pnpm add @anthropic-ai/claude-agent-sdk self-improving-agent
 *
 * The Claude Agent SDK accepts plain JSON-schema tool definitions, so the
 * wiring is just `feedbackTools(...)` → adapt name/description/schema/handler.
 */
import { query, tool } from "@anthropic-ai/claude-agent-sdk";
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

const writeProposalTool = tool({
  name: tools.writeImprovementProposal.name,
  description: tools.writeImprovementProposal.description,
  // The SDK accepts JSON Schema directly.
  input_schema: tools.writeImprovementProposal.parameters,
  handler: async (input: Parameters<typeof tools.writeImprovementProposal.execute>[0]) => {
    const result = await tools.writeImprovementProposal.execute(input);
    return result.message;
  },
});

const applyProposalTool = tool({
  name: tools.applyProposal.name,
  description: tools.applyProposal.description,
  input_schema: tools.applyProposal.parameters,
  handler: async (input: Parameters<typeof tools.applyProposal.execute>[0]) => {
    const result = await tools.applyProposal.execute(input);
    return result.message;
  },
});

/**
 * Run a single user turn through Claude with the feedback tools attached.
 * The SDK manages the tool-call loop for you.
 */
export async function runOnce(userMessage: string) {
  const stream = query({
    prompt: userMessage,
    options: {
      systemPrompt: feedbackSkill,
      tools: [writeProposalTool, applyProposalTool],
      model: "claude-sonnet-4-5",
    },
  });

  for await (const event of stream) {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
      }
    }
  }
  process.stdout.write("\n");
}

// Run from CLI: `tsx examples/claude-agent-sdk.ts "feedback: ..."`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const msg = process.argv.slice(2).join(" ");
  if (!msg) {
    console.error("Usage: tsx examples/claude-agent-sdk.ts <message>");
    process.exit(1);
  }
  runOnce(msg).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
