/**
 * Claude Agent SDK example.
 *
 * Install:
 *   npm i @anthropic-ai/claude-agent-sdk self-improving-agent
 *
 * Run:
 *   SELF_IMPROVING_AGENT_REPO_ROOT=$(pwd) \
 *   tsx examples/claude-agent-sdk.ts "feedback: you keep skipping the env-vars step"
 */
import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import { feedbackTools } from "self-improving-agent/claude";

const sia = createSdkMcpServer({ name: "sia", version: "0.1.0", tools: feedbackTools });

const userMessage = process.argv.slice(2).join(" ") || "feedback: you keep skipping the env-vars step";

for await (const event of query({
  prompt: userMessage,
  options: {
    mcpServers: { sia },
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
