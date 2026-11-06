# Custom model endpoints

A person can point Claude Code, Codex or OpenCode at a model server they already run or can reach,
such as Ollama, LM Studio, llama.cpp's `llama-server` or vLLM. They enter the server's base URL,
the model name and, optionally, a key they type themselves. Vibe64 never installs, downloads,
hosts or starts a model or a model server. It sends requests only for turns, connection checks
and Health reads. Status: built (2026-11-06) as decided at the end; how to use it is in the
[custom model endpoints guide](colleague-usage/custom-model-endpoints.md).

## 1. What was proved (2026-11-06)

**Setup.**
- Server: Ollama 0.40.15, the official release, run by hand as a plain user process on the test
  desktop.
- Model: `qwen3.5:4b-q4_K_M` (tools, thinking, 3.3 GB), on a GTX 1080 (8 GB) through Vulkan.
- Engines: Claude Code 2.1.317, codex-cli 0.163.0 and OpenCode 1.18.31. Each had an isolated
  home and the custom endpoint as its only provider, configured as section 3 describes.
- Task: change a word in `greeting.txt` with the engine's edit tool, then run
  `cat greeting.txt && echo SHELL-OK` with its shell tool.

**Results.**
- **Claude Code** worked through the Anthropic Messages API (`/v1/messages`): Write, then Bash, in
  26 s. The small model rewrote the line instead of changing one word.
- **Codex** worked through the Responses API (`/v1/responses`), now its only wire API: `sed`, then
  the command, in 22 s. Codex rejected `apply_patch` in the freeform form that DeepSeek and GLM
  declare ("tool apply_patch invoked with incompatible payload"). Custom endpoints must not
  declare freeform patching.
- **OpenCode** used `@ai-sdk/openai-compatible`, which calls `/v1/chat/completions`.
  - Its read and edit tools worked exactly.
  - Its shell call came back correctly, but the test's own permission rule refused it. The rerun
    stopped when the desktop overheated, so its shell step is still unproven live.
  - It took 187 s: the first two requests took over 2 minutes each, later ones 4–8 s. The cause
    is not established.

**The context trap.** Ollama gives a model a 4,096-token context by default on GPUs under 24 GB.
It cut Claude Code's first request from 10,914 to 2,050 tokens. Ollama reported no error;
Claude Code exited successfully having used no tools. With `OLLAMA_CONTEXT_LENGTH=65536` the same
run worked. First requests are about 11k tokens (Claude Code) and 7k (OpenCode), before
Vibe64's own instructions.

**From the official docs.**
- Ollama 0.14+, LM Studio, `llama-server` and vLLM each serve all three APIs.
- Ollama's guide for each of the three engines asks for at least 64k context.
- Anthropic does not support Claude Code on non-Claude models. It works anyway, as Vibe64's
  DeepSeek and GLM routes already do.

## 2. What the person enters

The connection is one row per engine, named **Codex - Custom endpoint** and so on. It is for
advanced users: under **Advanced → Add a connection**, each tool's provider picker (Codex,
Claude Code, OpenCode) keeps it out of its provider list, in a collapsed **Advanced** at the
bottom. That section names the API the tool needs (Responses with `/v1`, Messages without
`/v1`, Chat Completions with `/v1`), says Ollama serves all three, and warns never to expose a
server without a key or a private tunnel. Once set up, the connection lists like any other.

| Field | Codex | OpenCode | Claude Code |
| --- | --- | --- | --- |
| Base URL | OpenAI Responses-compatible | OpenAI-compatible | Anthropic-compatible |
| Example | `http://127.0.0.1:11434/v1` | `http://127.0.0.1:11434/v1` | `http://127.0.0.1:11434` |

- **Model name**: exactly as the server names it, for example `qwen3.5:4b`.
- **Context length**: prefilled with 65,536; at least 32,768. The engines compact by it.
- **Key**: optional, entered by the person. It is stored like other keys (mode 0600) and never
  shown again.

