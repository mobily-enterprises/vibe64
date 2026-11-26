// The passes a plan runs: its `## Passes` section, one checklist item per pass, `<Genesis title>:
// <scope>`. The plan is the only list: the next pass is its first item not yet ticked, and a pass
// the person starts is added to the open plan, or to a small plan of its own when none is open.
import { AFTER_PLAN_PASS_TITLES, ASSISTANT_FINISHING_DEFAULTS, inAfterPlanOrder } from "@local/vibe64-runtime/shared/assistantFinishing";
import { ASSISTANT_ROUTING_METADATA, assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { uiPassScope } from "@local/vibe64-runtime/shared/assistantExplicitTask";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { sessionConnectedRoots } from "@local/vibe64-core/server/projectRepository";
import { workPlanAtPasses, workPlanPassItems, withWorkPlanPasses, withWorkPlanPassesUnticked } from "../shared/assistantWorkPlan.js";
import { manageWorkPlan, readWorkPlan } from "./assistantWorkPlan.js";
import { afterPlanBase, rememberAfterPlanBase } from "./afterPlanBase.js";
import { failure } from "./assistantRoutingRequests.js";
import { planError } from "./assistantWorkPlanFiles.js";

// After a plan: the changes since the session's after-plan base, read when the pass runs.
const PLAN_CHANGES = "the plan's changes";
const DEEPLY = ", deeply";
// The runs Genesis offers for every pass, by their run id: the pass's own runs, which Genesis records.
const RUN_SCOPES = Object.freeze({ whole: "whole app", "since-last": "since last completed", deep: "deep" });
const SINCE_COMMIT = /^the changes since ([a-f0-9]{7,64})$/u;
const SECTION = /^this section of the app: (.+)$/u;
const PASS_ACTIONS = Object.freeze(["continue", "again", "restart"]);
const noListing = async () => null;

const passLine = (title, scope) => `- [ ] ${title}: ${scope}`;
const titleList = (titles) => titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
// One name per pass: a Passes item names a pass by Genesis's exact title (case aside), never a short name.
const passTitled = (listing, title) => listing.passes.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
const quoted = (texts) => titleList(texts.map((text) => `“${text}”`));

/**
 * Genesis's passes as a refusal names them: each exact title, quoted, in Genesis's order.
 * @param {{ passes: { title: string }[] }} listing
 */
function genesisPassTitles(listing) {
  return quoted(listing.passes.map(({ title }) => title));
}

/**
 * The plan write's refusal for Passes items that name no pass Genesis has: it names each item and
 * every title Genesis offers, and how to put it right in the same turn.
 * @param {{ text: string }[]} items
 * @param {{ passes: { title: string }[] }} listing
 */
function unknownPlanPassesError(items, listing) {
  const several = items.length > 1;
  return planError(
    `The plan's Passes ${several ? "items" : "item"} ${quoted(items.map((item) => item.text))} ` +
      `${several ? "name passes" : "names a pass"} Genesis doesn't have: nothing changed. Genesis's passes are ${genesisPassTitles(listing)}. ` +
      `Rename ${several ? "each item" : "the item"} to one of them exactly, keeping its scope (- [ ] <title>: <scope>), and write the plan again.`,
    "vibe64_work_plan_pass_unknown",
    { items: items.map((item) => item.text), passes: listing.passes.map(({ title }) => title) }
  );
}

/**
 * Genesis's passes for a session: over its source and its connected copies, the repositories its app is built from,
 * which a deep run is sized over and a run over the whole app covers. Every listing of a session's passes is this one.
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} listPasses
 * @param {object} session
 */
function listSessionPasses(listPasses, session) {
  return listPasses({ projectRoot: sessionSourcePath(session), connectedRoots: sessionConnectedRoots(session) });
}

/**
 * Genesis's pass list for a plan command, read at most once and only when asked: for a new plan's After a
 * plan passes, or a Passes item a write adds or changes.
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} listPasses
 * @param {() => Promise<object>} readSession the session, with its source and connected copies
 * @returns {() => Promise<{ passes: object[] }>}
 */
function planPassListing(listPasses, readSession) {
  let listing = null;
  return () => (listing ??= readSession().then((session) => listSessionPasses(listPasses, session)));
}

/**
 * Refuses a plan write whose added or changed Passes items name a pass Genesis doesn't have (the
 * plan command's check, through manageWorkPlan). An item the current plan already holds, word for
 * word, is not checked again: Genesis may have changed since it was written, and the plan's pass
 * turn says so when it reaches the item (resolvePlanPass), so a write that only ticks never fails on
 * it. Genesis's list is read only when the write adds or changes a Passes item; when it can't be
 * read the write goes ahead, and the pass turn checks the item when it reaches it.
 * @param {() => Promise<{ passes: object[] }>} readListing
 * @returns {(text: string, current: string) => Promise<void>} current: the current plan's text ("" for none)
 */
function planPassItemsCheck(readListing) {
  return async (text, current) => {
    const kept = new Set(workPlanPassItems(current).map((item) => item.text));
    const written = workPlanPassItems(text).filter((item) => !kept.has(item.text));
    if (!written.length) return;
    const listing = await readListing().catch(() => null);
    const unknown = listing ? written.filter((item) => !passTitled(listing, item.title)) : [];
    if (unknown.length) throw unknownPlanPassesError(unknown, listing);
  };
}

/**
 * A new plan's text with the Passes items it starts with: the chat's After a plan ticks, in Genesis's
 * Master pass order, each over the plan's changes, deeply where Deeply is ticked, each named by
 * Genesis's own title. A plan that lists passes already keeps them (the person asked for other passes).
 * @param {string} text
 * @param {{ readMetadataValue: (sessionId: string, name: string) => Promise<string> }} store
 * @param {string} sessionId
 * @param {() => Promise<{ passes: { id: string, title: string }[] }>} [readListing] Genesis's pass list
 * @returns {Promise<string>}
 */
async function withAfterPlanPasses(text, store, sessionId, readListing = noListing) {
  if (typeof text !== "string" || workPlanPassItems(text).length) {
    return text;
  }
  let choice = ASSISTANT_FINISHING_DEFAULTS;
  try {
    const stored = await store.readMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA);
    choice = assistantRoutingFromMetadata({ [ASSISTANT_ROUTING_METADATA]: stored }) || choice;
  } catch {
    // Unreadable preferences give the defaults; the chat's settings say why when opened.
  }
  // Each pass by Genesis's own title; the chat setting's name only while Genesis's list can't be read.
  const listing = await readListing().catch(() => null);
  const titleOf = (id) => listing?.passes.find((pass) => pass.id === id)?.title || AFTER_PLAN_PASS_TITLES[id];
  return withWorkPlanPasses(text, inAfterPlanOrder(choice.afterPlan).map((id) =>
    passLine(titleOf(id), PLAN_CHANGES + (choice.afterPlanDeep.includes(id) ? DEEPLY : ""))));
}

