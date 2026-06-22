import { createClient } from "@sanity/client";
const ID = "863607b5-4e23-43a9-b720-d6c61e7d6f19";
const client = createClient({ projectId: process.env.SANITY_STUDIO_PROJECT_ID, dataset: process.env.SANITY_STUDIO_DATASET, apiVersion: "2026-03-01", token: process.env.SANITY_API_WRITE_TOKEN, useCdn: false });
for (let i = 0; i < 30; i++) {
  const d = await client.getDocument(`drafts.${ID}`);
  if (d) {
    console.log("DRAFT LANDED after ~" + (i*5) + "s | blocks:", Array.isArray(d.content) ? d.content.length : "n/a");
    console.log("first block:", d.content?.[0]?.children?.[0]?.text?.slice(0, 140));
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log("no draft after 150s");
process.exit(1);
