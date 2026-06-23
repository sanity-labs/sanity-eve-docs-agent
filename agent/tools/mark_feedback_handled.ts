import { defineTool } from "eve/tools";
import { z } from "zod";
import { sanityClient } from "../lib/sanity.js";

// Close the loop: record on the feedback document that the agent dealt with it. This stops the
// weekly sweep from re-processing it and gives editors a feedback -> draft trail. Feedback is
// operational metadata, not editorial content, so we write the fields directly (no draft cycle).
export default defineTool({
  description:
    "Mark a feedback item as handled so it is not processed again. Use outcome 'edited' when " +
    "you staged a fix, or 'skipped' with a short reason when you did not.",
  inputSchema: z.object({
    feedbackId: z.string().describe("The _id of the feedback document"),
    outcome: z.enum(["edited", "skipped"]).describe("Whether you staged a draft or skipped"),
    note: z.string().optional().describe("A short reason (when outcome is 'skipped')"),
  }),
  async execute({ feedbackId, outcome, note }) {
    const client = sanityClient();
    await client
      .patch(feedbackId)
      .set({
        handledAt: new Date().toISOString(),
        outcome,
        ...(note ? { outcomeNote: note } : {}),
      })
      .commit();
    return { ok: true, feedbackId, outcome };
  },
});