/**
 * The pass a Passes item runs and the request Genesis recognises for it, or the reason it cannot
 * run: a pass the Genesis serving the project does not offer or cannot run, a scope it has no run
 * for, or the plan's changes in a session whose history shows no start for them.
 * @param {{ text: string, title: string, scope: string }} item
 * @param {{ passes: object[] }} listing Genesis's pass list
 * @param {{ sessionId: string, metadata?: Record<string, string> }} session
 * @returns {Promise<{ id?: string, title: string, item: string, request?: string, problem?: string, fix?: string }>}
 *   fix: how to put the problem right, when it is not the usual change to the plan's Passes
 */
async function resolvePlanPass(item, listing, session) {
  const pass = passTitled(listing, item.title);
  const named = { title: pass?.title || item.title, item: item.text };
  if (!pass) {
    return {
      ...named,
      problem: `the plan names “${item.title}”, a pass Genesis doesn't have. Genesis's passes are ${genesisPassTitles(listing)}.`,
      fix: `Rename the plan's Passes item “${item.text}” to one of them, then choose Continue in Passes.`
    };
  }
  if (pass.unavailable) return { ...named, problem: pass.unavailable };
  const run = (id) => pass.runs.find((entry) => entry.id === id)?.request || "";
  const deeply = item.scope.endsWith(DEEPLY);
  const scope = deeply ? item.scope.slice(0, -DEEPLY.length) : item.scope;
  let request = "";
  if (scope === PLAN_CHANGES || SINCE_COMMIT.test(scope)) {
    const base = scope === PLAN_CHANGES ? await afterPlanBase(session) : SINCE_COMMIT.exec(scope)[1];
    if (!base) return { ...named, problem: "Vibe64 can't tell where this plan's work started in the session's history." };
    const template = deeply ? pass.sinceBase?.deep : pass.sinceBase?.request;
    request = template ? template.replace("{base}", base) : "";
  } else if (!deeply && scope === RUN_SCOPES.whole) {
    request = run("whole");
  } else if (!deeply && scope === RUN_SCOPES["since-last"]) {
    // A pass that never completed has no run since its last one: it reads the whole app.
    request = run("since-last") || run("whole");
  } else if (!deeply && scope === RUN_SCOPES.deep) {
    request = run("deep");
  } else if (!deeply && SECTION.test(scope)) {
    request = `Run the ${pass.title} on this section of the app: ${SECTION.exec(scope)[1]}.`;
  }
  if (!request) return { ...named, problem: `${pass.title} has no run for “${item.scope}”.` };
  return { id: pass.id, ...named, request };
}

