/**
 * pi-agent-core example.
 *
 * Install:
 *   npm i @mariozechner/pi-agent-core @mariozechner/pi-ai typebox self-improving-agent
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { feedbackTools } from "self-improving-agent/pi";

export function buildAgent(systemPrompt: string, model: unknown, getApiKey: () => string) {
  return new Agent({
    initialState: {
      systemPrompt, // unchanged — your own prompt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      thinkingLevel: "high",
      tools: [...feedbackTools], // append the two feedback tools to your existing tools
      messages: [],
    },
    getApiKey,
    toolExecution: "sequential",
  });
}
