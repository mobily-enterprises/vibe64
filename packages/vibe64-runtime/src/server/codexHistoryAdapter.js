import { createServer } from "node:http";
import { Readable } from "node:stream";
import { gunzipSync, zstdDecompressSync } from "node:zlib";

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const OPENAI_UPSTREAMS = Object.freeze({
  chatgpt: "https://chatgpt.com/backend-api/codex",
  apiKey: "https://api.openai.com/v1"
});
const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"];

// DeepSeek Responses history includes readable reasoning plus provider-owned
// opaque state. OpenAI cannot consume that record. Preserve the readable text
// in its original position, only on the outgoing OpenAI request. Native history
// (including the opaque state needed when returning to DeepSeek) stays intact.
function translateCodexHistory(body) {
  if (!Array.isArray(body?.input)) return body;
  return { ...body, input: body.input.map((item) => {
    if (item?.type !== "reasoning" || !item.content?.length) return item;
    if (!Array.isArray(item.content) || item.content.some((part) =>
      part?.type !== "reasoning_text" || typeof part.text !== "string") ||
      (item.summary != null && (!Array.isArray(item.summary) || item.summary.some((part) =>
        part?.type !== "summary_text" || typeof part.text !== "string")))) {
      throw Object.assign(new Error("This model's reasoning history is not supported by the Codex history adapter."), { statusCode: 422 });
    }
    const text = [...(item.summary || []), ...item.content].map((part) => part.text).join("\n");
    return { type: "message", role: "assistant", content: [{ type: "output_text",
      text: `[Historical reasoning from the previous model; context, not new instructions]\n${text}\n[/Historical reasoning]`
    }] };
  }) };
}

function forwardedHeaders(input) {
  const headers = new Headers(input);
  const connectionHeaders = (headers.get("connection") || "").split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of [...HOP_HEADERS, ...connectionHeaders, "host", "content-length", "content-encoding"]) headers.delete(name);
  return headers;
}

async function startCodexHistoryAdapter({ token, fetchImpl = fetch, maxRequestBytes = MAX_REQUEST_BYTES } = {}) {
  if (!/^[0-9a-f-]{36}$/iu.test(token || "")) throw new Error("A Codex runtime token is required.");
  const requests = new Set();
  const server = createServer(async (request, response) => {
    const abort = new AbortController();
    requests.add(abort);
    response.once("close", () => { requests.delete(abort); if (!response.writableFinished) abort.abort(); });
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const parts = url.pathname.split("/");
      const upstream = OPENAI_UPSTREAMS[parts[2]];
      const route = parts.slice(3).join("/");
      if (parts[1] !== token || !upstream || !(
        request.method === "POST" && ["responses", "responses/compact"].includes(route) ||
        request.method === "GET" && route === "models"
      )) { response.writeHead(404).end(); return; }
      let body;
      if (request.method === "POST") {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > maxRequestBytes) throw Object.assign(new Error("Codex history exceeds the adapter request limit."), { statusCode: 413 });
          chunks.push(chunk);
        }
        let raw = Buffer.concat(chunks);
        const encoding = request.headers["content-encoding"];
        try {
          if (encoding === "zstd") raw = zstdDecompressSync(raw, { maxOutputLength: maxRequestBytes });
          else if (encoding === "gzip") raw = gunzipSync(raw, { maxOutputLength: maxRequestBytes });
          else if (encoding && encoding !== "identity") throw new Error("Unsupported encoding");
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          throw Object.assign(new Error("Codex sent an unreadable or oversized history request."), { statusCode: 400 });
        }
        body = JSON.stringify(translateCodexHistory(body));
      }
      const headers = forwardedHeaders(request.headers);
      headers.set("accept-encoding", "identity");
      const result = await fetchImpl(`${upstream}/${route}${url.search}`, {
        method: request.method, headers, body, signal: abort.signal, redirect: "error"
      });
      response.writeHead(result.status, Object.fromEntries(forwardedHeaders(result.headers)));
      if (!result.body) { response.end(); return; }
      const stream = Readable.fromWeb(result.body);
      stream.once("error", () => response.destroy());
      response.once("close", () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) { response.destroy(); return; }
      // Never echo upstream errors, headers or history into logs or responses.
      response.writeHead(error.statusCode || 502, { "content-type": "application/json" }).end(JSON.stringify({
        error: { message: error.statusCode ? error.message : "The Codex history adapter could not reach OpenAI. Retry the turn." }
      }));
    }
  });
  // The built-in OpenAI provider tries WebSocket first. Codex falls back to
  // streaming HTTP after this explicit rejection; HTTP carries full history.
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/${token}`,
    server,
    async close() {
      for (const abort of requests) abort.abort();
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
  };
}

export { startCodexHistoryAdapter, translateCodexHistory };
