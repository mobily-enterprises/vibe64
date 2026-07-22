import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidProgram,
  buildProgramProjection,
  parseProgram,
  stableJson
} from "../src/index.js";

const PROGRAM = `# Alert dispatch

Sends complete alerts without duplicate delivery.

## Uses

- [\`sendAlerts()\`](@/src/sendAlerts.js.md#sendalerts)

## Provides

### \`dispatchAlerts()\`

The function takes \`alerts\`, a list of [Alert], and returns no
value.

It calls \`sendAlerts()\` with complete alerts in their existing order.
`;

test("parses the canonical structural spine without interpreting prose", () => {
  const parsed = assertValidProgram(PROGRAM, {
    programPath: "program/src/alerts.js.md"
  });
  assert.equal(parsed.title, "Alert dispatch");
  assert.equal(parsed.uses.length, 1);
  assert.deepEqual(parsed.typeReferences.map((reference) => reference.name), ["Alert"]);
  assert.equal(parsed.provides.length, 1);
  assert.equal(parsed.provides[0].name, "dispatchAlerts()");
  assert.equal(parsed.provides[0].kind, "function");
});

test("keeps target-language timing out of operation signatures", () => {
  const parsed = parseProgram(
    PROGRAM.replace("The function", "The asynchronous function"),
    { programPath: "program/src/alerts.js.md" }
  );
  assert.equal(parsed.valid, false);
  assert.equal(
    parsed.diagnostics.some((entry) => entry.code === "INVALID_OPERATION_SIGNATURE"),
    true
  );
});

test("projects Program deterministically for source explorers", () => {
  const first = buildProgramProjection({
    programPath: "program/src/alerts.js.md",
    programSource: PROGRAM
  });
  const second = buildProgramProjection({
    programPath: "program/src/alerts.js.md",
    programSource: PROGRAM
  });
  assert.equal(stableJson(first), stableJson(second));
  assert.equal(first.targetFile, "src/alerts.js");
  assert.equal(first.provides[0].id, "@/src/alerts.js.md#dispatchalerts");
  assert.deepEqual(first.types, ["Alert"]);
  assert.equal(first.uses[0].kind, "runtime");
});

test("recognizes exported classes and their public methods", () => {
  const source = `# Alerts

## Uses

- Nothing outside this file.

## Provides

- The exported class [\`Dispatcher\`](#class-dispatcher).

## Class \`Dispatcher\`

Coordinates dispatch.

### \`send()\`

The method returns no value.
`;
  const parsed = assertValidProgram(source, {
    programPath: "program/src/Dispatcher.js.md"
  });
  assert.deepEqual(
    parsed.provides.map(({ kind, name, owner }) => ({ kind, name, owner })),
    [
      { kind: "class", name: "Dispatcher", owner: undefined },
      { kind: "method", name: "send()", owner: "Dispatcher" }
    ]
  );
});

test("reports malformed Uses entries deterministically", () => {
  const source = PROGRAM.replace(
    "- [`sendAlerts()`](@/src/sendAlerts.js.md#sendalerts)",
    "- `Alert` from somewhere"
  );
  const parsed = parseProgram(source, {
    programPath: "program/src/alerts.js.md"
  });
  assert.equal(parsed.valid, false);
  assert.equal(parsed.diagnostics[0].code, "INVALID_USE");
});

test("does not accept an empty Uses section", () => {
  const source = PROGRAM.replace("- [`sendAlerts()`](@/src/sendAlerts.js.md#sendalerts)", "");
  const parsed = parseProgram(source, {
    programPath: "program/src/alerts.js.md"
  });
  assert.equal(parsed.valid, false);
  assert.equal(parsed.diagnostics[0].code, "EMPTY_USES");
});

test("rejects duplicate provided identities and incomplete operation signatures", () => {
  const source = `${PROGRAM}
### \`dispatchAlerts()\`

Does the same thing again.
`;
  const parsed = parseProgram(source, {
    programPath: "program/src/alerts.js.md"
  });
  assert.equal(parsed.valid, false);
  assert.equal(parsed.diagnostics.some((entry) => entry.code === "DUPLICATE_PROVIDE"), true);
  assert.equal(
    parsed.diagnostics.some((entry) => entry.code === "INVALID_OPERATION_SIGNATURE"),
    true
  );
});

test("rejects traversal and noncanonical Program providers", () => {
  const parsed = parseProgram(
    PROGRAM.replace("@/src/sendAlerts.js.md#sendalerts", "@/../sendAlerts.js.md#sendalerts"),
    { programPath: "program/src/alerts.js.md" }
  );
  assert.equal(parsed.valid, false);
  assert.equal(parsed.diagnostics.some((entry) => entry.code === "MALFORMED_PROVIDER"), true);
});
