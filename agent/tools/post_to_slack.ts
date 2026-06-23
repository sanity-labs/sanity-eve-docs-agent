import { defineTool } from "eve/tools";
import { z } from "zod";
import { getToken } from "@vercel/connect";

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default defineTool({
  description:
    "Post a rich, actionable review notice to Slack: the article, the reader feedback, what " +
    "changed, and a button that opens the draft in Sanity Studio.",
  inputSchema: z.object({
    articleTitle: z.string().describe("Title of the article that was revised"),
    feedback: z.string().describe("The reader feedback, briefly"),
    summary: z.string().describe("What the agent changed"),
    reviewUrl: z
      .string()
      .optional()
      .describe("URL that opens the draft in Studio (from stage_article_edit)"),
  }),
  async execute({ articleTitle, feedback, summary, reviewUrl }) {
    const blocks: Array<Record<string, unknown>> = [
      {
        type: "header",
        text: { type: "plain_text", text: "📝 Docs fix ready to review", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Article*\n${articleTitle}` },
          { type: "mrkdwn", text: `*Reader feedback*\n${truncate(feedback, 280)}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*What the agent changed*\n${truncate(summary, 600)}` },
      },
    ];
    if (reviewUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Review draft in Studio", emoji: true },
            url: reviewUrl,
            style: "primary",
          },
        ],
      });
    }
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Proposed by an eve agent · staged as a draft, never auto-published",
        },
      ],
    });
    // `text` is the notification/accessibility fallback for the rich blocks.
    const text = `Docs fix ready to review: ${articleTitle}`;

    // Local-dev fallback: an incoming webhook works in `eve dev` with no Vercel Connect / OIDC.
    // If it's set, use it. (The template's default is the Connect path below.)
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, blocks }),
      });
      if (!res.ok) throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
      return { posted: true, via: "webhook" };
    }

    // Default: post via the Slack app that Vercel Connect provisions at deploy
    // (`vercel connect create slack`). Connect brokers an app-scoped bot token at runtime,
    // so there's no webhook URL or bot token to manage. Needs a target channel.
    const connector = process.env.SLACK_CONNECTOR;
    const channel = process.env.SLACK_CHANNEL;
    if (!connector || !channel) {
      throw new Error(
        "Set SLACK_CONNECTOR and SLACK_CHANNEL (or SLACK_WEBHOOK_URL for local dev). See .env.example.",
      );
    }
    const botToken = await getToken(connector, { subject: { type: "app" } });
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel, text, blocks }),
    });
    // Slack returns HTTP 200 with `{ ok: false, error }` on failure, so check the body.
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      throw new Error(`Slack chat.postMessage failed: ${body.error ?? res.status}`);
    }
    return { posted: true, via: "connect" };
  },
});
