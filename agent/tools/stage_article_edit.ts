import { defineTool } from "eve/tools";
import { z } from "zod";
import { sanityClient } from "../lib/sanity.js";

// Build the "Review draft in Studio" deep link. For a Sanity dashboard Studio, construct it from
// the org id + app id (both written into your Studio's sanity.cli.ts on `sanity deploy`); the
// workspace defaults to "default". SANITY_STUDIO_URL overrides with an explicit base (e.g. a
// custom-domain Studio). The Slack notice omits the button when none of these are set.
function reviewUrlFor(id: string, type: string): string | undefined {
  const override = process.env.SANITY_STUDIO_URL?.replace(/\/$/, "");
  const org = process.env.SANITY_ORG_ID;
  const appId = process.env.SANITY_STUDIO_APP_ID;
  const base =
    override ??
    (org && appId
      ? `https://www.sanity.io/@${org}/studio/${appId}/${process.env.SANITY_STUDIO_WORKSPACE ?? "default"}`
      : undefined);
  return base ? `${base}/intent/edit/id=${id};type=${type}` : undefined;
}

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

    return {
      draftId: result._id ?? `drafts.${articleId}`,
      articleTitle: result.title ?? articleId,
      reviewUrl: reviewUrlFor(articleId, result._type ?? "article"),
    };
  },
});
