import { defineAgent } from "eve";

export default defineAgent({
  // Any AI Gateway model id works — swap to taste (e.g. "anthropic/claude-opus-4-8" for
  // higher quality, a smaller model for lower cost). Each feedback item is a handful of short
  // tool-using turns, so cost per run is modest. Auth via AI_GATEWAY_API_KEY or `npx eve link`.
  model: "anthropic/claude-sonnet-4.6",
});
