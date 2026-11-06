// What every engine's composed Vibe64 guidance must tell the agent about
// pages: the command, and when (and when not) to offer or make a page.
const PAGES_GUIDANCE_RULES = Object.freeze([
  ["the command", /`vibe64-helper pages publish <file\.html\|folder>/u],
  ["offering a page in one line", /When a result would be clearer as a page than as chat text \(reports, comparisons, status or progress overviews, dashboards, diagrams, plans or reviews meant for others\), offer one in a single line/u],
  ["asking before making or changing a page otherwise", /offer to add it there\), and make or change a page only once they say yes/u],
  ["making it unasked for others", /says the result is for other people \(a colleague, the team, a client, a manager, a meeting\) or that they will come back to it, make the page without asking and give its link/u],
  ["keeping changing content up to date", /content will change over time \(test results, progress, metrics\), say the page can be kept up to date/u],
  ["updating instead of duplicating", /check `vibe64-helper pages list`: when a page about the same subject already exists, update it instead of making a new one/u],
  ["no pages for quick answers", /Do not offer pages for quick answers, code changes, or documents that belong in the repository/u],
  ["no nagging", /Offer at most once per topic; do not nag/u],
  ["no secrets", /Everyone with access to the project can open a page: never put secrets in one, or anything not every project member should see/u]
]);

/**
 * @param {import("node:assert/strict")} assert
 * @param {string} guidance
 * @param {string} engine
 */
function assertPagesGuidance(assert, guidance, engine) {
  for (const [rule, pattern] of PAGES_GUIDANCE_RULES) assert.match(guidance, pattern, `${engine}: ${rule}`);
  // Scheduled refreshes are not promised by name before they exist.
  assert.doesNotMatch(guidance, /schedul/iu, `${engine}: no scheduled refresh promise`);
}

export { assertPagesGuidance, PAGES_GUIDANCE_RULES };
