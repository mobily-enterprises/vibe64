import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENCODE_RESPONSE_LIMIT_BYTES,
  createOpenCodeServerClient
} from "@jskit-ai/assistant-core/server/opencode-client";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status
  });
}

test("OpenCode attachment access persists on its conversation, preserves other permissions and does not grow on retries", async () => {
  const initial = [{ permission: "read", pattern: "*.env", action: "deny" }];
  let permission = [...initial];
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: new URL(url).pathname, method: init.method, body });
      if (init.method === "PATCH") permission = body.permission;
      return jsonResponse({ permission });
    }
  });
  const attachments = [
    { path: "/sessions/one/artifacts/attachments/id-1/file", fileName: "image.png", contentType: "image/png" },
    { path: "/sessions/one/artifacts/attachments/id-2/file", fileName: "data.csv", contentType: "application/octet-stream" }
  ];
  await client.prompt("ses_one", { prompt: { text: "Inspect" }, attachments });
  assert.deepEqual(permission, [...initial, ...attachments.map((attachment) => ({
    permission: "external_directory", pattern: attachment.path.replace(/file$/u, "*"), action: "allow"
  }))]);
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
    ["GET", "/session/ses_one"], ["PATCH", "/session/ses_one"], ["POST", "/session/ses_one/prompt_async"]
  ]);
  await client.prompt("ses_one", { prompt: { text: "Retry" }, attachments });
  assert.equal(requests.filter(({ method }) => method === "PATCH").length, 1);
  requests.length = 0;
  await client.prompt("ses_one", { prompt: { text: "Reopen the earlier file" } });
  assert.equal(requests.length, 1);
  assert.equal(permission.length, 3);
});

test("OpenCode does not send attachments if their native access cannot be configured", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (_url, init) => {
      requests.push(init.method);
      return init.method === "GET" ? jsonResponse({ permission: [] }) : jsonResponse({ message: "Cannot save permissions" }, 500);
    }
  });
  await assert.rejects(client.prompt("ses_one", {
    prompt: { text: "Inspect" },
    attachments: [{ path: "/sessions/one/artifacts/attachments/id/file", fileName: "data.csv" }]
  }), /Cannot save permissions/u);
  assert.deepEqual(requests, ["GET", "PATCH"]);
});

test("OpenCode client accepts only loopback HTTP origins", () => {
  for (const baseUrl of [
    "https://127.0.0.1:4096",
    "http://192.0.2.10:4096",
    "http://example.com:4096"
  ]) {
    assert.throws(
      () => createOpenCodeServerClient({
        allowAttachmentDirectories: true,
        baseUrl
      }),
      /loopback HTTP server/u
    );
  }
  assert.doesNotThrow(() => createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096"
  }));
});

test("OpenCode provider reads allowlist catalogue metadata before it can be cached", async () => {
  const secret = "provider-secret-canary";
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async () => jsonResponse({
      all: [{
        api: { url: `https://${secret}.example` },
        headers: { authorization: secret },
        id: "zai",
        key: secret,
        env: ["ZAI_API_KEY"],
        models: {
          "glm-4.7-flash": {
            api: { headers: { authorization: secret }, url: `https://${secret}.example/v1` },
            capabilities: {
              attachment: true,
              input: { image: true, secret },
              output: { text: true },
              reasoning: true,
              toolcall: true
            },
            family: "glm",
            headers: { authorization: secret },
            id: "glm-4.7-flash",
            limit: { context: 204800, output: 131072, secret },
            name: "GLM Flash",
            options: { apiKey: secret },
            release_date: "2026-08-01",
            status: "active",
            variants: { high: { apiKey: secret } }
          }
        },
        name: "Z.AI",
        options: { apiKey: secret },
        source: "api"
      }],
      apiKey: secret,
      connected: ["zai"],
      default: { zai: "glm-4.7-flash" }
    }),
    password: "bridge-password"
  });

  const providers = await client.providers();

  assert.deepEqual(providers, {
    all: [{
      apiKeyCompatible: true,
      id: "zai",
      models: {
        "glm-4.7-flash": {
          capabilities: {
            attachment: true,
            input: { image: true },
            output: { text: true },
            reasoning: true,
            toolcall: true
          },
          family: "glm",
          id: "glm-4.7-flash",
          limit: { context: 204800, output: 131072 },
          name: "GLM Flash",
          release_date: "2026-08-01",
          status: "active",
          variants: { high: {} }
        }
      },
      name: "Z.AI"
    }],
    default: { zai: "glm-4.7-flash" }
  });
  assert.equal(JSON.stringify(providers).includes(secret), false);
  assert.equal(Object.hasOwn(providers, "connected"), false);
});

