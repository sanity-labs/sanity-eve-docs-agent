import { defineTool } from "eve/tools";
import { z } from "zod";

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default defineTool({
  description:
    "Post a rich, actionable review notice to Slack: the article, the reader feedback, what " +
    "changed, and a button that opens the content release in Sanity Studio.",
  inputSchema: z.object({
    articleTitle: z.string().describe("Title of the article that was revised"),
    feedback: z.string().describe("The reader feedback, briefly"),
    summary: z.string().describe("What the agent changed"),
    reviewUrl: z
      .string()
      .optional()
      .describe("URL that opens the content release in Studio (from revise_article)"),
  }),
  async execute({ articleTitle, feedback, summary, reviewUrl }) {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      throw new Error("SLACK_WEBHOOK_URL is not set. See .env.example.");
    }

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
            text: { type: "plain_text", text: "Review release in Studio", emoji: true },
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
          text: "Proposed by an eve agent · staged in a content release, never auto-published",
        },
      ],
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `text` is the notification/accessibility fallback for the rich blocks.
      body: JSON.stringify({ text: `Docs fix ready to review: ${articleTitle}`, blocks }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
    }
    return { posted: true };
  },
});
