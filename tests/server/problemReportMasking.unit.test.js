import assert from "node:assert/strict";
import test from "node:test";
import {
  PROBLEM_REPORT_HIDDEN,
  PROBLEM_REPORT_LIMITS,
  PROBLEM_REPORT_SCHEMA,
  createProblemReportMasker,
  maskProblemReport,
  maskProblemText,
  problemReportFileName,
  problemReportText,
  withProblemReportNote
} from "@local/vibe64-core/shared/problemReport";

// A problem report's masking (vibe64-core/shared/problemReport.js): every string of a bundle, wherever it sits, loses
// the exact secret values the collector knows and every secret shape, before it is cut, and the bundle counts them.

// Key-shaped values built at run time, so no secret-looking literal sits in the repository.
const tail = (length, seed = "a") => Array.from({ length }, (_, index) => String.fromCharCode(97 + ((index + seed.charCodeAt(0)) % 26))).join("");
const PLANTED = Object.freeze({
  envValue: `envsecret-${tail(24, "e")}`,
  githubToken: `ghp_${tail(36, "g")}`,
  openAiKey: `sk-proj-${tail(40, "o")}`,
  stripeKey: `sk_live_${tail(24, "s")}`,
  jwt: `eyJ${tail(20, "h")}.eyJ${tail(30, "p")}.${tail(43, "z")}`,
  password: tail(18, "w"),
  bearer: tail(32, "b"),
  cookie: `sid=${tail(30, "c")}`,
  urlPassword: tail(16, "u"),
  awsKey: `AKIA${tail(16, "k").toUpperCase()}`
});
const PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----\n${tail(64, "q")}\n${tail(64, "r")}\n-----END OPENSSH PRIVATE KEY-----`;

function plantedValues() {
  return [...Object.values(PLANTED), PRIVATE_KEY];
}

test("a problem report's text loses every planted secret shape and exact value, and counts each", () => {
  const masker = createProblemReportMasker({ secrets: [PLANTED.envValue] });
  const text = [
    `Here is my value ${PLANTED.envValue} and again ${PLANTED.envValue}.`,
    `token ${PLANTED.githubToken} and ${PLANTED.openAiKey} and ${PLANTED.stripeKey}`,
    `jwt ${PLANTED.jwt}`,
    `DB_PASSWORD=${PLANTED.password}`,
    `Authorization: Bearer ${PLANTED.bearer}`,
    `Cookie: ${PLANTED.cookie}`,
    `postgres://app:${PLANTED.urlPassword}@db.internal/app`,
    `aws ${PLANTED.awsKey}`,
    PRIVATE_KEY,
    "and the plan step that waited: Senior review"
  ].join("\n");

  const masked = masker.text(text, 100_000);

  for (const value of plantedValues()) assert.equal(masked.includes(value), false, `${value.slice(0, 12)}… stayed`);
  assert.match(masked, /Senior review/u);
  assert.match(masked, /DB_PASSWORD=\[hidden\]/u);
  assert.match(masked, /Authorization: \[hidden\]/u);
  assert.ok(masker.hidden >= 11, `hid ${masker.hidden}`);
});

test("a secret is masked before the text is cut, so a cut never leaves part of it", () => {
  const secret = `cutsecret-${tail(30, "x")}`;
  const before = "x".repeat(PROBLEM_REPORT_LIMITS.textCharacters - 10);
  const masked = maskProblemText(`${before}${secret}`, { secrets: [secret] });

  assert.equal(masked.length <= PROBLEM_REPORT_LIMITS.textCharacters, true);
  assert.equal(masked.includes(secret.slice(0, 9)), false);
});

test("short or blank values are not looked for, so ordinary words stay readable", () => {
  const masked = maskProblemText("status development, flag true", { secrets: ["true", "   ", "dev", null, 42] });

  assert.equal(masked, "status development, flag true");
});