/**
 * The plan's next pass: its first Passes item not yet ticked, resolved against Genesis's list
 * (null when every pass is ticked).
 * @param {object} context the routing context, with the session
 * @param {{ text: string }} plan
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} listPasses
 */
async function nextPlanPass(context, plan, listPasses) {
  const items = workPlanPassItems(plan.text);
  const index = items.findIndex((entry) => !entry.checked);
  if (index < 0) return null;
  const last = items.slice(index + 1).every((entry) => entry.checked);
  let listing;
  try {
    listing = await listSessionPasses(listPasses, context.session);
  } catch (error) {
    return { title: items[index].title, item: items[index].text, last, problem: error.message };
  }
  return { ...await resolvePlanPass(items[index], listing, context.session), last };
}

// Words naming a run at the end of a typed request.
const RUN_SUFFIXES = Object.freeze([
  [/,?\s+(?:(?:on|over|for|across)\s+)?(?:the\s+)?(?:whole|entire|full)\s+app(?:lication)?$/iu, "whole"],
  [/,?\s+since\s+(?:(?:the|their|its)\s+)?last(?:\s+completed)?(?:\s+(?:run|one|time))?$/iu, "since-last"],
  [/,?\s+deep(?:ly)?$/iu, "deep"]
]);
const ALL_PASSES = /^(?:all(?:\s+the)?\s+passes|every\s+pass)$/iu;
const MASTER_PASS = /^(?:the\s+)?master\s+pass$/iu;
// The shapes of a typed request for passes (passesInMessage), checked before Genesis's list is read:
// run, do or start; the word pass; or the start of a request Genesis writes for Review, Deslop or
// Visual identity, whose titles hold no "pass".
const TYPED_PASSES = /^(?:please\s+)?(?:run|do|start)\s|\bpass(?:es)?\b|^(?:deslop|review)\b|\bvisual identity\b/iu;


/**
 * The passes a typed message asks to run: "Run Security, Data and Deslop", "Do the UX and UI
 * passes deeply", "Run every pass on the whole app", "Run the Master pass" (every pass, deeply),
 * a pass's own Genesis request, "Deslop" alone or a UI pass message. Each named pass must be one
 * Genesis lists, by its title or id, or by its short name ("Security") after "run" or with the
 * word pass; null for any other message, which goes to the chat as usual.
 * @param {string} message
 * @param {{ passes: object[], master?: { passes?: string[] } }} listing
 * @returns {{ ids: string[], run: string, section?: string } | null} run "" means the changes since
 *   the session's after-plan base
 */
