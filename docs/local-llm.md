# Custom model endpoints

A person can point Claude Code, Codex or OpenCode at a model server they already run or can reach,
such as Ollama, LM Studio, llama.cpp's `llama-server` or vLLM. They enter the server's base URL,
the model name and, optionally, a key they type themselves. Vibe64 never installs, downloads,
hosts or starts a model or a model server. It sends requests only for turns, connection checks
and Health reads. Status: design, awaiting approval.

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

The connection is one row per engine, named **Custom endpoint through Codex** and so on. It
appears under **Advanced → Add a connection** for each orchestrator, after its other providers.

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

In **Models** and **Custom**, the model appears as **qwen3.5:4b · Custom endpoint**. It is
**Personal use** (owner only) and has no billing label. Usage shows tokens only, never Claude
Code's cost estimate for unknown models. Recommendations rank a custom endpoint below any
connected cloud AI.

## 3. One more provider connection, not a new system

- `custom` becomes a curated provider whose route facts come from its saved connection. It uses
  the existing per-engine store, `<system>/ai-connections/<engine>/custom/connection.json`, which
  holds `{ baseUrl, model, contextWindow, apiKey }`. That store gains OpenCode for this provider
  only. No state upgrade is needed, because existing files keep their format.
- **Codex** gets `config.toml` and `models.json` as for DeepSeek: `wire_api = "responses"`,
  `requires_openai_auth = false`, no bearer token unless a key was entered, the entered context
  window, no freeform patch, and no parallel tool calls.
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

A turn whose endpoint is down ends with "Your model server at … isn't answering. Start it, then
send your message again." **Dashboard → Health** shows a **Custom endpoint** row, but only when
one is saved; each Health read checks reachability once. Nothing polls in the background.
Vibe64 configures each engine itself; it does not use `codex --oss` or `ollama launch`.

## 5. Hosted

Nothing extra is needed. The same form works wherever Vibe64 runs, and the address only has to
be reachable from there. On a hosted VPS, `127.0.0.1` is the VPS, which cannot run a model.
The useful case there is a server the person runs elsewhere, reached over HTTPS with a key. The
VPS has one owner by design, so this proposes no address restrictions. Public code names no host.

## 6. Scope

- **In**: one custom endpoint per engine for all three engines; Models and Custom; the checks;
  Health; and the usage guides (AI accounts, AI model setups, health checks).
- **Out**:
  - finding servers automatically or picking from a server's model list;
  - more than one endpoint per engine;
  - per-model tuning;
  - images and voice through custom endpoints;
  - team members using the owner's endpoint.

## 7. JSKIT changes (commit only)

- `nativeProviders.js` gains `customAiProvider({ baseUrl, model, contextWindow })`. It returns
  the same native shape as the fixed providers. Every `nativeAiProvider` caller accepts this
  host-supplied provider: the Codex and Claude configuration writers, the Colleague drivers, and
  the Codex history adapter, whose upstream then comes from the connection.
- The Codex configuration writers omit the token when there is none, and never declare freeform
  patching.
- `claudeModelConfiguration` uses a placeholder token, no `[1m]` suffix, and context-based
  windows.
- The verification helpers work without a key and allow a longer time limit.
- A small `readOllamaLoadedContext(baseUrl, model)` reads Ollama's `/api/ps`. It has time and size
  limits and refuses redirects.
- OpenCode connections accept an HTTP base URL for `custom`.

## 8. Tests

Each new test fails on today's code.

- **JSKIT**:
  - The Codex TOML has no token and no freeform patch.
  - The Claude environment always has a token and fills every model slot.
  - OpenCode's inline provider accepts an HTTP URL.
  - The Ollama context read against a fake server: a 4,096 context, refused, redirect, oversized.
- **Public**:
  - Connect, list and remove `custom` for each engine: no key, the saved fields, and runtimes
    stopped on a change.
  - Routing offers the saved model.
  - Check errors for each case above.
  - The Health row.
  - One Playwright run (`--max-failures=2`) against a fake endpoint: connect, then choose the
    model in Models.
- **Live**: one main-chat turn per engine through Vibe64, against a real model server, where the
  person allows it.

## Questions for the owner

1. All three engines in the first version (recommended)?
2. Should hosted get the same form unchanged (recommended), or should it be hidden there for now?
3. Owner only (recommended), or may team members' helpers use the owner's endpoint?
4. Should it be reachable only under **Advanced → Add a connection** (recommended), or should it
   also get a card in **Your AI setup**?
5. Where may live model runs happen now that the desktop is off-limits: the remaining OpenCode
   shell step, and the build's final checks?
