import { createClient, type SanityClient } from "@sanity/client";

// One place to configure Sanity access. The Editor token both reads content and writes
// drafts; the document Actions API (used to stage drafts) needs a recent apiVersion.
export function sanityClient(): SanityClient {
  return createClient({
    projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
    dataset: process.env.SANITY_STUDIO_DATASET ?? "production",
    apiVersion: "2026-03-01",
    token: process.env.SANITY_API_WRITE_TOKEN,
    useCdn: false,
  });
}
