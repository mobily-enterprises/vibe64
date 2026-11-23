import assert from "node:assert/strict";
import test from "node:test";

import { inspectPreviewApplicationIdentities } from "../../packages/vibe64-core/src/shared/previewIdentity.js";

test("each managed app identity is checked on its own: valid ones keep working and each invalid one says why", () => {
  const rows = inspectPreviewApplicationIdentities([
    { name: "you", type: "login", value: "merc" },
    { name: " Admin ", type: "email", value: " ADA@EXAMPLE.COM " },
    { name: "Ada Admin", type: "email", value: "ada@example.com" },
    { name: "editor", type: "login", value: "first" },
    { name: "EDITOR", type: "login", value: "second" },
    { name: "mail", type: "email", value: "no-at-sign" },
    { name: "phone", type: "phone", value: "555" },
    { name: "blank", type: "user-id", value: "" },
    { name: "viewer", type: "email", value: "viewer@example.com", vibe64User: "merc" },
    "admin",
    { name: "", type: "login", value: "x" }
  ]);

  assert.deepEqual(rows.map(({ position, name, problem }) => [position, name, problem?.code || ""]), [
    [1, "you", "vibe64_application_identity_name_reserved"],
    [2, "admin", ""],
    [3, "Ada Admin", "vibe64_application_identity_name_invalid"],
    [4, "editor", "vibe64_application_identity_name_duplicated"],
    [5, "editor", "vibe64_application_identity_name_duplicated"],
    [6, "mail", "vibe64_application_identity_selector_invalid"],
    [7, "phone", "vibe64_application_identity_selector_invalid"],
    [8, "blank", "vibe64_application_identity_selector_invalid"],
    [9, "viewer", "vibe64_application_identity_fields_unsupported"],
    [10, "", "vibe64_application_identity_not_object"],
    [11, "", "vibe64_application_identity_name_invalid"]
  ]);
  assert.deepEqual(rows[1], { position: 2, name: "admin", type: "email", value: "ada@example.com", problem: null },
    "a valid entry is its stored form");
  assert.deepEqual({ ...rows[0], problem: null }, { position: 1, name: "you", type: "login", value: "merc", problem: null },
    "an invalid entry keeps what it holds, so the person can see and fix it");
  assert.match(rows[0].problem.reason, /^The name "you" is reserved by Vibe64 \(default, guest and you are\)\. Choose another, such as admin or user\.$/u);
  assert.match(rows[2].problem.reason, /^The name "Ada Admin" can't be used: a name starts with a letter a-z/u);
  assert.match(rows[3].problem.reason, /^The name "editor" is also used by identity 5\. Each name must be unique\.$/u);
  assert.match(rows[4].problem.reason, /also used by identity 4\./u);
  assert.match(rows[5].problem.reason, /^Its email "no-at-sign" has no @\.$/u);
  assert.match(rows[6].problem.reason, /^Its app identifier "phone" is not one Vibe64 knows: use email, login or user-id\.$/u);
  assert.match(rows[7].problem.reason, /^It has no application value/u);
  assert.match(rows[8].problem.reason, /^It has fields Vibe64 does not use \(vibe64User\)/u);
  assert.match(rows[9].problem.reason, /^It is not an identity/u);
  assert.match(rows[10].problem.reason, /^It has no name\./u);
});

test("identities past the limit are invalid and the ones before it keep working", () => {
  const rows = inspectPreviewApplicationIdentities(Array.from({ length: 34 }, (_, index) => ({
    name: `user-${index + 1}`,
    type: "user-id",
    value: String(index + 1)
  })));

  assert.equal(rows.filter((row) => !row.problem).length, 32);
  assert.deepEqual(rows.slice(32).map((row) => [row.position, row.problem.code]), [
    [33, "vibe64_application_identities_too_many"],
    [34, "vibe64_application_identities_too_many"]
  ]);
  assert.equal(rows[32].problem.reason, "Only 32 identities are allowed, and this is identity 33.");
});
