# Docs-feedback agent — Sanity × eve

An autonomous content-operations agent. When a reader leaves feedback on a documentation
article, the agent reads the article, composes a clarifying fix and stages it as a **draft**
(never published), and posts an actionable Slack notice. An editor reviews the draft in Sanity
Studio and publishes. A weekly sweep catches anything the event trigger missed.

Built on [eve](https://eve.dev) (durable runtime). eve's own model does the reasoning; the
write is a deterministic [`@sanity/client`](https://www.sanity.io/docs/js-client) document
action against the exact article — so the right doc gets the edit, every time.

## How it works

```
Reader leaves feedback
   │  (Sanity Function, on create)        (eve cron, weekly)
   ▼                                            │
eve agent ──────────────────────────────────────┘
   ├─ read_article        → fetch the article body (plain GROQ, no AI credits)
   ├─ stage_article_edit  → insert the agent's note into the article's DRAFT (edit action)
   ├─ find_recent_feedback → GROQ list of unaddressed feedback (cron sweep)
   └─ post_to_slack       → "Doc X got feedback; draft ready to review"
Editor opens the draft in Studio → approves & publishes   (human-in-the-loop)
```

The agent writes to **drafts only** (via the Sanity document Actions API, which creates the
draft from the published version), so the editor's review is the approval gate. No content is
ever published without a human.

## Project layout

```
agent/
  agent.ts                       # eve orchestrator model
  instructions.md                # the ops policy (propose, never publish)
  lib/sanity.ts                  # shared @sanity/client factory (one place to configure)
  tools/read_article.ts          # GROQ read of the article body (no AI credits)
  tools/stage_article_edit.ts    # stage the fix as a draft (Sanity edit action)
  tools/find_recent_feedback.ts  # GROQ read of unaddressed feedback (no AI credits)
  tools/post_to_slack.ts         # actionable Slack notice (incoming webhook)
  schedules/weekly-feedback-sweep.ts
sanity/
  sanity.blueprint.ts            # the Function trigger (deploy with the Sanity CLI)
  functions/on-feedback/index.ts # pokes the eve agent on new feedback
```

## Setup

1. `cp .env.example .env.local` and fill it in. You need a project **Editor** token (reads
   content, writes drafts), your project ID + dataset, a Slack incoming webhook, and a model
   credential (`AI_GATEWAY_API_KEY` or `npx eve link`). Optionally set `SANITY_STUDIO_URL`
   for the "Review draft in Studio" button.
2. `npm install`
3. `npm run dev` — the eve dev TUI. Try: *"Reader feedback on article &lt;id&gt;: 'the auth
   section is out of date'. Revise it and post a Slack notice."*

## Test it locally

No deploy needed — both halves run on your machine:

1. **The agent:** `npm run dev` (eve dev TUI), or POST a feedback message to its HTTP API:
   ```bash
   curl -X POST http://127.0.0.1:3000/eve/v1/session -H 'content-type: application/json' \
     -d '{"message":"Reader feedback on article <id>: \"...\". Revise it and post a Slack notice."}'
   ```
2. **The function → agent chain:** with `eve dev` running, point the function at the local
   agent and use Sanity's local function testing (it runs on your machine, so it *can* reach
   localhost):
   ```bash
   cd sanity
   EVE_AGENT_URL=http://127.0.0.1:3000 npx sanity@latest functions test on-feedback \
     --document-id <a feedback _id> --project-id <projectId> --dataset <dataset>
   # or an interactive playground:
   EVE_AGENT_URL=http://127.0.0.1:3000 npx sanity@latest functions dev
   ```
   `context.local` is `true` during local tests — use it to guard real writes if you extend
   the function to mutate content directly.

## Triggers

- **Event (primary):** deploy the Sanity Function — `cd sanity && npx sanity@latest blueprints deploy`.
  It fires on new `feedback` and POSTs to your deployed agent's `/eve/v1/session` with a
  `Bearer ${EVE_TRIGGER_SECRET}` header. Set `EVE_AGENT_URL` + `EVE_TRIGGER_SECRET` on the
  function.
- **Cron (backstop):** `agent/schedules/weekly-feedback-sweep.ts` sweeps unaddressed feedback
  weekly. (`eve dev` never fires schedules; a deployed `eve start` does.)

## Deploy

`npx eve link` then `npx eve deploy` ships the agent to Vercel; set the same env there.
**Before exposing it,** validate the trigger secret: replace the scaffold's
`placeholderAuth()` in `agent/channels/eve.ts` with a check that accepts
`Authorization: Bearer ${EVE_TRIGGER_SECRET}` (see eve's
[auth & route protection](https://eve.dev/docs/guides/auth-and-route-protection) guide).

## Extend

- **Richer context:** give the agent related content to reason over. Cheapest first — GROQ
  references (`*[references($id)]`), then keyword `score()`/`text::match`, then
  [Sanity Context](https://www.sanity.io/docs/ai/sanity-context) for schema-aware semantic
  search. See the comment in `tools/read_article.ts`.
- **Batch review (Enterprise):** stage fixes into a Content Release instead of drafts, so a
  week of fixes lands in one reviewable release.
- **More checks:** broaden the agent's policy (broken links, missing alt text, SEO).
- **More surfaces:** add other eve channels (Discord, Linear) for notices.
- **Slack app instead of a webhook:** the template posts via an incoming webhook (no install,
  no OAuth). A full Slack app adds interactive buttons and drops the "external link" warning
  Slack shows on webhook buttons — worth it for a team-wide rollout, overkill to start.
