import { defineSchedule } from "eve/schedules";

// Backstop for the event trigger: a weekly sweep of unaddressed feedback.
// `eve dev` never fires schedules; a deployed `eve start` does (Vercel Cron, UTC).
export default defineSchedule({
  cron: "0 9 * * 1", // Mondays 09:00 UTC
  markdown:
    "Use find_recent_feedback to list reader feedback from the last 7 days that hasn't been " +
    "addressed. For each item with actionable feedback, call revise_article for the " +
    "referenced article, then post_to_slack with a brief summary. If nothing is actionable, " +
    "do nothing.",
});
