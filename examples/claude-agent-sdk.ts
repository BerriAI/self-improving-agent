/**
 * Claude Agent SDK example. Two-line wiring.
 *
 * Install:
 *   npm i @anthropic-ai/claude-agent-sdk self-improving-agent
 *
 * Run:
 *   SELF_IMPROVING_AGENT_REPO_ROOT=$(pwd) \
 *   tsx examples/claude-agent-sdk.ts "feedback: you keep skipping the env-vars step"
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { feedbackServer, feedbackSkill } from "self-improving-agent/claude";

const userMessage = process.argv.slice(2).join(" ") || "feedback: you keep skipping the env-vars step";

for await (const event of query({
  prompt: userMessage,
  options: {
    systemPrompt: feedbackSkill,
    mcpServers: { sia: feedbackServer },
    model: "claude-sonnet-4-5",
  },
})) {
  if (event.type === "assistant" && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
}
process.stdout.write("\n");
