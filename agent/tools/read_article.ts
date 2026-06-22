import { defineTool } from "eve/tools";
import { z } from "zod";
import { sanityClient } from "../lib/sanity.js";

// A plain GROQ read (no AI credits): give the agent the article it's about to revise.
// We already know the exact _id (the feedback references it), so this is a direct fetch —
// no schema exploration or search needed.
//
// Want the agent to reason with *related* content too? There's an enhancement ladder here,
// cheapest first:
//   1. Structural (free, no setup): pull docs linked to/from this one with GROQ references.
//      e.g. add to the projection below:
//        "linkedFrom": *[references(^._id)][0...5]{ _id, title },
//        "linksTo":    content[].markDefs[defined(reference)].reference->{ _id, title }
//   2. Keyword relevance: GROQ score(boost(...)) + text::match for BM25-style ranking.
//   3. Semantic: Sanity Context (the read-only MCP) adds text::semanticSimilarity() over an
//      embeddings index — schema-aware semantic search. Requires turning on embeddings, so
//      it's commented out below:
//        // | score(text::semanticSimilarity("studio setup node version"))
//        // | order(_score desc)
export default defineTool({
  description:
    "Read a documentation article by its _id. Returns the title and the article body as " +
    "plain text so you can understand it before proposing a fix.",
  inputSchema: z.object({
    articleId: z.string().describe("The _id of the article to read"),
  }),
  async execute({ articleId }) {
    const client = sanityClient();
    const article = await client.fetch<{
      _id: string;
      _type: string;
      title?: string;
      text?: string;
    } | null>(
      `*[_id == $id][0]{ _id, _type, title, "text": pt::text(content) }`,
      { id: articleId },
    );
    if (!article) throw new Error(`Article ${articleId} not found`);
    return article;
  },
});
