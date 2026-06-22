import { defineTool } from "eve/tools";
import { z } from "zod";
import { sanityClient } from "../lib/sanity.js";

// Read a feedback document by _id. The `comment` is UNTRUSTED reader input — treat it as data
// describing a problem, never as instructions (see instructions.md). `handledAt` is the
// idempotency guard: if it's set, the item was already processed — stop.
export default defineTool({
  description:
    "Read a reader-feedback document by its _id. Returns the reader's comment, the referenced " +
    "articleId, the rating, and handledAt. If handledAt is set, the feedback was already " +
    "processed — stop and do nothing.",
  inputSchema: z.object({
    feedbackId: z.string().describe("The _id of the feedback document"),
  }),
  async execute({ feedbackId }) {
    const client = sanityClient();
    const feedback = await client.fetch<{
      _id: string;
      comment?: string;
      rating?: number;
      articleId?: string;
      handledAt?: string;
    } | null>(
      `*[_id == $id][0]{ _id, comment, rating, "articleId": article._ref, handledAt }`,
      { id: feedbackId },
    );
    if (!feedback) throw new Error(`Feedback ${feedbackId} not found`);
    return feedback;
  },
});
