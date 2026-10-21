// Agent-readable specs of the Preview identity protocol and the managed app
// identity list, generated from the limits this package and vibe64-core enforce.
import {
  PREVIEW_APPLICATION_IDENTITY_LIMIT,
  PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES,
  PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SELECTOR_TYPES
} from "@local/vibe64-core/server/previewAuth";

import {
  PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES,
  PREVIEW_IDENTITY_COMMAND_MAX_COOKIES,
  PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES,
  PREVIEW_TOKEN_COOKIE_PREFIX,
  previewIdentityCommandRequest
} from "./previewIdentityCommand.js";

const json = (value) => JSON.stringify(value, null, 2);
const types = PREVIEW_IDENTITY_SELECTOR_TYPES.map((type) => `\`${type}\``).join(", ");

const EXAMPLE_REQUEST_ID = "6f1c2a7e-3d4b-4c55-9a10-2b7d8e9f0a11";
const EXAMPLE_REQUEST = previewIdentityCommandRequest({
  operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
  selector: { type: "email", value: "admin@example.com" }
}, { requestId: EXAMPLE_REQUEST_ID, targetHref: "http://127.0.0.1:5173/" });
const EXAMPLE_RESPONSE = Object.freeze({
  protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  requestId: EXAMPLE_REQUEST_ID,
  ok: true,
  setCookie: ["app_session=abc123; Path=/; HttpOnly; SameSite=Lax"],
  identity: { displayName: "Admin", email: "admin@example.com", userId: "1" }
});
const EXAMPLE_REJECTION = Object.freeze({
  protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  requestId: EXAMPLE_REQUEST_ID,
  ok: false,
  code: "user_not_found",
  error: "No active user has that email.",
  statusCode: 404,
  setCookie: []
});

const VIBE64_TERMINALS_AGENT_SPECS = Object.freeze([
  {
    name: "preview-identity-command",
    title: "Preview identity command protocol",
    exampleRequest: EXAMPLE_REQUEST,
    exampleResponses: [EXAMPLE_RESPONSE, EXAMPLE_REJECTION],
    text: () => `# Preview identity command protocol (\`${PREVIEW_IDENTITY_COMMAND_PROTOCOL}\`)

An application-owned executable, declared under an Outputs web target's \`#### Preview identity\` block (grammar: \`vibe64-helper spec outputs\`), that signs the Preview browser in as an existing application account or signs it out. Vibe64 never creates users, changes roles or reads passwords; the application finds the account, rejects missing or disabled ones and creates or clears its own normal browser session.

## Execution

- Vibe64 runs the declared argv from the session's project root with the declared runtimes and timeout. Its environment adds only the Enabled and Secret names, not the project's Env values, so the command loads the application's own configuration itself (for example its generated environment file). For an enabled run the declared Enabled environment name is \`true\` and the Secret environment name holds a fresh per-run secret. Keep the exchange disabled unless both are present; it is a development-preview control, never a production sign-in API.
- stdin: one JSON request line. stdout: one JSON response (at most ${PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES} bytes). Exit 0 after writing the response; a non-zero exit or timeout fails the exchange. Write diagnostics to stderr.
- Use the same database and configuration as the server behind \`target.origin\` (for a test target, its test database).

## Request

- \`operation\`: \`${PREVIEW_IDENTITY_LOGIN_OPERATION}\` or \`${PREVIEW_IDENTITY_LOGOUT_OPERATION}\`.
- \`protocol\`, \`requestId\`: echo both in the response.
- \`subject\` (${PREVIEW_IDENTITY_LOGIN_OPERATION} only): \`{"kind":"selector","selector":{"type":…,"value":…}}\` with type ${types}. Email values arrive lowercased.
- \`target\`: \`{"href","origin"}\` of the application page the cookies are for.

\`\`\`json
${json(EXAMPLE_REQUEST)}
\`\`\`

## Response

- Always: \`protocol\`, the same \`requestId\`, boolean \`ok\`, and \`setCookie\`: an array of complete Set-Cookie header values (at most ${PREVIEW_IDENTITY_COMMAND_MAX_COOKIES}, each at most ${PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES} bytes, no line breaks, no \`Domain\` attribute, never named \`${PREVIEW_TOKEN_COOKIE_PREFIX}\` or \`${PREVIEW_TOKEN_COOKIE_PREFIX}_*\`).
- \`ok: true\`: at least one cookie. For ${PREVIEW_IDENTITY_LOGIN_OPERATION}, \`identity\` with at least one of \`displayName\`, \`email\`, \`login\`, \`userId\`, \`username\`. For ${PREVIEW_IDENTITY_LOGOUT_OPERATION} (or \`"signedOut": true\`), the cookies that clear the session.
- \`ok: false\`: \`code\` (at most 128 characters), \`error\` (a person-readable reason, at most 2000), \`statusCode\` 400 through 599 (default 400), optional \`signedOut\`, and \`setCookie\` (may be empty).

\`\`\`json
${json(EXAMPLE_RESPONSE)}
\`\`\`

\`\`\`json
${json(EXAMPLE_REJECTION)}
\`\`\`
`
  },
  {
    name: "preview-identities",
    title: "Managed app identities",
    text: () => `# Managed app identities

The ordered list of named existing application accounts that Preview and managed Playwright can sign in as through the application's Preview identity command (\`vibe64-helper spec preview-identity-command\`).

- Each entry has a \`name\`, a selector \`type\` (${types}) and the application's \`value\` for that account. Names are unique, start with a lowercase letter and use at most 64 lowercase letters, digits, \`_\` or \`-\`; ${[...PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES].map((name) => `\`${name}\``).join(", ")} are reserved. At most ${PREVIEW_APPLICATION_IDENTITY_LIMIT} entries; the first is the default.
- Entries are selectors only, never passwords. A saved entry does not prove that the account exists or can reach a page: verify the selected account's actual Preview access.
- Read the list and the Stack's declared types with \`vibe64-helper preview identities\`; \`vibe64-helper preview status\` shows the configured names and whether the application supports identity exchange.
- Save with \`vibe64-helper preview identities save < identities.json\`: the complete ordered JSON array replaces the list (preserve unrequested entries), each \`type\` must be declared in the target's \`#### Preview identity\` block, and it prints the saved list. It is written to this session's source, so the person's normal Save keeps it. The person can also use Dashboard > App access or Colleague.
- The person chooses which existing accounts represent each role. Ask which accounts (email, login or user ID) represent admin and other required roles; you may propose them from existing application accounts. Save only names and accounts the person asked for or confirmed. Never create application accounts or change roles for this.
- After saving, verify each entry with \`vibe64-helper preview browser identity <name>\` and the rendered access.

Entry shape:

\`\`\`json
{"name":"admin","type":"email","value":"admin@example.com"}
\`\`\`
`
  }
]);

export { VIBE64_TERMINALS_AGENT_SPECS };
