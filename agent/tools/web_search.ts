// Disabled by default. With web search on, the agent will pull external facts (e.g. a current
// version number) into a draft — useful, but it's unverified content landing in your docs, plus
// added latency, cost, and nondeterminism. The default keeps revisions grounded in the existing
// article + the feedback. To let the agent fact-check, delete this file (web_search is a
// provider-managed framework default and comes back automatically).
import { disableTool } from "eve/tools";

export default disableTool();
