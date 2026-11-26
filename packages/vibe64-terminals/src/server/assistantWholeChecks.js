import { AFTER_PLAN_PASS_TITLES } from "@local/vibe64-runtime/shared/assistantFinishing";
import {
  assistantAsksWholeChecks,
  assistantWholeChecksDeclinedNotice,
  assistantWholeChecksQuestionNotice
} from "@local/vibe64-runtime/shared/assistantWholeChecks";
import { workPlanPassItems } from "../shared/assistantWorkPlan.js";
import { failure, read } from "./assistantRoutingRequests.js";
import { RUN_SCOPES } from "./planPasses.js";

/**
 * Routing's side of the question Vibe64 asks once a plan is finished, whether to
 * run the whole-project checks (@local/vibe64-runtime/shared/assistantWholeChecks):
 * the request that finished the plan asks it, the person's No declines it
 * without a turn, and a new message answers it: the Yes runs them, any other
 * message ends it as offered.
 */

/** A Yes or No once nothing asks. */
const wholeChecksNotAsked = () => failure(
  "Vibe64 isn't asking about the whole-project checks now: the question was answered, or a newer message ended it.",
  "vibe64_assistant_routing_whole_checks_not_asked"
);

const RECORDED_SCOPES = new Set(Object.values(RUN_SCOPES));
const PASS_IDS = new Map(Object.entries(AFTER_PLAN_PASS_TITLES).map(([id, title]) => [title.toLowerCase(), id]));

/**
 * The ids of `plan`'s finished passes that Genesis records as the pass (its Passes items run over the whole app,
 * since their last completion or deeply), each once, in the plan's order. Genesis records a pass only after its
 * whole-suite run passed with the person's OK, so they wait for the person's answer; a pass over the plan's changes
 * or a section is never recorded.
 * @param {{ text?: string } | null} plan
 * @returns {string[]}
 */
function planPassesToRecord(plan) {
  const ids = workPlanPassItems(plan?.text || "")
    .filter((item) => item.checked && RECORDED_SCOPES.has(item.scope))
    .map((item) => PASS_IDS.get(item.title.toLowerCase()))
    .filter(Boolean);
  return [...new Set(ids)];
}

/**
 * Marks the request that finished `plan` as asking, with the plan's passes that wait for the answer to be recorded;
 * its chat note follows the save's, after the lock.
 */
function askWholeChecks(state, plan) {
  const passes = planPassesToRecord(plan);
  state.wholeChecks = { status: "asked", plan: plan?.title || "", ...(passes.length ? { passes } : {}) };
}

/** The question's chat note, once the finished work's automatic save has noted its result. */
const writeWholeChecksQuestion = (records, context, state) =>
  records.writeNotice(context, state, assistantWholeChecksQuestionNotice(state.turnId));

/**
 * The person's No, sent with the messageId of the request that finished the plan: nothing runs, the question ends,
 * and the chat notes that Vibe64 won't ask again.
 * @returns {Promise<{ ok: true, delivered: false, messageId: string, wholeChecks: "declined" }>}
 */
async function declineWholeChecks(records, context, sessionId, input) {
  const state = await read(context.runtime.store, sessionId);
  if (state?.messageId !== input.messageId || !assistantAsksWholeChecks(state)) throw wholeChecksNotAsked();
  state.wholeChecks = { ...state.wholeChecks, status: "declined" };
  await records.save(context, state);
  await records.writeNotice(context, state, assistantWholeChecksDeclinedNotice(state.turnId, { passes: state.wholeChecks.passes }));
  return { ok: true, delivered: false, messageId: input.messageId, wholeChecks: "declined" };
}

/**
 * What a new message does to the question the saved request asks: `runs` when it is the person's Yes
 * (`wholeChecks: "run"`), and the new request's fields, run or, for any other message, offered. A Yes when
 * nothing asks is refused.
 * @param {object | null} saved the saved routing request
 * @param {{ messageId: string, wholeChecks?: "run" }} input
 * @returns {{ runs: boolean, fields: { wholeChecks?: { status: "run" | "offered", plan: string } } }}
 */
function answerWholeChecks(saved, input) {
  const newMessage = saved?.messageId !== input.messageId;
  const asked = newMessage && assistantAsksWholeChecks(saved) ? saved.wholeChecks : null;
  if (input.wholeChecks === "run" && newMessage && !asked) throw wholeChecksNotAsked();
  const runs = Boolean(asked) && input.wholeChecks === "run";
  // The Yes's turn records the plan's passes once every check passes; another message's turn records none.
  const passes = runs && asked.passes?.length ? { passes: asked.passes } : {};
  return { runs, fields: asked ? { wholeChecks: { status: runs ? "run" : "offered", plan: asked.plan || "", ...passes } } : {} };
}

export { answerWholeChecks, askWholeChecks, declineWholeChecks, planPassesToRecord, writeWholeChecksQuestion };
