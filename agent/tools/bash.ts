// Security model: this agent only reads content, stages Sanity drafts, marks feedback, and
// posts to Slack. eve ships shell/filesystem/network tools to every agent by default; we
// disable the ones this agent doesn't need, so an injected feedback comment can't reach the
// shell, the filesystem, or arbitrary URLs. The agent's whole effect is bounded by its five
// authored tools. See the README "Security model" section.
import { disableTool } from "eve/tools";

export default disableTool();
