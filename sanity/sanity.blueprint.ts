import { defineBlueprint, defineDocumentFunction } from "@sanity/blueprints";

// Deploy from this folder with `npx sanity@latest blueprints deploy`.
// Fires the `on-feedback` function whenever reader feedback is created.
export default defineBlueprint({
  resources: [
    defineDocumentFunction({
      name: "on-feedback",
      event: {
        on: ["create"],
        filter: '_type == "feedback" && defined(article) && defined(comment)',
        projection: '{ _id, comment, rating, "articleId": article._ref }',
      },
    }),
  ],
});
