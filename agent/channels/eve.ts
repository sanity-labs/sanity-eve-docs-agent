import { eveChannel } from "eve/channels/eve";
import { type AuthFn, localDev, vercelOidc } from "eve/channels/auth";

// Accepts the Sanity Function's trigger calls, which send
// `Authorization: Bearer ${EVE_TRIGGER_SECRET}`. Returns null (skip) for anyone else,
// so the walk falls through to localDev / vercelOidc; unmatched callers get 401.
function triggerSecret(): AuthFn<Request> {
  return (request) => {
    const secret = process.env.EVE_TRIGGER_SECRET;
    if (!secret) return null;
    if (request.headers.get("authorization") === `Bearer ${secret}`) {
      return {
        authenticator: "app",
        principalType: "app",
        principalId: "sanity-function",
        attributes: {},
      };
    }
    return null;
  };
}

export default eveChannel({
  auth: [
    triggerSecret(), // Sanity Function trigger (shared secret)
    localDev(), // loopback, for `eve dev`
    vercelOidc(), // Vercel-internal callers (TUI, subagents)
  ],
});