The form says, in plain words: "Your server must load the model with at least this context.
Ollama uses 4,096 on most GPUs and silently cuts longer prompts. Start it with
`OLLAMA_CONTEXT_LENGTH=65536`, or raise the context in LM Studio, `llama-server -c` or vLLM
`--max-model-len`." It also says the model must support tool calling, and that the address must
be reachable from the computer Vibe64 runs on.

In **Models** and **Custom**, the model appears as **qwen3.5:4b** with **Custom endpoint**. It is
**Personal use** (owner only) and has no billing label. Recommendations rank a custom endpoint
below any connected cloud AI (score 1 in every role).

## 3. One more provider connection, not a new system

- `custom` becomes a curated provider whose route facts come from its saved connection. It uses
  the existing per-engine store, `<system>/ai-connections/<engine>/custom/connection.json`, which
  holds `{ baseUrl, model, contextWindow, apiKey }`. That store gains OpenCode for this provider
  only. No state upgrade is needed, because existing files keep their format.
- **Codex** gets `config.toml` and `models.json` as for DeepSeek: `wire_api = "responses"`,
  `requires_openai_auth = false`, no bearer token unless a key was entered, the entered context
  window, no freeform patch, and no parallel tool calls.
  - Session Codex runs every model in its OpenAI-home runtime and reaches curated providers
    through the history adapter. A custom thread's adapter route carries its upstream as
    `custom~<base64url(baseUrl)>`, so any runtime can serve it and resumed threads keep it. The
    adapter accepts only plain `http(s)` upstreams without credentials, query or fragment.
  - That runtime reads the saved custom model's catalogue row from the custom Codex home when
    its process starts.
- **Claude Code** gets `claudeModelConfiguration` with the base URL and the model in every model
  slot, including background and subagent models.
  - The token is always set: the entered key, or the placeholder `local`. Claude Code's docs say
    a base URL without a token still sends the saved claude.ai login. That would hand the
    person's Claude credential to the endpoint.
  - The auto-compact window and the output limit follow the context length.
- **OpenCode** gets an inline custom provider: `npm: "@ai-sdk/openai-compatible"`,
  `options.baseURL`, and the model with `limit.context`, `limit.output` and `tool_call: true`.
  Once the catalogue read passes the same inline provider, it lists the model, so routing needs no
  separate path. Today's HTTPS-only URL guard will accept HTTP for this provider.

## 4. Checks and errors

**Connect** and **Check again** send one small request to the engine's own API with the entered
model, the same way today's key checks work. The check waits up to 2 minutes (the first request
loads the model) and shows **Loading the model…**. Errors name the fix:

- **Nothing answers**: "Nothing answers at …. Start your model server, then choose **Check
  again**."
- **Wrong path**: a 404 on the API path says which base URL form this engine needs. For example,
  Claude Code's URL has no `/v1`.
- **Unknown model**: "The server has no model named …".
- **Key rejected**: shown on a 401 or 403.
- **Context trap**: when the server is Ollama (it answers `/api/ps`), Vibe64 reads the context
  Ollama actually loaded. If that is smaller than the entered length, the connection is refused:
  "Ollama loaded qwen3.5:4b with 4,096 tokens, less than the 65,536 entered. It would cut prompts
  without an error. Restart it with `OLLAMA_CONTEXT_LENGTH=65536`, then **Check again**." Other
  servers rely on the form's warning.

A Codex turn whose endpoint is down ends with "Your model server at … isn't answering. Start it,
then send your message again." Claude Code and OpenCode show their own connection error.
**Dashboard → Health** shows an optional **Custom endpoint · Codex** (or Claude Code, OpenCode)
row for each saved endpoint: "It answers. Codex uses qwen3.5:4b there." or "Nothing answers at
…", explained as "Start your model server, then refresh Health. Vibe64 never starts it." Each
Health read sends one model-list request (`/models`, or `/v1/models` for Claude Code), which
loads no model; any HTTP answer counts. A stopped server is a warning, never a blocker. Nothing
polls in the background. Vibe64 configures each engine itself; it does not use `codex --oss` or
`ollama launch`.

## 5. Where Vibe64 runs

