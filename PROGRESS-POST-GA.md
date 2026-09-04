# Tsukinome — progress log, post-GA

Keep this current. It's the source of truth for what's done and what's next **after** the initial
launch. Everything up to and including Phase 2.1 (subscription auth) lives in
[`PROGRESS.md`](PROGRESS.md), which is now frozen as the historical record — it got long enough
that finding current state in it was the hard part.

The plan these phases come from is [`docs/implementation-plan.md`](docs/implementation-plan.md) §8.

## Phase status

- [ ] Phase 2.2 — OpenRouter compatibility (bring any model, alongside Claude)
- [ ] Phase 2.3 — Label-gated pickup, and a label for ungated autonomous runs
- [ ] Phase 2.4 — Operating cost & run lifecycle (Neon compute, shorter listening windows)
- [ ] Phase 2.5 — Declared toolchain (optional `.tsukinome/config.yml`)
- [ ] Phase 2.6 — Bring-your-own / pooled infrastructure keys (E2B, Neon)

## Outstanding issues carried over from GA

These were open when `PROGRESS.md` was frozen and are still open.

- **⏸️ Subscription auth: live run still unverified.** The connect page offers it and the credential
  path works end to end (spec → clarify → plan → decompose → sandbox all ran on a subscription on
  2026-09-03). What hasn't completed is a full issue → PR run, because the TDD loop hadn't been
  reached before smee.io went down. Also unverified: the memory envelope on Render, where the Agent
  SDK spawns its bundled Claude Code binary per model call and the CocoIndex sidecar already spikes
  ~300MB on a 512MB Starter.
- **⏸️ Non-recoverable transient state.** A non-budget exception thrown *after* the
  `Planning`/`Implementing` transition can't self-recover — the retry is skipped by the
  `state !== <expected>` guard, stranding the run in the transient state.
- **⏸️ Cost: consider dropping Opus.** Opus (spec/plan/review) is the priciest tier. The three
  role→model constants are in `src/llm/models.ts`. Decide against a real `llm_calls` breakdown, not
  a guess — the instrumentation is there now, and it records notional cost for subscription runs
  too, so both auth types are comparable.
- **⏸️ Bad/unsatisfiable ACs should be caught up front.** An impossible acceptance criterion should
  be reshaped or flagged by the Opus Architect rather than failing the TDD loop. CocoIndex
  retrieval now works, so the Architect can see real code; the reshaping behaviour itself isn't
  implemented, and the human-help gate remains the stopgap.

## Known environment quirks (not code defects)

- **smee.io is unreliable, and GitHub does not retry.** Each delivery is attempted once; a smee
  timeout means the event is lost, not queued. On 2026-09-04 smee.io was down entirely
  (`/new` returning 503, homepage timing out) and five `issue_comment.created` deliveries — a
  clarification reply — were dropped. Nothing in the app or its config was involved. A local
  replay tool that fetches a failed delivery from GitHub and posts it to `localhost` with a valid
  signature would remove the dependency for dev; a real tunnel would remove it properly.
- **The sidecar venv needs populating** after a fresh clone: `.venv/bin/pip install -r
  sidecar/requirements.txt`. Without it the run continues but every plan is written from the spec
  alone, with no view of the repo — visible as `Code index unavailable` in the log.

## Session log

(Append a line per phase: date, phase, outcome, demo.)

- 2026-09-04 | Planning | Post-GA backlog re-scoped. Split this file out of `PROGRESS.md`, and
  reordered `docs/implementation-plan.md` §8 around five phases: OpenRouter first, then label
  gating, then operating cost, then the declared toolchain, then infrastructure keys. Recorded the
  Neon diagnosis below.

## The Neon compute diagnosis (2026-09-04)

Recording this here because it explains a real bill and the cause is ours, not Neon's.

`startWorker` polls the `jobs` table every second — `DEFAULT_POLL_INTERVAL_MS = 1000` in
`src/worker/worker.ts` — forever, regardless of whether there is work. Neon bills by compute
**active time** and only suspends an endpoint after several minutes with no queries, so a query
every second means the endpoint never scales to zero: an idle Tsukinome is billed around the clock.
The hourly stale sweep would hold it awake by itself even if the poll stopped.

That is why 100 free compute units went quickly with almost no runs. The fix belongs to Phase 2.4:
back off when the queue is empty, or move to `LISTEN`/`NOTIFY` so an enqueue wakes the worker
rather than the worker asking a thousand times an hour. The measure of success is Neon's own
compute-hours graph, not how the loop reads.
