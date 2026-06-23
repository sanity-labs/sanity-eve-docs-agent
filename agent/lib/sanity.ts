import { createClient, type SanityClient } from "@sanity/client";

// One place to configure Sanity access. The Editor token reads content and writes feedback
// status updates. (stage_article_edit overrides apiVersion to "vX" for its Agent Action.)
export function sanityClient(): SanityClient {
  return createClient({
    projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
    dataset: process.env.SANITY_STUDIO_DATASET ?? "production",
    apiVersion: "2026-03-01",
    token: process.env.SANITY_API_WRITE_TOKEN,
    useCdn: false,
  });
}
