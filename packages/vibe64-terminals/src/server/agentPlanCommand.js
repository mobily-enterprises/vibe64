// This client uses the existing session control socket and identity. Plan writes
// stay in the server owner, where the admitted model role is available.
function planCommandSource(controlEnvironmentName) {
  return `#!/usr/bin/env node
import http from "node:http";

const [operation, ...extra] = process.argv.slice(2);
if (!operation || ["--help", "-h"].includes(operation)) {
  console.log('Usage: vibe64-helper plan <read|history|new|write|progress-write|complete|archive|reopen>\\n'
    + 'Mutations take JSON input on stdin. new/write require text (Markdown title and checklists).\\n'
    + 'For read pagination or archive selection, use read --input with JSON on stdin. Bare read/history never wait for stdin.\\n'
    + 'Mutations require expectedRevision and expectedProgressRevision from the current paired read, unless no current plan exists.\\n'
    + 'Read returns BOTH text (Plan) and progressText (Progress). Read every page using offset/limit/expectedRevision/expectedProgressRevision; follow nextOffset while hasMore before working or reviewing.\\n'
    + 'Read/reopen may select an archiveId from history.\\n'
    + 'If a current plan exists, ask whether to update it or archive and replace it unless the user already chose. Explain that the archive remains accessible; pass archiveCurrent:true only after replacement is authorized.\\n'
    + 'Only Senior can create, complete, reopen or archive. Junior updates only Progress with progress-write; Plan is stable agreed scope.');
  process.exit(0);
}
try {
  if (extra.some(arg => arg !== '--input') || !['read', 'history', 'new', 'write', 'progress-write', 'complete', 'archive', 'reopen'].includes(operation)) throw new Error('Use vibe64-helper plan --help.');
  let text = '';
  if ((!['read', 'history'].includes(operation) || extra.includes('--input')) && !process.stdin.isTTY) for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Plan input is too large.');
  }
  const input = text.trim() ? JSON.parse(text) : {};
  const control = JSON.parse(process.env[${JSON.stringify(controlEnvironmentName)}] || 'null');
  if (!control?.socketPath || !control.token || !control.sessionId || !control.generationId) throw new Error('Plan controls are unavailable. Reconnect the assistant.');
  const body = JSON.stringify({ ...input, operation, token: control.token, sessionId: control.sessionId, generationId: control.generationId });
  const result = await new Promise((resolve, reject) => {
    const request = http.request({ socketPath: control.socketPath, method: 'POST', path: '/agent-session-command/plan', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Plan command timed out. Read the current plan before retrying.')));
    request.end(body);
  });
  if (result.ok !== true) throw new Error(result.error || 'The plan command failed.');
  console.log(JSON.stringify(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;
}

export { planCommandSource };
