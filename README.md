# self-improving-agent

**A drop-in self-improvement loop for any AI agent.**

Two tools and a skill. The agent proposes a minimal diff, the human approves, a draft PR opens.

```bash
npm install self-improving-agent
```

---

## Why

Most agents fail in repeatable ways: skipped setup steps, vague prompts, wrong tool routing. Today you fix them by hand-editing prompts. `self-improving-agent` makes the agent fix itself — under explicit human approval.

## How it works

```
user feedback in chat
         │
         ▼
┌──────────────────────────┐
│ feedbackSkill (in prompt)│
│  + write_improvement_    │  ── agent proposes a diff
│    proposal tool         │
└──────────────────────────┘
         │
         ▼
   proposal.json  ────► shown to user as a diff
         │
         │   user replies "approve" / "ship it"
         ▼
┌──────────────────────────┐
│ apply_proposal tool      │  ── git branch + patch + push + draft PR
└──────────────────────────┘
         │
         ▼
   PR URL back in chat
```

The agent decides when to use these tools based on the skill — no regex on user messages, no transport assumptions, no Slack-specific code.

## API

Three exports:

```ts
import {
  feedbackTools,   // build the two tools
  feedbackSkill,   // markdown to inject into your system prompt
  type Proposal,   // structural type
} from "self-improving-agent";
```

That's it.

### `feedbackTools(opts)`

```ts
const tools = feedbackTools({
  repoRoot: "/abs/path/to/your/repo",   // git working tree the agent edits
  proposalsDir: "./runs/improvements",  // where proposal.json files live

  // Optional callbacks — useful for posting back to Slack/Discord/whatever.
  onProposed: async (proposal, result) => { /* show diff to user */ },
  onApplied:  async (result, proposal) => { /* post PR link */ },

  // Optional belt-and-suspenders policy. Throw or return false to reject apply.
  onBeforeApply: async (proposal, input, ctx) => {
    if (!looksLikeApproval(ctx.lastUserMessage)) return false;
  },
});

tools.writeImprovementProposal  // { name, description, parameters, execute }
tools.applyProposal             // { name, description, parameters, execute }
```

`parameters` is plain JSON Schema. `execute(input, context?)` is async. Adapt to your agent framework.

### `feedbackSkill`

A markdown string. Concat it into your system prompt:

```ts
const systemPrompt = `${myExistingPrompt}\n\n${feedbackSkill}`;
```

It tells the model:
- when to propose (user critiques the agent itself)
- to read the file before proposing
- to keep the diff minimal and pass exact `originalSnippet`
- to **never** call `apply_proposal` without explicit approval in the user's most recent message

### `Proposal` type

```ts
interface Proposal {
  file: string;
  originalSnippet: string;
  proposedSnippet: string;
  reason: string;
  risk: "low" | "medium" | "high";
}
```

## Examples

- [`examples/pi-agent-core.ts`](examples/pi-agent-core.ts) — `@mariozechner/pi-agent-core` with typebox params
- [`examples/claude-agent-sdk.ts`](examples/claude-agent-sdk.ts) — official `@anthropic-ai/claude-agent-sdk`

The same pattern works with the OpenAI SDK, Vercel AI SDK, LangChain, raw `fetch` — anywhere you can pass a JSON-schema tool definition with an async executor.

## Safety

`apply_proposal` is the dangerous one — it pushes a branch and opens a PR.

Three layers of defense, all on by default:

1. **Skill wording** — the model is instructed to only call `apply_proposal` after explicit approval in the user's *most recent* message.
2. **Schema gate** — the tool requires `userConfirmedInThisMessage: true`. The executor throws on `false`.
3. **`onBeforeApply` hook** — your code can reject any apply that doesn't match policy (e.g. fuzzy-match the latest user message against an approval allowlist, check rate limits, verify the user has push rights).

`apply_proposal` also refuses to run if:
- the working tree is dirty
- the file is missing
- `originalSnippet` doesn't appear exactly once

## Requirements

- Node ≥ 18
- `git` on PATH
- `gh` CLI on PATH, authenticated for the target repo

## What it does NOT do

- No transport (Slack, Discord, HTTP — your job)
- No agent framework — `parameters` are JSON Schema, `execute` is async
- No retry, backoff, or logging — caller's choice
- No multi-file edits per proposal — one file, one diff. If you need more, propose them sequentially.

## License

MIT © BerriAI