function passesInMessage(message, listing) {
  const text = String(message || "").trim();
  for (const pass of listing.passes) {
    const run = pass.runs.find((entry) => entry.request === text);
    if (run) return { ids: [pass.id], run: run.id };
  }
  if (/^deslop[.!]?$/iu.test(text)) return listing.passes.some(({ id }) => id === "deslop") ? { ids: ["deslop"], run: "" } : null;
  const ui = uiPassScope(text);
  if (ui) {
    if (!listing.passes.some(({ id }) => id === "ui-pass")) return null;
    return { ids: ["ui-pass"], run: ui.scope === "whole" ? "whole" : "", ...(ui.scope === "section" ? { section: ui.section } : {}) };
  }
  const asked = /^(?:please\s+)?(run|do|start)\s+(?:the\s+|a\s+)?(.+?)[.!]?$/iu.exec(text);
  if (!asked) return null;
  let names = asked[2].trim();
  // "Do the UI" asks for work on the app's UI: a pass's short name ("UI", "Data") names it only
  // after "run", or when the message says pass or passes.
  const short = /^run$/iu.test(asked[1]) || /\bpass(?:es)?\b/iu.test(names);
  let run = "";
  for (const [pattern, id] of RUN_SUFFIXES) {
    if (pattern.test(names)) {
      names = names.replace(pattern, "").trim();
      run = id;
      break;
    }
  }
  const order = listing.master?.passes?.length ? listing.master.passes : listing.passes.map(({ id }) => id);
  if (MASTER_PASS.test(names)) return { ids: order.filter((id) => listing.passes.some((pass) => pass.id === id)), run: run || "deep" };
  if (ALL_PASSES.test(names)) return { ids: order.filter((id) => listing.passes.some((pass) => pass.id === id)), run };
  const ids = [];
  for (const raw of names.replace(/\s+passes$/iu, "").split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*[&+]\s*/iu)) {
    const name = raw.trim().replace(/^the\s+/iu, "").replace(/\s+pass$/iu, "").toLowerCase();
    const pass = name && listing.passes.find((entry) => [entry.title, entry.id,
      ...(short ? [entry.title.replace(/\s+pass$/iu, ""), entry.id.replace(/-pass$/u, "")] : [])]
      .some((candidate) => candidate.toLowerCase() === name));
    if (!pass) return null;
    if (!ids.includes(pass.id)) ids.push(pass.id);
  }
  return ids.length ? { ids: order.filter((id) => ids.includes(id)).concat(ids.filter((id) => !order.includes(id))), run } : null;
}

/**
 * What a message asks of the plan's passes, from the Passes list's fields or typed words: add
 * passes (with one run for all of them), continue, run one pass again, or restart from the first.
 * Null for a message that asks none of these.
 * @param {object} input the message as sent
 * @param {{ passes: object[], master?: object }} listing
 * @param {{ typed?: boolean }} [options] typed: false reads only the Passes list's fields, never the words
 */
