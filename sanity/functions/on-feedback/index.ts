import { documentEventHandler } from "@sanity/functions";

// Thin trigger: when reader feedback is created, poke the eve agent to handle it. The agent
// does the work; this just starts it. We pass only the feedback document _id — the agent reads
// the (untrusted) comment itself via its read_feedback tool, so reader text never enters this
// prompt as instructions.
export const handler = documentEventHandler(async ({ event }) => {
  const data = event.data as { _id?: string };
  const feedbackId = data._id;
  if (!feedbackId) return;

  const agentUrl = process.env.EVE_AGENT_URL; // your deployed eve agent, e.g. https://my-agent.vercel.app
  const secret = process.env.EVE_TRIGGER_SECRET;
  if (!agentUrl || !secret) {
    throw new Error("EVE_AGENT_URL and EVE_TRIGGER_SECRET must be set on the function.");
  }

  const res = await fetch(`${agentUrl}/eve/v1/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      message: `New reader feedback to handle. Feedback document _id: "${feedbackId}".`,
    }),
  });

  // Surface a rejected trigger (bad secret, agent down) so Sanity retries instead of silently
  // marking this run successful. The agent runs asynchronously; a 2xx means it accepted the job.
  if (!res.ok) {
    throw new Error(`Agent rejected the trigger: ${res.status} ${await res.text()}`);
  }
});
