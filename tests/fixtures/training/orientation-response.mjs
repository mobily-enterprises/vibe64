// The host executes this pinned check with its own service/context input, not a shell tool.
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
let timer;
try {
  let inputText = '';
  timer = setTimeout(() => { console.log(JSON.stringify({ check: 'orientation-response', outcome: 'incomplete', reason: 'Check input timed out.' })); process.exit(1); }, 5000);
  for await (const chunk of process.stdin) { inputText += chunk.toString('utf8'); if (inputText.length > 4096) throw new Error('Check input exceeds 4096 characters.'); }
  clearTimeout(timer);
  const input = JSON.parse(inputText);
  if (!input || Object.keys(input).sort().join(',') !== 'instanceId,interactionId,origin,requestId' || !uuid(input.instanceId) || !uuid(input.interactionId) || !uuid(input.requestId)) throw new Error('Invalid check identities.');
  const origin = new URL(input.origin);
  if (!['127.0.0.1', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !origin.port) throw new Error('The check needs the host-owned loopback service origin.');
  const response = await fetch(new URL(`/training/observation?requestId=${input.requestId}`, origin), { signal: AbortSignal.timeout(3000), redirect: 'error' });
  let text = '';
  for await (const chunk of response.body) { text += Buffer.from(chunk).toString('utf8'); if (text.length > 4096) throw new Error('Response exceeds check limit.'); }
  if (!response.ok) throw new Error('Request expired or unknown; press the button again.');
  const row = JSON.parse(text);
  if (!row || Object.keys(row).sort().join(',') !== 'instanceId,interactionId,message,requestId' || row.instanceId !== input.instanceId || row.interactionId !== input.interactionId || row.requestId !== input.requestId || row.message !== 'Hello from the server!') throw new Error('Response does not match this server and interaction.');
  console.log(JSON.stringify({ check: 'orientation-response', outcome: 'verified', ...row }));
} catch (error) { console.log(JSON.stringify({ check: 'orientation-response', outcome: 'incomplete', reason: error.message.slice(0, 256) })); process.exitCode = 1; }

finally { clearTimeout(timer); }
