# self-improving-agent

**A drop-in self-improvement loop for any AI agent.**

Two tools and a skill. The agent proposes a minimal diff, you approve, a draft PR opens.

```bash
npm install self-improving-agent
```

<!-- Slack feedback → PR screenshot goes here -->
<!-- ![Slack feedback to PR](docs/slack-to-pr.png) -->

## Why

Most agents fail in repeatable ways: skipped setup steps, vague prompts, wrong tool routing. Today you fix them by hand-editing prompts. `self-improving-agent` lets the agent fix itself — under explicit human approval.

## How it works

```mermaid
flowchart LR
    A([user feedback]) --> B[write_improvement_proposal]
    B --> C{{diff shown}}
    C -- "approve" --> D[apply_proposal]
    D --> E([draft PR])
```

## Configure once, via env vars

```bash
export SELF_IMPROVING_AGENT_REPO_ROOT=/abs/path/to/your/repo
export SELF_IMPROVING_AGENT_PROPOSALS_DIR=./runs/improvements   # optional, this is the default
```

That's it — no options object, no per-call config.

## Use it

### Claude Agent SDK

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { feedbackServer, feedbackSkill } from "self-improving-agent/claude";

for await (const _ of query({
  prompt: userMessage,
  options: {
    systemPrompt: feedbackSkill,
    mcpServers: { sia: feedbackServer },
  },
})) { /* stream events */ }
```

### pi-agent-core

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { feedbackTools, feedbackSkill } from "self-improving-agent/pi";

new Agent({
  initialState: {
    systemPrompt: `${myPrompt}\n\n${feedbackSkill}`,
    tools: [...myTools, ...feedbackTools],
    messages: [],
    model,
    thinkingLevel: "high",
  },
  getApiKey,
  toolExecution: "sequential",
});
```

### Any other framework

```ts
import { feedbackTools, feedbackSkill } from "self-improving-agent";

const fb = feedbackTools(); // returns { writeImprovementProposal, applyProposal }
// each tool: { name, description, parameters (JSON Schema), execute(input): Promise<{ message }> }
```

Pass `parameters` as the tool's input schema and `execute` as the handler. Works with the OpenAI SDK, Vercel AI SDK, LangChain, raw `fetch` — anything.

## Callbacks (optional)

For posting the diff or PR URL back to Slack/Discord/wherever:

```ts
import { createFeedbackServer } from "self-improving-agent/claude";
// or: import { createFeedbackTools } from "self-improving-agent/pi";

const feedbackServer = createFeedbackServer({
  onProposed: async (p, r) => slack.post(`Proposal ${r.proposalId} — risk: ${p.risk}`),
  onApplied:  async (r) => slack.post(`PR opened: ${r.prUrl}`),
  onBeforeApply: async (proposal, input, ctx) => {
    if (!isApproval(ctx.lastUserMessage)) return false;
  },
});
```

## Safety

`apply_proposal` pushes a branch and opens a PR. Three layers of defense:

1. **Skill wording** — model only calls `apply_proposal` after explicit approval in the user's *most recent* message.
2. **Schema gate** — tool requires `userConfirmedInThisMessage: true`; executor throws on `false`.
3. **`onBeforeApply` hook** — your code can reject any apply (rate limits, allowlist, push rights).

`apply_proposal` also refuses to run if the working tree is dirty, the file is missing, or `originalSnippet` doesn't appear exactly once.

## Requirements

- Node ≥ 18
- `git` and `gh` (authenticated) on PATH
- One of: `@anthropic-ai/claude-agent-sdk`, `@mariozechner/pi-agent-core`, or any agent framework that takes JSON-schema tools

## License

MIT © BerriAI