test("maskProblemReport masks every string of a bundle at any depth, keeps its keys and counts what it hid", () => {
  const bundle = {
    schema: PROBLEM_REPORT_SCHEMA,
    createdAt: "2026-11-25T10:00:00.000Z",
    note: `It broke after I pasted ${PLANTED.githubToken}`,
    place: { route: `/app/shop?token=${PLANTED.bearer}` },
    session: {
      routing: { error: `failed: ${PLANTED.envValue}`, steps: 3, stalledTurns: 0, delivery: "failed" },
      events: [{ at: "2026-11-25T09:00:00.000Z", kind: "routing", event: "followup-refused", detail: PLANTED.jwt }]
    },
    host: [{ id: "staging", fields: { lastError: `connect postgres://u:${PLANTED.urlPassword}@h/d`, healthy: false } }],
    chat: { messages: [{ role: "user", text: `my key is ${PLANTED.envValue}` }] },
    dropped: undefined,
    notANumber: Number.NaN,
    masking: { rules: "v0", hidden: 99 }
  };

  const masked = maskProblemReport(bundle, { secrets: [PLANTED.envValue] });
  const json = JSON.stringify(masked);

  for (const value of plantedValues()) assert.equal(json.includes(value), false, `${value.slice(0, 12)}… stayed`);
  assert.equal(masked.schema, PROBLEM_REPORT_SCHEMA);
  assert.equal(masked.session.routing.steps, 3);
  assert.equal(masked.host[0].fields.healthy, false);
  assert.equal(masked.session.events[0].event, "followup-refused");
  assert.equal(Object.hasOwn(masked, "dropped"), false);
  assert.equal(Object.hasOwn(masked, "notANumber"), false);
  assert.deepEqual(masked.masking, { rules: "v1", hidden: 6 });
  assert.ok(json.includes(PROBLEM_REPORT_HIDDEN));
});

test("the note and a chat message keep their longer bounds; every other string the shorter one", () => {
  const long = "w ".repeat(5000);
  const masked = maskProblemReport({
    note: long,
    chat: { messages: [{ text: long }] },
    place: { page: long }
  });

  assert.equal(masked.note.length, PROBLEM_REPORT_LIMITS.noteCharacters);
  assert.equal(masked.chat.messages[0].text.length, PROBLEM_REPORT_LIMITS.messageCharacters);
  assert.equal(masked.place.page.length, PROBLEM_REPORT_LIMITS.textCharacters);
});

test("Download and Copy carry the bundle as indented JSON under a dated file name", () => {
  const bundle = { schema: PROBLEM_REPORT_SCHEMA, createdAt: "2026-11-25T10:04:05.123Z" };

  assert.equal(problemReportText(bundle), `${JSON.stringify(bundle, null, 2)}\n`);
  assert.equal(problemReportFileName(bundle), "vibe64-problem-report-20261125T100405.json");
  assert.equal(problemReportFileName({}), "vibe64-problem-report-report.json");
});

test("the person's note joins a bundle masked like the rest, cut to its bound and counted", () => {
  const bundle = maskProblemReport({ schema: PROBLEM_REPORT_SCHEMA, note: "", place: { page: `Env ${PLANTED.envValue}` } }, { secrets: [PLANTED.envValue] });
  assert.equal(bundle.masking.hidden, 1);
  const noted = withProblemReportNote(bundle, `I pasted ${PLANTED.envValue} and ${PLANTED.githubToken}. ${"x".repeat(5000)}`,
    { secrets: [PLANTED.envValue] });
  assert.ok(noted.note.startsWith(`I pasted ${PROBLEM_REPORT_HIDDEN} and ${PROBLEM_REPORT_HIDDEN}.`));
  assert.equal(noted.note.length, PROBLEM_REPORT_LIMITS.noteCharacters);
  assert.deepEqual(noted.masking, { rules: "v1", hidden: 3 });
  assert.equal(noted.place.page, bundle.place.page, "the rest of the bundle is kept as it was");
  // Without the exact values (the page's Download and Copy), the shapes are still hidden.
  const local = withProblemReportNote(bundle, `token ${PLANTED.githubToken}`);
  assert.equal(local.note, `token ${PROBLEM_REPORT_HIDDEN}`);
  assert.equal(local.masking.hidden, 2);
  assert.equal(withProblemReportNote(bundle, undefined).note, "");
});
