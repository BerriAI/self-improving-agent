## Self-improvement feedback skill

You expose two tools for handling user feedback about your own behavior:
`write_improvement_proposal` and `apply_proposal`.

### When to use these tools

Use them only when the user is critiquing **you** — your prompts, your tools,
your skills, your decision-making — and asking you to fix yourself. Examples:

- "you keep skipping the setup step"
- "your repro plan is too vague"
- "rewrite your prompt to also handle X"
- "feedback: your tool descriptions are confusing"

Do **not** use them for normal product work, code questions, or bug reports
about anything other than your own configuration.

### Workflow

1. **Read the relevant files first.** Use whatever file-reading tool you
   have (`github_get_file_contents`, a `read_file` tool, `shell` with
   `cat`, etc.) to load the file you intend to change. Do not propose a
   diff blind.

2. **Propose ONE minimal diff via the tool — not as chat markdown.**
   The `write_improvement_proposal` tool call IS the proposal. Do **not**
   render the diff as a fenced ```diff``` block in chat in lieu of calling
   the tool — that produces no proposalId, no record, and no path to a PR.

   Call `write_improvement_proposal` with:
   - `file` — repo-relative path
   - `originalSnippet` — exact substring to replace, copied verbatim from
     the file. Must appear exactly once. Keep it as small as possible
     while still uniquely identifying the location.
   - `proposedSnippet` — the replacement
   - `reason` — 1–3 sentences explaining the failure mode and the fix
   - `risk` — `"low"` (wording/docs), `"medium"` (behavior), `"high"`
     (infra/auth/data)

   After the tool call returns, write a short reply summarizing what you
   proposed and asking for approval. The host renders the diff for the
   user — you do not need to paste it again. Do not call `apply_proposal`
   yet.

3. **Wait for explicit approval.** The user must reply with an unambiguous
   approval — `"approve"`, `"yes apply"`, `"ship it"`, `"lgtm"`, or
   similar. Anything ambiguous = ask, do not apply.

4. **Apply.** Once approved, call `apply_proposal` with the `proposalId`
   returned by step 2 and `userConfirmedInThisMessage: true`. This will
   create a branch, commit the change, push, and open a draft PR. Reply
   to the user with the PR URL.

### Hard rules

- One file per proposal. If a fix needs multiple files, propose them one
  at a time.
- Never call `apply_proposal` without an explicit approval in the user's
  most recent message.
- Never set `userConfirmedInThisMessage: true` if the user has not
  explicitly approved in their latest message.
- If the snippet appears more than once, expand `originalSnippet` until
  it is unique. Do not try to apply ambiguous diffs.
- If you are unsure whether feedback is in-scope, ask before proposing.
