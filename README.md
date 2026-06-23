# Docs-feedback agent: Sanity × eve

An autonomous content-operations agent. When a reader leaves feedback on a documentation
article, the agent reads the article, composes a clarifying fix and stages it as a **draft**
(never published), and posts an actionable Slack notice. An editor reviews the draft in Sanity
Studio and publishes. A weekly sweep catches anything the event trigger missed.

Built on [eve](https://eve.dev) (durable runtime). eve orchestrates the workflow and decides the
fix; the write is a schema-aware Sanity [Agent Action](https://www.sanity.io/docs/agent-actions/transform-quickstart)
that revises the article's draft in place, so the right document gets the edit and a human
approves it in Studio.

## How it works

```
Reader leaves feedback
   │  (Sanity Function → passes the feedback _id)   (eve cron, weekly)
   ▼                                                      │
eve agent ─────────────────────────────────────────────────┘
   ├─ read_feedback         → the reader's comment (untrusted) + has it been handled?
   ├─ read_article          → fetch the article body (plain GROQ, no AI credits)
   ├─ stage_article_edit    → revise the article's DRAFT via a schema-aware Agent Action
   ├─ mark_feedback_handled → record the outcome on the feedback (idempotency + trail)
   ├─ find_recent_feedback  → GROQ list of unhandled feedback (cron sweep)
   └─ post_to_slack         → "Doc X got feedback; draft ready to review"
Editor opens the draft in Studio → approves & publishes   (human-in-the-loop)
```

The agent writes to **drafts only**, via a schema-aware Sanity [Agent Action](https://www.sanity.io/docs/agent-actions/transform-quickstart)
(`transform`). Agent Actions never mutate a published document by default: pass the published
`_id` and the edit lands on the draft (created from the published version if needed). The
editor's review is the approval gate. Each feedback item is marked handled when done, so retries
and the weekly sweep never double-process it.

## Security model

This agent is triggered by **untrusted reader input** (the feedback comment), so the capability
surface is deliberately small:

- **Locked-down tools.** eve ships shell/filesystem/network tools (`bash`, `read_file`,
  `write_file`, `glob`, `grep`, `web_fetch`, `web_search`) to every agent by default. This
  template disables all of them (`agent/tools/<name>.ts` exporting `disableTool()`). The agent's
  entire effect is its five authored tools: read feedback, read an article, stage a draft, mark
  feedback handled, post to Slack. There is **no publish, no delete, no shell**. The worst a
  malicious comment can do is produce a draft a human then reviews.
- **Untrusted input stays data.** The Function passes only the feedback `_id`; the agent reads
  the comment via `read_feedback`, and `instructions.md` tells it to treat the comment as data,
  never as instructions.
- **Going further:** scope the Sanity token so its role can't publish at all (defense in depth),
  and re-enable `web_search` only if you want the agent to fact-check (delete
  `agent/tools/web_search.ts`).
- **Provenance for free:** name the token after the agent (e.g. "docs-feedback agent"). Every
  draft it stages is then attributed to that identity in Sanity's document history, with no
  in-body marker needed.

## Content model it expects

The agent assumes two document types. Adapt the field names in `agent/lib` + the tools if yours
differ. It's plain GROQ and one patch, no configuration layer:

```ts
// article: the documentation you're improving
defineType({
  name: "article",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string" }),
    defineField({ name: "content", type: "array", of: [{ type: "block" }, /* … */] }), // Portable Text
  ],
})

// feedback: a reader's note about an article
defineType({
  name: "feedback",
  type: "document",
  fields: [
    defineField({ name: "article", type: "reference", to: [{ type: "article" }], weak: true }),
    defineField({ name: "comment", type: "text" }),
    defineField({ name: "rating", type: "number" }),         // optional
    // ── written by the agent (readOnly in the form; the API token still writes them) ──
    defineField({ name: "handledAt", type: "datetime", readOnly: true }),    // set = handled
    defineField({ name: "outcome", type: "string", readOnly: true }),        // "edited" | "skipped"
    defineField({ name: "outcomeNote", type: "string", readOnly: true }),    // why, when skipped
  ],
})
```

## Project layout

```
agent/
  agent.ts                       # eve orchestrator model
  instructions.md                # the ops policy (propose, never publish)
  lib/sanity.ts                  # shared @sanity/client factory (one place to configure)
  tools/read_feedback.ts         # read a feedback doc (comment is untrusted; handledAt guard)
  tools/read_article.ts          # GROQ read of the article body (no AI credits)
  tools/stage_article_edit.ts    # stage the fix as a draft (Sanity Agent Action: transform)
  tools/mark_feedback_handled.ts # record outcome on the feedback (idempotency + trail)
  tools/find_recent_feedback.ts  # GROQ read of unhandled feedback (no AI credits)
  tools/post_to_slack.ts         # actionable Slack notice (incoming webhook)
  tools/{bash,read_file,write_file,glob,grep,web_fetch,web_search}.ts  # disableTool(); see Security model
  schedules/weekly-feedback-sweep.ts
sanity/
  sanity.blueprint.ts            # the Function trigger (deploy with the Sanity CLI)
  functions/on-feedback/index.ts # pokes the eve agent on new feedback
```

## Setup

1. `cp .env.example .env.local` and fill it in. You need a project **Editor** token (reads
   content, writes drafts), your project ID + dataset, your deployed **schema id**
   (`SANITY_SCHEMA_ID`, from `npx sanity schema list`, which Agent Actions need), Slack (a Vercel
   Connect connector for production, or a webhook for local dev; see [Slack](#slack)), and a
   model credential (`AI_GATEWAY_API_KEY` or `npx eve link`). For the "Review draft in Studio"
   button, set `SANITY_ORG_ID` + `SANITY_STUDIO_APP_ID` (both in your Studio's `sanity.cli.ts`).
2. `npm install`
3. Create a **`feedback` document** in Studio referencing an article (or seed one however you
   like), then `npm run dev` (the eve dev TUI) and give the agent its `_id`:
   *"New reader feedback to handle. Feedback document _id: '&lt;feedback-id&gt;'."*

## Test it locally

No deploy needed. Both halves run on your machine:

1. **The agent:** `npm run dev` (eve dev TUI), or POST to its HTTP API with a feedback `_id`:
   ```bash
   curl -X POST http://127.0.0.1:2000/eve/v1/session -H 'content-type: application/json' \
     -d '{"message":"New reader feedback to handle. Feedback document _id: \"<feedback-id>\"."}'
   ```
2. **The function → agent chain:** with `eve dev` running, point the function at the local
   agent and use Sanity's local function testing (it runs on your machine, so it *can* reach
   localhost):
   ```bash
   cd sanity
   EVE_AGENT_URL=http://127.0.0.1:2000 npx sanity@latest functions test on-feedback \
     --document-id <a feedback _id> --project-id <projectId> --dataset <dataset>
   # or an interactive playground:
   EVE_AGENT_URL=http://127.0.0.1:2000 npx sanity@latest functions dev
   ```
   `context.local` is `true` during local tests. Use it to guard real writes if you extend
   the function to mutate content directly.

## Triggers

- **Event (primary):** deploy the Sanity Function, then give it the agent's URL and the shared
  secret (env vars live per-function, set after the first deploy):
  ```bash
  cd sanity
  npx sanity@latest blueprints deploy
  npx sanity functions env add on-feedback EVE_AGENT_URL https://your-agent.vercel.app
  npx sanity functions env add on-feedback EVE_TRIGGER_SECRET "<the same secret as the agent>"
  ```
  It fires on new `feedback`, passes the feedback `_id`, and POSTs to the agent's
  `/eve/v1/session` with a `Bearer ${EVE_TRIGGER_SECRET}` header, failing (so Sanity retries)
  if the agent rejects it.
- **Cron (backstop):** `agent/schedules/weekly-feedback-sweep.ts` sweeps unaddressed feedback
  weekly. (`eve dev` never fires schedules; a deployed `eve start` does.)

## Deploy

`npx eve link` then `npx eve deploy` ships the agent to Vercel; set the same env there
(including a strong `EVE_TRIGGER_SECRET`). Auth is already wired: `agent/channels/eve.ts`
ships a `triggerSecret()` verifier that accepts `Authorization: Bearer ${EVE_TRIGGER_SECRET}`
and falls through to `localDev()` / `vercelOidc()`, so unauthenticated callers get 401. See
eve's [auth & route protection](https://eve.dev/docs/guides/auth-and-route-protection) guide.

## Slack

In production the agent posts through a Slack app that **Vercel Connect** provisions and
installs for you, so there are no Slack secrets to manage. Create the connector once,
then set its UID and a target channel:

```bash
npm i -g vercel@latest && export FF_CONNECT_ENABLED=1
vercel connect create slack            # walks through installing the Slack app
# set on the Vercel project:
#   SLACK_CONNECTOR = the connector UID it prints (e.g. slack/my-agent)
#   SLACK_CHANNEL   = the channel id to post to (invite the app to that channel)
```

`post_to_slack` requests an app-scoped bot token from Connect at runtime and calls
`chat.postMessage`. For **local dev**, Connect needs the project's Vercel OIDC identity, which
`eve dev` doesn't have, so set `SLACK_WEBHOOK_URL` in `.env.local` and the tool posts through the
webhook for local runs. Leave it blank in production.

## Extend

- **Richer context:** give the agent related content to reason over. Cheapest first: GROQ
  references (`*[references($id)]`), then keyword `score()`/`text::match`, then
  [Sanity Context](https://www.sanity.io/docs/ai/sanity-context) for schema-aware semantic
  search. See the comment in `tools/read_article.ts`.
- **Batch review (Enterprise):** stage fixes into a Content Release so a week of fixes lands in
  one reviewable release.
- **More checks:** broaden the agent's policy (broken links, missing alt text, SEO).
- **More surfaces:** add other eve channels (Discord, Linear) for notices.
- **Conversational Slack:** the agent posts notices but doesn't listen. To also answer
  `@mentions` and DMs, add eve's [`slackChannel`](https://eve.dev/docs/channels/slack) (it
  reuses the same Connect connector). That turns the notifier into a two-way assistant.
