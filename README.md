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

The agent decides when to use these tools based on the skill — no regex on user messages, no transport assumptions.

## Quick start

### With `@anthropic-ai/claude-agent-sdk`

```ts
import { query, tool } from "@anthropic-ai/claude-agent-sdk";
import { feedbackSkill, feedbackTools } from "self-improving-agent";

const fb = feedbackTools({
  repoRoot: process.cwd(),
  proposalsDir: "./runs/improvements",
  onProposed: async (p) => console.log(`[proposed] ${p.file} risk=${p.risk}`),
  onApplied:  async (r) => console.log(`[applied]  ${r.prUrl}`),
});

const write = tool({
  name: fb.writeImprovementProposal.name,
  description: fb.writeImprovementProposal.description,
  input_schema: fb.writeImprovementProposal.parameters,
  handler: async (input) => (await fb.writeImprovementProposal.execute(input)).message,
});

const apply = tool({
  name: fb.applyProposal.name,
  description: fb.applyProposal.description,
  input_schema: fb.applyProposal.parameters,
  handler: async (input) => (await fb.applyProposal.execute(input)).message,
});

for await (const _ of query({
  prompt: "feedback: you skipped the env-vars step again",
  options: {
    systemPrompt: feedbackSkill,
    tools: [write, apply],
    model: "claude-sonnet-4-5",
  },
})) { /* stream events */ }
```

### With `@mariozechner/pi-agent-core`

```ts
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { feedbackSkill, feedbackTools } from "self-improving-agent";

const fb = feedbackTools({ repoRoot: process.cwd(), proposalsDir: "./runs/improvements" });

const writeTool: AgentTool = {
  name: fb.writeImprovementProposal.name,
  label: "Write improvement proposal",
  description: fb.writeImprovementProposal.description,
  parameters: Type.Object({
    file: Type.String(),
    originalSnippet: Type.String(),
    proposedSnippet: Type.String(),
    reason: Type.String(),
    risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
  }),
  execute: async (_id, input) => {
    const r = await fb.writeImprovementProposal.execute(input);
    return { content: [{ type: "text", text: r.message }] };
  },
};

const applyTool: AgentTool = {
  name: fb.applyProposal.name,
  label: "Apply proposal",
  description: fb.applyProposal.description,
  parameters: Type.Object({
    proposalId: Type.String(),
    userConfirmedInThisMessage: Type.Boolean(),
  }),
  execute: async (_id, input) => {
    const r = await fb.applyProposal.execute(input);
    return { content: [{ type: "text", text: r.message }], terminate: true };
  },
};

const agent = new Agent({
  initialState: {
    systemPrompt: `${myPrompt}\n\n${feedbackSkill}`,
    tools: [writeTool, applyTool],
    messages: [],
    model,
    thinkingLevel: "high",
  },
  getApiKey,
  toolExecution: "sequential",
});
```

Same pattern works with the OpenAI SDK, Vercel AI SDK, LangChain, raw `fetch` — anywhere you can pass a JSON-schema tool definition with an async executor.

Full runnable versions: [`examples/claude-agent-sdk.ts`](examples/claude-agent-sdk.ts), [`examples/pi-agent-core.ts`](examples/pi-agent-core.ts).

## API

```ts
import { feedbackTools, feedbackSkill, type Proposal } from "self-improving-agent";
```

**`feedbackTools(opts)`** returns `{ writeImprovementProposal, applyProposal }`. Each tool exposes `{ name, description, parameters, execute }` — `parameters` is JSON Schema, `execute` is async.

```ts
feedbackTools({
  repoRoot: "/abs/path/to/repo",        // git working tree the agent edits
  proposalsDir: "./runs/improvements",  // where proposal.json files live
  onProposed?:    (proposal, result)  => void,  // post the diff somewhere
  onApplied?:     (result, proposal)  => void,  // post the PR link
  onBeforeApply?: (proposal, input, ctx) => boolean | void, // policy gate
});
```

**`feedbackSkill`** is a markdown string. Concat it into your system prompt:

```ts
const systemPrompt = `${myPrompt}\n\n${feedbackSkill}`;
```

## Safety

`apply_proposal` pushes a branch and opens a PR. Three layers of defense:

1. **Skill wording** — model only calls `apply_proposal` after explicit approval in the user's *most recent* message.
2. **Schema gate** — tool requires `userConfirmedInThisMessage: true`; executor throws on `false`.
3. **`onBeforeApply` hook** — your code can reject any apply (rate limits, allowlist, push rights, etc).

`apply_proposal` also refuses to run if the working tree is dirty, the file is missing, or `originalSnippet` doesn't appear exactly once.

## Requirements

- Node ≥ 18
- `git` and `gh` (authenticated) on PATH

## License

MIT © BerriAI
