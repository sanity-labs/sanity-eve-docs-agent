// Disabled — the agent grounds revisions in the existing article + the feedback, not arbitrary
// URLs. Keeps the network surface closed. See README "Security model".
import { disableTool } from "eve/tools";

export default disableTool();
