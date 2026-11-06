# Use a model server you run (custom endpoint)

Claude Code, Codex and OpenCode can each use a model server you already run or
can reach, such as Ollama, LM Studio, llama.cpp's `llama-server` or vLLM. Vibe64
never installs, downloads or starts a model or a model server; it sends the
server requests only for your turns, the connection check and Health.

It is for advanced users, so no provider list shows it until it is set up.
Open **Account settings → AI Accounts** from the account menu (or **Your AI
setup** in AI onboarding), expand **Advanced** below the provider cards and
choose **Add a connection**. Pick **Claude Code**, **Codex** or **OpenCode**;
at the bottom of its provider list, open **Advanced** (closed until you open
it) and choose **Custom endpoint**. That section names the API the tool needs,
says Ollama serves all three, and warns never to expose a model server to the
internet without a key or a private tunnel. Each tool has its own connection,
for example **Codex - Custom endpoint**, and several tools can point at the
same server. Once connected, it shows with your other connections. Enter:

- **Base URL**: Codex needs the OpenAI Responses API and OpenCode OpenAI Chat
  Completions, both at an address that usually ends in `/v1`, such as
  `http://127.0.0.1:11434/v1` for Ollama. Claude Code needs the Anthropic
  Messages API at an address without `/v1`, such as `http://127.0.0.1:11434`.
  The address must be reachable from the computer Vibe64 runs on; when Vibe64
  runs on a server, `127.0.0.1` is that server.
- **Model name**: exactly as the server names it, such as `qwen3.5:4b`. The
  model must support tool calling.
- **Context length (tokens)**: 65,536 to start with, and at least 32,768. The
  tool compacts the conversation before it reaches this length.
- **Key (optional)**: only if your server asks for one. It is stored privately
  and never shown again; later, leave the field empty to keep it.

The form warns that the server must load the model with at least that context:
Ollama uses 4,096 tokens on most GPUs and silently cuts longer prompts, so start
it with `OLLAMA_CONTEXT_LENGTH=65536`, or raise the context in LM Studio,
`llama-server -c` or vLLM `--max-model-len`.

**Check and connect** sends one small request with your model on the tool's own
API (Responses for Codex, Messages for Claude Code, Chat Completions for
OpenCode) and waits up to 2 minutes, because the first request loads the model:
**Checking your model server. Loading the model can take up to 2 minutes.** A
refusal says what to fix:

- **Nothing answers at …. Start your model server, then choose Check again.**
- A wrong path says which base URL form the tool needs; Claude Code's has no
  `/v1`.
- **The server at … has no model named ….**
- A rejected key: check it, or leave the field empty if the server needs none.
- On Ollama, Vibe64 also reads the context Ollama really loaded: **Ollama loaded
  … with 4,096 tokens of context, less than the 65,536 entered. It would cut
  prompts without an error. Restart it with OLLAMA_CONTEXT_LENGTH=65536, then
  choose Check again.**

A custom endpoint is **Personal use**: only your own work uses it, never your
team's. Its model appears in **Models** (see [AI model setups](ai-model-setups.md)).
To change the address, model, context or key, open its row under **Advanced**
and choose **Check and save**; **Disconnect** removes it. If Codex was already
running in a session when you connected or changed the endpoint, that session's
Codex reads the model's settings only when its Codex process next starts; a new
session always has them. When the server stops, a Codex answer ends with **Your
model server at … isn't answering. Start it, then send your message again.**;
Claude Code and OpenCode show their own connection error. **Dashboard → Health**
shows whether each saved endpoint answers (see [Health](health-checks.md)).
Small local models are slower and less careful than cloud AI.

Connecting cloud AI accounts is explained in [AI accounts](ai-accounts.md).
