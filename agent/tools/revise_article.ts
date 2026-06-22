import { defineTool } from "eve/tools";
import { z } from "zod";
import { createContentAgent } from "content-agent";
import { generateText } from "ai";
import { createClient } from "@sanity/client";

// The fix is staged in a Content Release (never published). content-agent writes only to
// versioned/draft docs, so the editor's review of the release is the human-in-the-loop gate.
export default defineTool({
  description:
    "Revise a documentation article from reader feedback. Creates a content release, drafts an " +
    "improved version into it, and returns details (incl. a Studio review URL). Pass the _id.",
  inputSchema: z.object({
    articleId: z.string().describe("The _id of the article document to revise"),
    feedback: z.string().describe("The reader feedback to address"),
  }),
  async execute({ articleId, feedback }) {
    const client = createClient({
      projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
      dataset: process.env.SANITY_STUDIO_DATASET ?? "production",
      apiVersion: "2026-03-01",
      token: process.env.SANITY_API_WRITE_TOKEN,
      useCdn: false,
    });

    const articleTitle: string =
      (await client.fetch(`*[_id == $id][0].title`, { id: articleId })) ?? articleId;
    const releaseTitle = `Docs fix: ${articleTitle}`;

    // 1) Create the release that will hold the proposed fix.
    const { releaseId } = await client.releases.create({
      metadata: { title: releaseTitle, releaseType: "undecided" },
    });

    // 2) content-agent reads the article and writes an improved version INTO the release.
    const contentAgent = createContentAgent({
      organizationId: process.env.SANITY_ORG_ID!,
      token: process.env.SANITY_API_WRITE_TOKEN!,
    });
    const appKey = process.env.SANITY_CONTENT_AGENT_APP_KEY;
    const model = contentAgent.agent(`revise-${articleId}`, {
      ...(appKey ? { application: { key: appKey } } : {}),
      config: {
        capabilities: { read: true, write: true },
        filter: { write: '_type == "article"' },
        perspectives: { write: releaseId }, // writes land in the release, not as a loose draft
      },
    });

    const { text } = await generateText({
      model,
      prompt:
        `Readers left this feedback on article ${articleId}:\n\n"${feedback}"\n\n` +
        `Read the article, then create or update its version in this release to address the ` +
        `feedback. Keep the author's voice and structure. Summarize what you changed in 1-2 sentences.`,
    });

    // Derive the Studio review URL from the deployed app itself (no separate env needed).
    let reviewUrl: string | undefined;
    try {
      const apps = (await contentAgent.applications()) as Array<{
        key: string;
        intentBaseUrl?: string;
        userApplication?: { type?: string };
      }>;
      const app = appKey
        ? apps.find((a) => a.key === appKey)
        : apps.find((a) => a.userApplication?.type === "studio");
      if (app?.intentBaseUrl) reviewUrl = `${app.intentBaseUrl}/releases/${releaseId}`;
    } catch {
      // non-fatal: the Slack message just won't include the review button
    }

    return { releaseId, releaseTitle, articleTitle, summary: text, reviewUrl };
  },
});