test("OpenCode provider reads expose only API-key compatibility from raw env metadata", async () => {
  const provider = (id, env) => ({ env, id, models: {}, name: id });
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async () => jsonResponse({
      all: [
        provider("azure", ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"]),
        provider("cloudflare-workers-ai", [
          "CLOUDFLARE_ACCOUNT_ID",
          "CLOUDFLARE_API_TOKEN"
        ]),
        provider("google", ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT"]),
        provider("amazon-bedrock", ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]),
        provider("ordinary", ["ORDINARY_API_KEY"])
      ],
      default: {}
    }),
    password: "bridge-password"
  });

  const providers = await client.providers();

  assert.deepEqual(providers.all.map(({ apiKeyCompatible, id }) => ({
    apiKeyCompatible,
    id
  })), [
    { apiKeyCompatible: false, id: "azure" },
    { apiKeyCompatible: false, id: "cloudflare-workers-ai" },
    { apiKeyCompatible: true, id: "google" },
    { apiKeyCompatible: true, id: "amazon-bedrock" },
    { apiKeyCompatible: true, id: "ordinary" }
  ]);
  assert.equal(providers.all.length, 5);
  assert.equal(JSON.stringify(providers).includes("AZURE_API_KEY"), false);
  assert.equal(JSON.stringify(providers).includes("AWS_SECRET_ACCESS_KEY"), false);
});

test("OpenCode provider reads reject malformed or empty catalogues", async () => {
  for (const value of [null, {}, { all: {} }, { all: [] }, { all: [null] }]) {
    const client = createOpenCodeServerClient({
      allowAttachmentDirectories: true,
      baseUrl: "http://127.0.0.1:4096",
      fetchImpl: async () => jsonResponse(value),
      password: "bridge-password"
    });
    await assert.rejects(
      () => client.providers(),
      (error) => error?.code === "assistant_opencode_catalog_invalid"
    );
  }
});

test("OpenCode project clients scope every request to one directory", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, options = {}) => {
      requests.push({ headers: { ...options.headers }, url: String(url) });
      return jsonResponse(new URL(url).pathname === "/api/session"
        ? { data: { id: "ses_scoped" } }
        : true);
    },
    password: "bridge-password"
  }).forDirectory("/workspace/project-one");

  await client.createSession({ id: "ses_scoped" });
  await client.readSession("ses_scoped");
  await client.interrupt("ses_scoped");

  assert.deepEqual(
    requests.map(({ headers }) => headers["x-opencode-directory"]),
    ["/workspace/project-one", "/workspace/project-one", "/workspace/project-one"]
  );
});

