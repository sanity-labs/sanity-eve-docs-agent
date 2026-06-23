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

    // Posts via the Slack app that Vercel Connect provisions (`vercel connect create slack`).
    // Connect brokers an app-scoped bot token at runtime from the project's Vercel OIDC identity,
    // so there's no token to store. Locally, run `vercel env pull` so eve dev has a VERCEL_OIDC_TOKEN.
    const connector = process.env.SLACK_CONNECTOR;
    const channel = process.env.SLACK_CHANNEL;
    if (!connector || !channel) {
      throw new Error(
        "Set SLACK_CONNECTOR and SLACK_CHANNEL. Create the Slack app with `vercel connect create slack`. See .env.example.",
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
    return { posted: true };
  },
});
