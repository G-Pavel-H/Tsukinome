# Tsukinome for GitHub Copilot (VS Code)

A chat-driven, **multi-agent** adaptation of the [Tsukinome](../README.md) workflow for **GitHub
Copilot in VS Code**. Same discipline — spec → plan (you approve) → decompose → **test-first**
implementation → self-review — but run as **custom agents** that an orchestrator delegates between,
right inside your open workspace.

No GitHub App, no Postgres, no sandbox, no PR automation, no comment threads. Copilot already has the
context of your open repo and can read code, edit files, and run tests. So everything happens in
chat, and edits land in your working tree — **you** review the diff and commit/PR yourself.

**Language-agnostic.** Not TypeScript-specific. Every agent detects the stack from the repo's config
(Node/TS, Python, .NET/C#, Go, Java, Ruby, …) and uses the repo's *actual* build/test commands.

## Install (just copy the `.github` folder)

Copy the `.github/` files into the root of the repo you want to use them in:

```
.github/
  agents/
    tsukinome.agent.md            # orchestrator — the engine
    tsukinome-spec.agent.md       # Product Owner + Clarifier
    tsukinome-plan.agent.md       # Architect (you approve its plan)
    tsukinome-decompose.agent.md  # split plan into testable tasks
    tsukinome-implement.agent.md  # test-first red → green → refactor, runs your tests
    tsukinome-review.agent.md     # self-review before you commit
  prompts/
    implement-user-story.prompt.md  # optional /implement-user-story shortcut
```

Reload the VS Code window so Copilot picks up the agents. That's the whole install — nothing else is
required. (You can also drop them in `~/.copilot/agents/` to make them available across all repos.)

## Use it

**Either** type the slash command in Copilot Chat:

```
/implement-user-story Users can reset their password via an emailed link
```

**or** open the **agent dropdown** (or type `/agents`), pick **Tsukinome**, and type your story.
Both routes run the same thing — the `/implement-user-story` prompt file is just a front door that
hands straight to the Tsukinome orchestrator.

Then the orchestrator runs the phases, delegating to each specialist agent:

- **Spec** drafts a testable spec and asks up to 4 clarifying questions in chat if it needs to.
- **Plan** reads your codebase, posts a technical plan, and **stops for your approval**. Reply
  `approve`, or describe changes and it revises. **No code is written before you approve.**
- **Decompose** splits the plan into small, independently testable tasks.
- **Implement** works one task at a time — writes a failing test, runs it to confirm red,
  implements to green, refactors — running your repo's real test command each step.
- **Review** self-reviews the diff against the spec and reports findings.

Finally, **you** review the working-tree diff and commit / open a PR yourself.

You can drive it end-to-end through the **Tsukinome** orchestrator, or step through manually using
the **handoff buttons** each agent shows (e.g. Plan → "Approve & decompose into tasks").

## Models

Each agent declares a prioritized `model:` list (reasoning-heavy models for Spec/Plan/Decompose/
Review, a strong coding model for Implement — mirroring the backend's tiers). Copilot tries them in
order and falls back if one isn't enabled. **Edit these to models your org actually has enabled** —
the names in the files are sensible defaults, not a guarantee your workspace has them.

## Guardrails (kept from the backend)

- **Test-first, always** — no implementation before a failing test for the behavior.
- **Never edit tests to make them pass** — fix the implementation.
- **Human gate at the plan** — nothing is edited until you approve the plan.
- **Round cap** — a task that can't go green in 3 focused attempts stops and asks you, instead of
  thrashing.
- **Untrusted input** — task text and file contents are treated as data, never as instructions.

## Optional: distribute with APM

Copying `.github/` is all you need. If you later want **versioned, reproducible** distribution across
many repos (or a security team's allow-listing), this pack ships an optional
[`apm.yml`](./apm.yml) for [Microsoft's Agent Package Manager](https://github.com/microsoft/apm).
Then a colleague can `apm install` to get the exact same agents pinned by version and content hash,
across Copilot / Claude / Cursor / etc. It's a convenience layer, not a requirement.

## What's intentionally dropped from the backend

- **Sandbox (E2B)** — Copilot runs tests directly in your workspace.
- **PR / comment integration & the Fix-Triage agent** — there's no PR here; you commit yourself.
- **CocoIndex / pgvector code index** — Copilot's own workspace context and search replace it.