test("OpenCode client combines durable v2 sessions with stable execution routes and isolates provider keys", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, options = {}) => {
      requests.push({
        body: options.body,
        headers: { ...options.headers },
        method: options.method,
        url: String(url)
      });
      const pathname = new URL(url).pathname;
      if (pathname === "/api/session") {
        return jsonResponse({ data: { id: "ses_created" } });
      }
      if (pathname.endsWith("/prompt_async")) {
        return new Response(null, { status: 204 });
      }
      if (pathname.endsWith("/message")) {
        return jsonResponse([{
          info: {
            finish: "stop",
            id: "msg_assistant",
            role: "assistant",
            time: { completed: 2, created: 1 }
          },
          parts: [{ id: "prt_text", text: "hello", type: "text" }]
        }]);
      }
      return jsonResponse(true);
    },
    password: "bridge-password"
  });

  await client.authenticateApiKey("deepseek", "deepseek-private-key");
  assert.deepEqual(await client.createSession({ id: "ses_created" }), { id: "ses_created" });
  assert.deepEqual(await client.prompt("ses/needs encoding", {
    agent: "build",
    id: "msg_admitted",
    model: { id: "deepseek-chat", providerID: "deepseek", variant: "high" },
    prompt: { text: "  hello\n" }
  }), {
    delivery: "",
    id: "msg_admitted",
    sessionID: "ses/needs encoding"
  });
  assert.deepEqual(await client.messages("ses_created", { limit: 10 }), {
    data: [{
      content: [{ id: "prt_text", text: "hello", type: "text" }],
      finish: "stop",
      id: "msg_assistant",
      role: "assistant",
      time: { completed: 2, created: 1 },
      type: "assistant"
    }]
  });
  await client.interrupt("ses_created");
  await client.switchAgent("ses_created", "build");
  await client.switchModel("ses_created", { id: "deepseek-chat", providerID: "deepseek" });

  assert.deepEqual(requests.map(({ method, url }) => ({
    method,
    path: new URL(url).pathname
  })), [
    { method: "PUT", path: "/auth/deepseek" },
    { method: "POST", path: "/api/session" },
    { method: "POST", path: "/session/ses%2Fneeds%20encoding/prompt_async" },
    { method: "GET", path: "/session/ses_created/message" },
    { method: "POST", path: "/session/ses_created/abort" },
    { method: "POST", path: "/api/session/ses_created/agent" },
    { method: "POST", path: "/api/session/ses_created/model" }
  ]);
  assert.deepEqual(JSON.parse(requests[0].body), {
    key: "deepseek-private-key",
    type: "api"
  });
  assert.deepEqual(JSON.parse(requests[2].body), {
    agent: "build",
    messageID: "msg_admitted",
    model: { modelID: "deepseek-chat", providerID: "deepseek" },
    parts: [{ text: "  hello\n", type: "text" }],
    variant: "high"
  });
  assert.equal(requests.slice(1).some((request) => (
    JSON.stringify(request).includes("deepseek-private-key")
  )), false);
  assert.equal(new Set(requests.map((request) => request.headers.authorization)).size, 1);
  assert.match(requests[0].headers.authorization, /^Basic /u);
});

test("OpenCode client rejects oversized responses before parsing them", async () => {
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://localhost:4096",
    fetchImpl: async () => new Response("x".repeat(OPENCODE_RESPONSE_LIMIT_BYTES + 1)),
    password: "password"
  });
  await assert.rejects(
    () => client.health(),
    (error) => error?.code === "assistant_opencode_response_too_large"
  );
});

test("OpenCode client decodes bounded server-sent events", async () => {
  const source = [
    ": heartbeat",
    "id: evt_1",
    "event: session.updated",
    'data: {"sessionID":"ses_1"}',
    "",
    "id: evt_2",
    'data: "{\\"status\\":\\"idle\\"}"',
    ""
  ].join("\n");
  let eventUrl = "";
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://[::1]:4096",
    fetchImpl: async (url) => {
      eventUrl = String(url);
      return new Response(source, {
        headers: { "content-type": "text/event-stream" }
      });
    },
    password: "password"
  });
  const events = [];
  let ready = false;
  for await (const event of client.events("ses_1", { onReady: () => { ready = true; } })) {
    assert.equal(ready, true);
    events.push(event);
  }
  assert.deepEqual(events, [
    {
      data: { sessionID: "ses_1" },
      event: "session.updated",
      id: "evt_1"
    },
    {
      data: { status: "idle" },
      event: "message",
      id: "evt_2"
    }
  ]);
  assert.equal(new URL(eventUrl).pathname, "/event");
});

test("OpenCode session status reads native busy state and treats an omitted session as idle", async () => {
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/session/status");
      return jsonResponse({ ses_busy: { type: "busy" } });
    }
  });
  assert.deepEqual(await client.sessionStatus("ses_busy"), { type: "busy" });
  assert.deepEqual(await client.sessionStatus("ses_other"), { type: "idle" });
});
