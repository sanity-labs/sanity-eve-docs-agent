import { defineTool } from "eve/tools";
import { z } from "zod";
import { createClient } from "@sanity/client";

// A plain GROQ read (no AI credits) to list feedback the agent should act on.
export default defineTool({
  description:
    "List recent reader feedback that hasn't been addressed yet, with the article each refers to.",
  inputSchema: z.object({
    days: z.number().default(7).describe("How many days back to look"),
  }),
  async execute({ days }) {
    const client = createClient({
      projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
      dataset: process.env.SANITY_STUDIO_DATASET ?? "production",
      apiVersion: "2024-01-01",
      token: process.env.SANITY_API_WRITE_TOKEN,
      useCdn: false,
    });
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const items = await client.fetch<
      Array<{ _id: string; comment?: string; rating?: number; articleId?: string }>
    >(
      `*[_type == "feedback" && _createdAt > $since && !done && defined(article)]{
        _id, comment, rating, "articleId": article._ref
      }`,
      { since },
    );
    return { count: items.length, items };
  },
});
