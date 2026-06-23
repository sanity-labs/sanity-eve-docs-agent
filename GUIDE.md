# Build an autonomous docs-feedback agent with Sanity and eve

Reader feedback on documentation piles up faster than anyone triages it. Someone flags that a page is missing a step, the note lands in a queue, and weeks later the page still has the gap. This guide builds an agent that closes that loop: when a reader leaves feedback on a docs article, the agent reads the article, drafts a fix, stages it as a draft (never published), and posts a Slack notice with a button to review it in Sanity Studio. It runs on [eve](https://eve.dev), Vercel's durable agent runtime, triggered by a [Sanity Function](https://www.sanity.io/docs/functions) on every new feedback and a weekly cron as a backstop. A human always approves before anything goes live.

This pattern adapts to other content operations too. You can apply it anywhere an agent reacts to a trigger and stages a content update for review (broken-link sweeps, freshness audits, metadata backfills).

## Prerequisites

- Node.js 22 or newer.
- A [Sanity](https://www.sanity.io) project with a deployed Studio, an `article` type (with a Portable Text body) and a `feedback` type (shape below).
- A Sanity API token with the **Editor** role: it reads content and writes drafts.
- A Slack workspace where you can install an app. Vercel Connect sets up the Slack app for you
  at deploy (step 7), and it works locally too (run `vercel env pull` first).
- A model credential for eve: an `AI_GATEWAY_API_KEY`, or run `npx eve link`.

## How it works

```
Reader leaves feedback
   │
   │  Sanity Function (on create) → passes the feedback _id      eve cron (weekly)
   │                                                                 │
   ▼                                                                 │
   eve agent ◀︎───────────────────────────────────────────────────────┘
   read_feedback → read_article → stage_article_edit (DRAFT) →
   mark_feedback_handled → post_to_slack
   │
   ▼
Editor reviews the draft in Studio → publishes
```

The agent runs on event triggers and on a schedule. It stages every change as a draft via a schema-aware Sanity Agent Action, so an editor reviews and publishes; nothing goes live without a human. Each feedback item is marked handled when it's done, so a Function retry or the weekly sweep never processes it twice. Sanity handles the content and triggers the agent when feedback comes in; eve handles the durable runs, orchestrating notices to Slack (or any other connection) and which tools the agent can use. From here you can extend it toward broader content audits.

## Steps

### 1. Clone the template and install

```bash
git clone https://github.com/sanity-labs/sanity-eve-docs-agent
cd sanity-eve-docs-agent
npm install
```

The repo is a complete eve agent: tools in `agent/tools/`, the operating policy in `agent/instructions.md`, the model in `agent/agent.ts`, the Slack channel and auth in `agent/channels/eve.ts`, and the Sanity Function trigger under `sanity/`.

This guide assumes you have an existing Sanity project. If you don't and want to try it anyway, install the [Sanity MCP](https://www.sanity.io/docs/ai/mcp-server) in your agent harness, point it at this guide, and ask it to create a project with the content model below plus some example documentation.

### 2. Add the content model

The agent works against two document types. Add them to your Studio schema. If your field names differ, change the GROQ in the read tools and the patch in `stage_article_edit`. It's plain GROQ and one patch, with no configuration layer to learn.

```ts title="schemaTypes/article.ts"
defineType({
  name: "article",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string" }),
    defineField({ name: "content", type: "array", of: [{ type: "block" }] }), // Portable Text
  ],
})
```

```ts title="schemaTypes/feedback.ts"
defineType({
  name: "feedback",
  type: "document",
  fields: [
    defineField({ name: "article", type: "reference", to: [{ type: "article" }], weak: true }),
    defineField({ name: "comment", type: "text" }),
    defineField({ name: "rating", type: "number" }),      // optional
    // Written by the agent (readOnly in the form; the API token still writes them):
    defineField({ name: "handledAt", type: "datetime", readOnly: true }), // set = handled
    defineField({ name: "outcome", type: "string", readOnly: true }),     // "edited" | "skipped"
    defineField({ name: "outcomeNote", type: "string", readOnly: true }), // why, when skipped
  ],
})
```

Deploy the Studio so the schema is live: `npx sanity deploy`. Two things from this for the next step: grab the schema id with `npx sanity schema list` (`SANITY_SCHEMA_ID`, for Agent Actions), and note the Studio app id `sanity deploy` writes into `sanity.cli.ts` (`SANITY_STUDIO_APP_ID`, for the review-button link).

### 3. Configure environment variables

With a project in place, point the agent at it:

```bash
cp .env.example .env.local
```

```bash title=".env.local"
SANITY_STUDIO_PROJECT_ID=your-project-id
SANITY_STUDIO_DATASET=production
SANITY_API_WRITE_TOKEN=your-editor-token
SANITY_SCHEMA_ID=sanity.workspace.schema.default       # from `npx sanity schema list` (for Agent Actions)
SANITY_ORG_ID=oSyH1iET5                                # review button: org id + app id (both in sanity.cli.ts)
SANITY_STUDIO_APP_ID=your-studio-app-id                # the studio app id, added on `sanity deploy`
SLACK_CONNECTOR=slack/your-agent                       # Slack app via Vercel Connect (set up in step 7)
SLACK_CHANNEL=C0123456789                              # channel to post to (invite the app to it)
AI_GATEWAY_API_KEY=your-gateway-key                    # or run `npx eve link`
EVE_TRIGGER_SECRET=a-long-random-string                # the Function authenticates with this
```

Name the token after the agent (for example, "docs-feedback agent"). Sanity's document history then attributes every staged draft to that identity, so provenance is clear without marking the content itself.

### 4. Run it locally

```bash
npm run dev
```

This opens the eve dev TUI. Create a `feedback` document in Studio that references an article, then give the agent its `_id`:

> New reader feedback to handle. Feedback document _id: "&lt;feedback-id&gt;".

You'll see the agent call `read_feedback`, `read_article`, `stage_article_edit`, `mark_feedback_handled`, then `post_to_slack`. Open the draft from the Slack button to review it. (Slack posting goes through Vercel Connect: the connector from step 7, plus `vercel env pull` for a local `VERCEL_OIDC_TOKEN`. The draft staging and feedback-handling work without it.) To exercise the real trigger path on your machine, use Sanity's local function testing, pointing `EVE_AGENT_URL` at the address `eve dev` printed on boot (`http://127.0.0.1:2000` by default):

```bash title="Terminal"
cd sanity
EVE_AGENT_URL=http://127.0.0.1:2000 npx sanity@latest functions test on-feedback \
  --document-id <a feedback _id> --project-id <projectId> --dataset <dataset>
```

### 5. The write is a schema-aware Agent Action, scoped to the draft

The agent doesn't hand-write Portable Text. It composes a precise instruction, and `stage_article_edit` runs a Sanity [Agent Action](https://www.sanity.io/docs/agent-actions/transform-quickstart) (`transform`) that revises the article's body for it. Agent Actions are schema-aware, so the edit is valid content in the right place, and by default they **never mutate a published document**: pass the published `_id` and the action writes to the draft (creating it from the published version, or reusing an existing draft).

```ts title="agent/tools/stage_article_edit.ts"
await client.withConfig({ apiVersion: "vX" }).agent.action.transform({
  schemaId: process.env.SANITY_SCHEMA_ID, // from `npx sanity schema list`
  documentId: articleId,                  // published id → writes to the draft, never publishes
  instruction,                            // the scoped instruction the agent composed
  target: [{ path: "content" }],          // only the article body, not title/slug
});
```

The exact document gets the edit, the change lands as a draft for a human to review, and the model can't write to the wrong place or publish on its own. Agent Actions are an experimental API (`apiVersion: "vX"`, subject to change), so pin it and watch the changelog.

### 6. Lock the agent down

This agent is triggered by untrusted reader input, so its capability surface is deliberately small. eve ships shell, filesystem, and network tools (`bash`, `read_file`, `write_file`, `glob`, `grep`, `web_fetch`, `web_search`) to every agent by default. The template disables the ones it doesn't need by exporting a sentinel from a file named after each tool:

```ts title="agent/tools/bash.ts"
import { disableTool } from "eve/tools";

export default disableTool();
```

What's left is the five authored tools: read feedback, read an article, stage a draft, mark feedback handled, post to Slack. There's no publish, no delete, no shell, so the worst a malicious comment can do is produce a draft a human then reviews. Two more guards back this up: the Function passes only the feedback `_id` (the agent reads the comment itself), and `instructions.md` tells the agent to treat the comment as data describing a problem, never as instructions to follow.

### 7. Deploy to Vercel

```bash
npx eve link
npx eve deploy
```

Set the same environment variables in the Vercel project, including a strong `EVE_TRIGGER_SECRET`. Auth is already wired. `agent/channels/eve.ts` ships a verifier that accepts `Authorization: Bearer ${EVE_TRIGGER_SECRET}`, falls through to local and Vercel-internal callers, and returns 401 to everyone else:

```ts title="agent/channels/eve.ts"
export default eveChannel({
  auth: [triggerSecret(), localDev(), vercelOidc()],
});
```

Then set up Slack with **Vercel Connect**. Connect installs the Slack app in your workspace and brokers the bot token at runtime, so there's nothing to copy and paste:

```bash title="Terminal"
export FF_CONNECT_ENABLED=1
vercel connect create slack   # walks through installing the Slack app
```

Set the connector UID it prints as `SLACK_CONNECTOR` and a target channel id as `SLACK_CHANNEL` on the Vercel project, and invite the app to that channel. `post_to_slack` requests an app-scoped token from Connect and calls `chat.postMessage`.

### 8. Wire the Sanity Function trigger

Deploy the Function, then give it the agent's URL and the shared secret (Function environment variables are set per function, after the first deploy):

```bash title="Terminal"
cd sanity
npx sanity@latest blueprints deploy
npx sanity functions env add on-feedback EVE_AGENT_URL https://your-agent.vercel.app
npx sanity functions env add on-feedback EVE_TRIGGER_SECRET "the same secret as the agent"
```

New feedback now fires the agent. If a trigger is rejected (wrong secret, agent down), the Function throws so Sanity retries instead of failing silently. Watch it with `npx sanity functions logs on-feedback`, and check the run in eve's dashboard or your Vercel logs. The weekly cron sweep in `agent/schedules/weekly-feedback-sweep.ts` is the backstop for anything the event path missed.

## How to give the agent more context, or send it elsewhere

- **Richer context.** Let the agent reason over related content, cheapest first: GROQ references (`*[references($id)]`), then keyword ranking with `score()` and `text::match`, then [Sanity Context](https://www.sanity.io/docs/ai/sanity-context) for schema-aware semantic search. See the comment in `agent/tools/read_article.ts`.
- **Fact-checking.** Delete `agent/tools/web_search.ts` to let the agent verify claims on the web before drafting. It's off by default so unverified facts don't land in your docs.
- **Batch review.** On an Enterprise plan, stage fixes into a [Content Release](https://www.sanity.io/docs/content-releases) so a week of fixes reviews as one set.
- **More surfaces.** Add other eve channels (Discord, Linear) for notices, or adopt eve's conversational `slackChannel` (same Connect connector) for interactive buttons and threaded replies.

## Related resources

- [eve documentation](https://eve.dev/docs)
- [Sanity Functions](https://www.sanity.io/docs/functions)
- [Sanity document Actions API](https://reference.sanity.io/_sanity/client/#actions)
- [Sanity Context](https://www.sanity.io/docs/ai/sanity-context)