function planPassRequest(input, listing, { typed = true } = {}) {
  const notSent = (message, code) => Object.assign(failure(message, code), { delivery: "not-sent" });
  const known = (id) => {
    const pass = listing.passes.find((entry) => entry.id === id);
    if (!pass) throw notSent("That pass is not available in this project. Open Passes to choose one.", "vibe64_assistant_routing_pass_unknown");
    if (pass.unavailable) throw notSent(pass.unavailable, "vibe64_assistant_routing_pass_unavailable");
    return pass;
  };
  if (input.passAction !== undefined) {
    if (!PASS_ACTIONS.includes(input.passAction)) throw notSent("Choose Continue, Run this pass again or Restart from the first pass.", "vibe64_assistant_routing_pass_action_invalid");
    return { action: input.passAction, ...(input.passAction === "again" ? { ids: [known(input.passId).id] } : {}) };
  }
  let asked = null;
  if (Array.isArray(input.passes) || typeof input.genesisTask === "string" && input.genesisTask) {
    const ids = Array.isArray(input.passes) ? input.passes : [input.genesisTask];
    if (!ids.length || ids.some((id) => typeof id !== "string")) throw notSent("Tick the passes to run.", "vibe64_assistant_routing_passes_invalid");
    const passes = ids.map(known);
    // Several passes run in Genesis's order, whichever order the message names them in.
    const order = listing.master?.passes || [];
    passes.sort((a, b) => (order.indexOf(a.id) + 1 || Infinity) - (order.indexOf(b.id) + 1 || Infinity));
    const run = typeof input.passRun === "string" ? input.passRun
      : passes.length === 1 ? passes[0].runs.find((entry) => entry.request === String(input.message || "").trim())?.id || "" : "";
    asked = { ids: passes.map(({ id }) => id), run };
  } else {
    asked = typed ? passesInMessage(input.message, listing) : null;
    // Typed words naming a pass the Genesis serving the project can't run are an ordinary message.
    if (!asked || asked.ids.some((id) => listing.passes.find((pass) => pass.id === id).unavailable)) return null;
  }
  if (asked.run && !Object.hasOwn(RUN_SCOPES, asked.run)) throw notSent("Choose Whole app, Since last completed or Deep.", "vibe64_assistant_routing_pass_run_invalid");
  for (const id of asked.ids) {
    const pass = known(id);
    if (asked.run === "deep" && !pass.runs.some((entry) => entry.id === "deep")) {
      throw notSent(`${pass.title} has no deep run.`, "vibe64_assistant_routing_pass_run_unavailable");
    }
  }
  return { action: "add", ...asked };
}

/**
 * What a message asks of the plan's passes (planPassRequest), with Genesis's list it was read
 * against. The list is read only for a message that may ask for passes: one with the Passes list's
 * own fields, or typed words shaped like a request for them. Typed words that can't be checked
 * against an unreadable list are an ordinary message; the fields are refused.
 * @param {object} input the message as sent
 * @param {{ session: object }} context
 * @param {typeof import("@local/vibe64-genesis/server").listGenesisPasses} listPasses
 * @param {{ typed?: boolean }} [options] typed: false reads only the Passes list's fields
 * @returns {Promise<{ listing: object | null, request: object | null }>}
 */
async function readPassRequest(input, context, listPasses, { typed = true } = {}) {
  const fields = input.passAction !== undefined || Array.isArray(input.passes) || typeof input.genesisTask === "string" && input.genesisTask;
  if (!fields && !(typed && TYPED_PASSES.test(String(input.message || "").trim()))) {
    return { listing: null, request: null };
  }
  let listing;
  try {
    listing = await listSessionPasses(listPasses, context.session);
  } catch (error) {
    if (fields) throw error;
    return { listing: null, request: null };
  }
  return { listing, request: planPassRequest(input, listing, { typed }) };
}

/**
 * Applies what a message asks of the plan's passes. Added passes join the open plan's Passes
 * section (an identical item already there runs again rather than twice); with no open plan they
 * make a plan of their own at once, named after them, replacing a completed plan, which is
 * archived. Run again unticks that pass's items, Restart every pass item; Continue changes nothing.
 * @param {object} context the routing context
 * @param {ReturnType<typeof planPassRequest>} request
 * @param {{ passes: object[] }} listing
 * @returns {Promise<{ plan: object | null, added: string[], notice: string }>}
 */
