// The shared QR code for "install on my phone". The fingerprints were checked by
// decoding the codes with two independent readers (zxing-cpp and jsQR) when this
// encoder was written, and pin its output byte for byte.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { qrMatrix, qrSvg } from "../../packages/vibe64-packaging/src/shared/qr.js";

function fingerprint(modules) {
  return createHash("sha256").update(modules.map((row) => row.map((dark) => (dark ? 1 : 0)).join("")).join("\n")).digest("hex");
}

function finderAt(modules, left, top) {
  const expected = (dx, dy) => {
    const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
    return distance !== 2;
  };
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      if (modules[top + dy][left + dx] !== expected(dx, dy)) return false;
    }
  }
  return true;
}

test("QR codes match their decoded-and-verified fingerprints", () => {
  const cases = [
    ["https://example.com/install/app-1.4.2.apk", "M", 3, "2f1566aa80b066038fa292b694f7368e6c78ee1e7b473547e87fb2243c89d5d0"],
    ["https://example.com/install/app-1.4.2.apk", "L", 3, "da619543134671fe87015ba1df35a2d2f3771d890a4d0416b3643972a0440869"],
    ["HELLO WORLD", "M", 1, "2d21897bf5a7ac606d02da07bdd5e7f02a8b90097f12404b1f7d764f18ef618c"],
    ["HELLO WORLD", "L", 1, "fcf618c7c5eff92bae86e504a81a125d4a53264770b891c0ac7c3e3da17c73c6"]
  ];
  for (const [text, level, version, expected] of cases) {
    const code = qrMatrix(text, { level });
    assert.equal(code.version, version, `${text} ${level}`);
    assert.equal(code.size, version * 4 + 17);
    assert.equal(fingerprint(code.modules), expected, `${text} ${level}`);
  }
});

test("every version has its three finder patterns, and long addresses grow the version", () => {
  for (const length of [10, 100, 400, 1200, 2300]) {
    const code = qrMatrix("x".repeat(length), { level: "M" });
    const last = code.size - 7;
    assert.ok(finderAt(code.modules, 0, 0) && finderAt(code.modules, last, 0) && finderAt(code.modules, 0, last), `length ${length}`);
  }
  assert.ok(qrMatrix("x".repeat(400)).version > qrMatrix("x".repeat(100)).version);
  assert.throws(() => qrMatrix("x".repeat(3000), { level: "H" }), /too long/u);
  assert.throws(() => qrMatrix("x", { level: "Z" }), /L, M, Q or H/u);
  assert.deepEqual(qrMatrix("é").modules, qrMatrix("é").modules);
});

test("the SVG is one crisp path with a quiet zone and escaped labels", () => {
  const svg = qrSvg("https://example.com/a?b=1&c=2", { title: "Install \"Notes\" <beta>", dark: "#111", light: "#fff" });
  const { size } = qrMatrix("https://example.com/a?b=1&c=2");
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" shape-rendering="crispEdges"`, "u"));
  assert.equal((svg.match(/<path /gu) || []).length, 1);
  assert.match(svg, /aria-label="Install &quot;Notes&quot; &lt;beta>"/u);
  assert.match(svg, /<rect width="100%" height="100%" fill="#fff"\/>/u);
  assert.equal(qrSvg("same"), qrSvg("same"));
});
