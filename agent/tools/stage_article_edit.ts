import { defineTool } from "eve/tools";
import { z } from "zod";
import { sanityClient } from "../lib/sanity.js";

// Deterministic write: stage the agent's proposed note as a DRAFT, never published.
// Uses the Sanity document Actions API (`sanity.action.document.edit`): it creates the draft
// from the published version if one doesn't exist, then applies a patch — so the edit always
// lands on the *exact* article, as its draft. The editor reviews and publishes in Studio.
const HEX = "0123456789abcdef";
const randomKey = () =>
  Array.from({ length: 12 }, () => HEX[Math.floor(Math.random() * 16)]).join("");

export default defineTool({
  description:
    "Stage a documentation fix as a DRAFT for human review. Inserts the note you composed as " +
    "a new paragraph in the article's content and saves it to the article's draft. Never " +
    "publishes. Returns the article title and a Studio review URL.",
  inputSchema: z.object({
    articleId: z.string().describe("The _id of the published article to fix"),
    note: z
      .string()
      .describe("The paragraph to add, addressing the feedback. Plain text, the article's voice."),
    placement: z
      .enum(["top", "bottom"])
      .default("top")
      .describe("Where to insert the note in the article body"),
  }),
  async execute({ articleId, note, placement }) {
    const client = sanityClient();

    const article = await client.getDocument(articleId);
    if (!article) throw new Error(`Article ${articleId} not found`);

    const block = {
      _type: "block",
      _key: randomKey(),
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: randomKey(), marks: [], text: note }],
    };

    const hasContent = Array.isArray(article.content) && article.content.length > 0;
    const patch = hasContent
      ? {
          insert:
            placement === "bottom"
              ? { after: "content[-1]", items: [block] }
              : { before: "content[0]", items: [block] },
        }
      : { set: { content: [block] } };

    await client.action({
      actionType: "sanity.action.document.edit",
      draftId: `drafts.${articleId}`,
      publishedId: articleId,
      patch,
    });

    // The "Review draft in Studio" button. Set SANITY_STUDIO_URL to your deployed Studio;
    // if it's unset the Slack notice just omits the button.
    const studioUrl = process.env.SANITY_STUDIO_URL?.replace(/\/$/, "");
    const reviewUrl = studioUrl
      ? `${studioUrl}/intent/edit/id=${articleId};type=${article._type}`
      : undefined;

    return {
      draftId: `drafts.${articleId}`,
      articleTitle: (article.title as string) ?? articleId,
      reviewUrl,
    };
  },
});