async function applyPlanPasses(context, request, listing) {
  const plan = await readWorkPlan(context);
  const write = (operation, text, extra = {}) => manageWorkPlan(context, {
    operation,
    text,
    expectedRevision: plan?.revision || "",
    expectedProgressRevision: plan?.progressRevision || "",
    ...extra
  }, "review");
  const titleOf = (id) => listing.passes.find((pass) => pass.id === id).title;
  if (request.action === "add") {
    const base = request.run || request.section ? "" : await afterPlanBase(context.session);
    const scope = request.section ? `this section of the app: ${request.section}`
      : request.run ? RUN_SCOPES[request.run] : base ? `the changes since ${base}` : RUN_SCOPES.whole;
    const lines = request.ids.map((id) => {
      const pass = listing.passes.find((entry) => entry.id === id);
      // A pass that never completed has no run since its last one: it reads the whole app.
      const own = request.run === "since-last" && !pass.runs.some((entry) => entry.id === "since-last") ? RUN_SCOPES.whole : scope;
      return passLine(pass.title, own);
    });
    const titles = request.ids.map(titleOf);
    if (plan?.status === "active") {
      const items = workPlanPassItems(plan.text);
      const listed = (line) => items.some((item) => passLine(item.title, item.scope) === line || `- [ ] ${item.text}` === line);
      const unticked = withWorkPlanPassesUnticked(plan.text, (item) => lines.includes(`- [ ] ${item.text}`));
      const text = withWorkPlanPasses(unticked, lines.filter((line) => !listed(line)));
      const written = await write("write", text);
      return { plan: written, added: titles, notice: `Added to the plan's Passes: ${titleList(titles)}.` };
    }
    const named = request.section ? `on ${request.section}` : request.run ? RUN_SCOPES[request.run] : base ? `since ${base.slice(0, 7)}` : RUN_SCOPES.whole;
    const text = [
      `# Passes: ${titleList(titles)}, ${named}`,
      "",
      "The passes you asked for, each in its own Senior turn in this order. The plan completes once every pass is done and no question is open.",
      "",
      "## Passes",
      "",
      ...lines,
      ""
    ].join("\n");
    const written = await write("new", text, plan ? { archiveCurrent: true } : {});
    await rememberAfterPlanBase(context.runtime.store, context.session, { onlyWhenUnset: true });
    return { plan: written, added: titles, notice: `New plan for the passes you asked for: ${written.title}.` };
  }
  if (!plan || plan.status !== "active" || !workPlanPassItems(plan.text).length) {
    const missing = failure("There is no open plan with passes. Run a pass from Passes to start one.", "vibe64_assistant_routing_plan_passes_missing");
    throw Object.assign(missing, { delivery: "not-sent" });
  }
  if (request.action === "continue") return { plan, added: [], notice: "" };
  const title = request.action === "again" ? titleOf(request.ids[0]) : "";
  const chosen = request.action === "again" ? (item) => item.title.toLowerCase() === title.toLowerCase() : () => true;
  if (!workPlanPassItems(plan.text).some(chosen)) {
    throw Object.assign(failure(`${title} isn't in this plan's Passes.`, "vibe64_assistant_routing_plan_pass_missing"), { delivery: "not-sent" });
  }
  const written = await write("write", withWorkPlanPassesUnticked(plan.text, chosen));
  return {
    plan: written,
    added: [],
    notice: request.action === "again" ? `${title} will run again (Passes).` : "The plan's passes restart from the first one (Passes)."
  };
}

/**
 * The open plan's passes as the Passes list shows them: each Passes item, the pass it names and its
 * state now, read from the plan and the request running or waiting at that pass. Null without an
 * active plan with passes.
 * @param {{ status: string, title: string, text: string } | null} plan
 * @param {object | null} request the saved routing request
 * @param {{ passes: { id: string, title: string }[] }} listing
 */
function planPassesView(plan, request, listing) {
  if (plan?.status !== "active") return null;
  const items = workPlanPassItems(plan.text);
  if (!items.length) return null;
  const at = request?.stage === "pass" && request.pass?.item ? request : null;
  const state = (item) => {
    if (item.checked) return "done";
    if (at?.pass.item !== item.text || at.status === "complete") return "";
    if (at.status === "working") return "running";
    if (at.awaitingAnswer) return "needs-you";
    if (at.stopped) return "paused";
    return at.pass.request ? "waiting" : "blocked";
  };
  return {
    title: plan.title,
    atPasses: workPlanAtPasses(plan),
    passes: items.map((item) => ({
      id: passTitled(listing, item.title)?.id || "",
      title: item.title,
      scope: item.scope,
      item: item.text,
      done: item.checked,
      state: state(item)
    }))
  };
}

export {
  RUN_SCOPES,
  applyPlanPasses,
  nextPlanPass,
  passesInMessage,
  planPassItemsCheck,
  listSessionPasses,
  planPassListing,
  planPassRequest,
  planPassesView,
  readPassRequest,
  resolvePlanPass,
  withAfterPlanPasses
};