Nothing extra is needed. The same form works wherever Vibe64 runs, and the address only has to
be reachable from there. When Vibe64 runs on a server, `127.0.0.1` is that server, which may not
be able to run a model. The useful case there is a model server the person runs elsewhere,
reached over HTTPS with a key. Only the owner connects an endpoint, so there are no address
restrictions.

## 6. Scope

- **In**: one custom endpoint per engine for all three engines; Models and Custom; the checks;
  Health; and the usage guides (AI accounts, AI model setups, health checks).
- **Out**:
  - finding servers automatically or picking from a server's model list;
  - more than one endpoint per engine;
  - per-model tuning;
  - images and voice through custom endpoints;
  - team members using the owner's endpoint.

## 7. JSKIT changes (`@jskit-ai/assistant-core`)

- `shared/native-providers` exports `CUSTOM_AI_PROVIDER_ID`, `CUSTOM_AI_MINIMUM_CONTEXT`,
  `CUSTOM_AI_PLACEHOLDER_TOKEN`, `customAiProvider({ engineId, baseUrl, model, contextWindow })`,
  which returns the native provider shape, and `connectionAiProvider(id, connection)`. The Codex
  and Claude configuration writers and the Colleague drivers take a connection's provider.
- The Codex writers omit the token without a key, never declare freeform patching, and turn off
  parallel tool calls when the model says so. `readCodexCustomModels(codexHome)` reads a custom
  home's catalogue.
- `claudeModelConfiguration` uses the placeholder token, no `[1m]` suffix, and an output limit of
  a quarter of the context, at most 32,000.
- The history adapter routes `custom~<base64url>` upstreams and maps a refused connection to the
  server-down message above.
- `server/custom-endpoint` exports `checkCustomEndpoint`, `verifyCustomEndpoint`,
  `readOllamaLoadedContext` (`/api/ps`, with time and size limits, no redirects) and
  `probeCustomEndpoint` for Health.

The public packages need the JSKIT release that contains these and a pin bump.

## 8. Tests

The new tests fail on the code before this change. No test runs a model.

- **JSKIT** (`test/customEndpoint.test.js`), against a fake model server that replays the
  recorded Ollama 0.40.15 answers in `test/fixtures/customEndpoint/`:
  - each engine's check request, with and without a key, and every refusal, including a
    redirect;
  - the Ollama context read: its 4,096 default refused, 65,536 accepted;
  - the Codex files have no token and no freeform patch; the Claude environment always has a
    token and fills every model slot;
  - the history adapter's custom route, kept on resume, refusing unsafe upstreams, and the
    server-down message; the Health probe.
- **Public**:
  - `tests/server/customModelEndpoints.unit.test.js`: connect, list and remove a custom endpoint
    for each engine against a fake Ollama (no key, the saved fields, runtimes stopped on a
    change), a kept key that is never listed, the check errors, the Health row, the model in
    routing, Claude and OpenCode capabilities, and OpenCode's inline provider.
  - `tests/server/studioHealth.unit.test.js`: a stopped endpoint warns and never blocks.
  - `tests/client/nativeProviderConnections.vitest.js` and `aiConnectionManager.vitest.js`: the
    form's fields, kept key and context limit, OpenCode's picker entry and Back, and the
    configured row.

## Decisions (2026-11-06)

1. All three engines in the first version.
2. Every installation gets the same form, with no address restrictions.
3. Owner only.
4. Only under **Advanced → Add a connection**; no card in **Your AI setup**.
5. No more live model runs for now; tests use a fake endpoint that replays the recorded runs.

## Not yet proven, and known limits

- OpenCode's shell step has not been proven live (section 1). Codex and Claude Code have not run
  a turn through Vibe64 itself against a real server; each engine's configuration was proven
  live outside Vibe64, and the Vibe64 wiring through the fake endpoint.
- A session Codex process that was running before the endpoint was saved or changed uses Codex's
  fallback model metadata until it next starts.
- Saving or changing OpenCode's endpoint restarts the shared OpenCode server on its next custom
  turn, as every OpenCode route change does.
- Claude Code and OpenCode show their own error when the server is down.
