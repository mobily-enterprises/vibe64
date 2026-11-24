// The plan's one Leftovers list in Progress holds only what needs the person or what the session can't reach
// (PLAN_LEFTOVERS_RULE). What Vibe64 can check of that rule: a Leftovers item naming a failing or flaky test, which
// is a defect the session fixes, never a Leftover.

const LEFTOVERS_LABEL = /^\s{0,3}(?:(#{1,6})\s+)?(?:\*\*|__)?Leftovers\b(?:\*\*|__)?:?(?:\*\*|__)?\s*(.*)$/iu;
const HEADING = /^\s{0,3}(#{1,6})\s/u;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/u;
const FENCE = /^\s*(`{3,}|~{3,})/u;
const TEST = /\b(?:tests?|specs?|suites?)\b/iu;
const FAILING = new RegExp("\\b(?:flak(?:y|iness|es)|fail(?:s|ed|ing)?|intermittent(?:ly)?|now and then|unstable|" +
  "\\d+\\s+runs?\\s+(?:in|of|out of)\\s+\\d+|\\d+\\s+(?:in|of|out of)\\s+\\d+\\s+runs?)\\b", "iu");
// A label line's list ends at the first prose after it; a heading's section, at the next heading as high.
const LABEL_SECTION = 7;
const QUOTED_CHARACTERS = 160;

/**
 * The items of Progress's Leftovers lists (a Leftovers heading's section, or a Leftovers: line and the list under
 * it) that name a test and say it fails or flakes. Fenced code is not read.
 * @param {string} progressText
 * @returns {string[]}
 */
function failingTestLeftovers(progressText) {
  const found = [];
  let fence = "";
  let section = 0;
  let item = "";
  const flush = () => {
    if (TEST.test(item) && FAILING.test(item)) found.push(item.trim());
    item = "";
  };
  for (const line of String(progressText || "").split(/\r?\n/u)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker || fence) {
      if (marker && !fence) fence = marker;
      else if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      continue;
    }
    const label = LEFTOVERS_LABEL.exec(line);
    const heading = HEADING.exec(line);
    if (label) {
      flush();
      section = label[1] ? label[1].length : LABEL_SECTION;
      item = label[2];
    } else if (heading && heading[1].length <= section) {
      flush();
      section = 0;
    } else if (section && LIST_ITEM.test(line)) {
      flush();
      item = LIST_ITEM.exec(line)[1];
    } else if (section && item && /^\s+\S/u.test(line)) {
      item += ` ${line.trim()}`;
    } else if (section && line.trim()) {
      flush();
      if (section === LABEL_SECTION) section = 0;
      else item = line;
    } else flush();
  }
  flush();
  return found;
}

/**
 * Why Progress may not be written, or a plan completed, with these Leftovers, naming the fix; "" when it may.
 * @param {string | null | undefined} progressText
 */
function fixableLeftoversRefusal(progressText) {
  const [first, ...more] = failingTestLeftovers(progressText);
  if (!first) return "";
  const quoted = first.length > QUOTED_CHARACTERS ? `${first.slice(0, QUOTED_CHARACTERS - 1)}…` : first;
  return `Progress's Leftovers hold a failing or flaky test: “${quoted}”${more.length ? ` and ${more.length} more` : ""}. ` +
    "A failing or flaky test is a defect to fix in this session until it passes every run, never a Leftover; Leftovers " +
    "hold only what needs the person or what this session can't reach. Fix it, then write Progress without it. Nothing changed.";
}

export { failingTestLeftovers, fixableLeftoversRefusal };
