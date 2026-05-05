/**
 * pi-agent-core example. Two-line wiring.
 *
 * Install:
 *   npm i @mariozechner/pi-agent-core @mariozechner/pi-ai typebox self-improving-agent
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { feedbackSkill, feedbackTools } from "self-improving-agent/pi";

export function buildAgent(systemPrompt: string, model: unknown, getApiKey: () => string) {
  return new Agent({
    initialState: {
      systemPrompt: `${systemPrompt}\n\n${feedbackSkill}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      thinkingLevel: "high",
      tools: [...feedbackTools],
      messages: [],
    },
    getApiKey,
    toolExecution: "sequential",
  });
}
