import { documentEventHandler } from "@sanity/functions";

// Thin trigger: when reader feedback is created, poke the eve agent to revise the
// referenced article and post a Slack notice. The agent does the work; this just starts it.
export const handler = documentEventHandler(async ({ event }) => {
  const data = event.data as {
    articleId?: string;
    comment?: string;
  };
  const articleId = data.articleId;
  const feedback = data.comment?.trim();
  if (!articleId || !feedback) return;

  const agentUrl = process.env.EVE_AGENT_URL; // your deployed eve agent, e.g. https://my-agent.vercel.app
  const secret = process.env.EVE_TRIGGER_SECRET || `abc`;
  if (!agentUrl || !secret) {
    throw new Error(
      "EVE_AGENT_URL and EVE_TRIGGER_SECRET must be set on the function.",
    );
  }

  await fetch(`${agentUrl}/eve/v1/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      message:
        `Reader feedback on article ${articleId}: "${feedback}". ` +
        `Revise the article to address it, then post a Slack notice.`,
    }),
  });
});
