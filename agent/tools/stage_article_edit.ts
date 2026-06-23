import { defineTool } from "eve/tools";
import { z } from "zod";
import { sanityClient } from "../lib/sanity.js";

// Stage a fix as a DRAFT via a Sanity Agent Action (transform). Agent Actions are schema-aware
// and, by default, never mutate a published document: passing the published _id creates (or
// reuses) the draft and writes there, so the editor's review in Studio stays the publish gate.
// The model supplies a precise, scoped instruction; Sanity's AI applies it to the article body.
export default defineTool({
  description:
    "Stage a documentation fix as a DRAFT for human review. Runs a schema-aware Sanity Agent " +
    "Action (transform) that revises the article's body to address the feedback, writing to the " +
    "draft only (never the published document). Pass a precise, scoped instruction. Returns the " +
    "article title and a Studio review URL.",
  inputSchema: z.object({
    articleId: z.string().describe("The _id of the published article to fix"),
    instruction: z
      .string()
      .describe(
        "A precise, scoped instruction for the edit, e.g. \"Near the setup steps, add a short " +
          "note that Node.js 22 or newer is required.\" Address only the feedback; keep the " +
          "author's voice; change nothing unrelated.",
      ),
  }),
  async execute({ articleId, instruction }) {
    const schemaId = process.env.SANITY_SCHEMA_ID;
    if (!schemaId) {
      throw new Error(
        "SANITY_SCHEMA_ID is not set (get it from `npx sanity schema list`). See .env.example.",
      );
    }

    // Agent Actions require apiVersion "vX".
    const client = sanityClient().withConfig({ apiVersion: "vX" });
    const result = (await client.agent.action.transform({
      schemaId,
      documentId: articleId, // published id → Agent Actions write to the draft, never publish
      instruction,
      target: [{ path: "content" }], // only touch the article body, not title/slug/etc.
    })) as { _id?: string; _type?: string; title?: string };

    // The "Review draft in Studio" button. Set SANITY_STUDIO_URL to your deployed Studio;
    // if it's unset the Slack notice just omits the button.
    const studioUrl = process.env.SANITY_STUDIO_URL?.replace(/\/$/, "");
    const reviewUrl = studioUrl
      ? `${studioUrl}/intent/edit/id=${articleId};type=${result._type ?? "article"}`
      : undefined;

    return {
      draftId: result._id ?? `drafts.${articleId}`,
      articleTitle: result.title ?? articleId,
      reviewUrl,
    };
  },
});
