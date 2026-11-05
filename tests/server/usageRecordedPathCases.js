// Request paths and the path the recording contract keeps for each
// (recordedRequestPath): every opaque segment becomes [redacted] before the
// path is cut to 256 characters, so a token past the cut is never half kept.
// The Node, Python and PHP recorders write their local request labels this
// way; no recording file may hold any of SECRET_SEGMENTS.
const LONG_PREFIX = `/${"g".repeat(240)}`;
const SIGNED = "eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0";

const RECORDED_PATH_CASES = Object.freeze([
  ["/reset/3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d", "/reset/[redacted]"],
  ["/notes/123e4567-E89B-12d3-a456-426614174000/edit", "/notes/[redacted]/edit"],
  ["/files/s/AbCdEfGh1234_-IjKlMnOp5678/view", "/files/s/[redacted]/view"],
  [`${LONG_PREFIX}/${SIGNED}`, `${LONG_PREFIX}/[redacted]`],
  [`/${"g".repeat(300)}`, `/${"g".repeat(255)}`],
  ["/orders/42/getting-started-with-recording", "/orders/42/getting-started-with-recording"],
  ["/orders/0123456789abcdef012", "/orders/0123456789abcdef012"]
]);

const SECRET_SEGMENTS = Object.freeze(["3f2b8c9d4e5f6a7b", "123e4567-E89B", "AbCdEfGh1234_-IjKlMn", SIGNED.slice(0, 14)]);

export { RECORDED_PATH_CASES, SECRET_SEGMENTS };
