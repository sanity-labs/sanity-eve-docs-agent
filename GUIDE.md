# Build an autonomous docs-feedback agent with Sanity and eve

Reader feedback on documentation piles up faster than anyone triages it. Someone flags that a page is missing a step, the note lands in a queue, and weeks later the page still has the gap. This guide builds an agent that closes that loop: when a reader leaves feedback on a docs article, the agent reads the article, drafts a fix, stages it as a draft (never published), and posts a Slack notice with a button to review it in Sanity Studio. It runs on [eve](https://eve.dev), Vercel's durable agent runtime, triggered by a [Sanity Function](https://www.sanity.io/docs/functions) on every new feedback and a weekly cron as a backstop. A human always approves before anything goes live.

## Prerequisites

- Node.js 20 or newer.
- A [Sanity](https://www.sanity.io) project with a deployed Studio, an `article` type (with a Portable Text body) and a `feedback` type (shape below).
- A Sanity API token with the **Editor** role: it reads content and writes drafts.
- A [Slack incoming webhook](https://api.slack.com/messaging/webhooks) URL.
- A model credential for eve: an `AI_GATEWAY_API_KEY`, or run `npx eve link`.

## How it works

```
Reader leaves feedback
   │  Sanity Function (on create) → passes the feedback _id      eve cron (weekly)
   ▼                                                                   │
eve agent ───────────────────────────────────────────────────────────┘
   read_feedback → read_article → stage_article_edit (DRAFT) →
   mark_feedback_handled → post_to_slack
Editor reviews the draft in Studio → publishes
```

The agent never publishes. It stages every change as a draft through the Sanity document Actions API, so the editor's review is the approval gate. Each feedback item is marked handled when it's done, so a Function retry or the weekly sweep never processes it twice. eve gives you the parts a plain script can't: durable runs, the Function and cron triggers, the Slack channel, and one-command deploy to Vercel.

## Steps

### 1. Clone the template and install

```bash
git clone https://github.com/sanity-labs/sanity-eve-docs-agent
cd sanity-eve-docs-agent
npm install
```

The repo is a complete eve agent: tools in `agent/tools/`, the operating policy in `agent/instructions.md`, the model in `agent/agent.ts`, the Slack channel and auth in `agent/channels/eve.ts`, and the Sanity Function trigger under `sanity/`.

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
    defineField({ name: "article", type: "reference", to: [{ type: "article" }] }),
    defineField({ name: "comment", type: "text" }),
    defineField({ name: "rating", type: "number" }),      // optional
    // Written by the agent. You don't author these in the form:
    defineField({ name: "handledAt", type: "datetime" }), // set = handled
    defineField({ name: "outcome", type: "string" }),     // "edited" | "skipped"
    defineField({ name: "outcomeNote", type: "string" }), // why, when skipped
    defineField({ name: "draftId", type: "string" }),     // the staged draft, when edited
  ],
})
```

Deploy the Studio so the schema is live: `npx sanity deploy`.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

```bash title=".env.local"
SANITY_STUDIO_PROJECT_ID=your-project-id
SANITY_STUDIO_DATASET=production
SANITY_API_WRITE_TOKEN=your-editor-token
SANITY_STUDIO_URL=https://your-studio.sanity.studio   # optional, for the review button
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
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

You'll see the agent call `read_feedback`, `read_article`, `stage_article_edit`, `mark_feedback_handled`, then `post_to_slack`. Open the draft from the Slack button to review it. To exercise the real trigger path on your machine, use Sanity's local function testing, pointing `EVE_AGENT_URL` at the address `eve dev` printed on boot (`http://127.0.0.1:2000` by default):

```bash title="Terminal"
cd sanity
EVE_AGENT_URL=http://127.0.0.1:2000 npx sanity@latest functions test on-feedback \
  --document-id <a feedback _id> --project-id <projectId> --dataset <dataset>
```

### 5. The write is deterministic, not free-form

The model decides *what* to add. The tool decides *how* it's written. `stage_article_edit` takes the paragraph the agent composed and applies it with a single document action, against the exact article, as its draft:

```ts title="agent/tools/stage_article_edit.ts"
await client.action({
  actionType: "sanity.action.document.edit",
  draftId: `drafts.${articleId}`,
  publishedId: articleId, // creates the draft from the published version if needed
  patch: { insert: { before: "content[0]", items: [block] } },
});
```

The right document gets the edit every time, and the change lands as a draft for a human to review. There's no path for the model to write to the wrong place or publish on its own.

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
- **Batch review.** On an Enterprise plan, stage fixes into a [Content Release](https://www.sanity.io/docs/content-releases) instead of drafts, so a week of fixes reviews as one set.
- **More surfaces.** Add other eve channels (Discord, Linear) for notices, or swap the incoming webhook for a full Slack app to get interactive buttons.

## Related resources

- [eve documentation](https://eve.dev/docs)
- [Sanity Functions](https://www.sanity.io/docs/functions)
- [Sanity document Actions API](https://reference.sanity.io/_sanity/client/#actions)
- [Sanity Context](https://www.sanity.io/docs/ai/sanity-context)
