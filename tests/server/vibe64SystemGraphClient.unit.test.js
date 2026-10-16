import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as vue from 'vue';
import { useRealtimeEvent } from '@jskit-ai/realtime/client/composables/useRealtimeEvent';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { useEndpointResource } from '@jskit-ai/http-web/client/composables/useEndpointResource';
import { transform } from 'esbuild';

const source = await readFile(new URL('../../packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js', import.meta.url), 'utf8');
const { code } = await transform(source, { format: 'cjs' });

test('a retained inactive graph reader cannot break the visible reader sharing its request cache', async t => {
  const requests = [];
  const client = { request: async path => {
    requests.push(path);
    if (path.endsWith('/status')) return { cities: { machine: { available: true } } };
    if (path.endsWith('/architecture')) return { architecture: { files: [{ path: 'controller.go' }] } };
    return {};
  } };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = vue.createApp({ render: () => null });
  app.use(VueQueryPlugin, { queryClient });
  const scope = vue.effectScope();
  t.after(() => { scope.stop(); queryClient.clear(); queryClient.unmount(); });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'vue') return vue;
    if (name === '@jskit-ai/realtime/client/composables/useRealtimeEvent') return { useRealtimeEvent };
    if (name === '@/composables/useVibe64ProjectScope.js') return { useVibe64ProjectSlug: () => vue.ref('test-project') };
    if (name === '@jskit-ai/http-web/client/composables/useEndpointResource') {
      return { useEndpointResource: options => useEndpointResource({ ...options, client }) };
    }
    assert.equal(name, '@jskit-ai/shell-web/client/navigation/usePaths');
    return { usePaths: () => ({ api: suffix => '/api/app' + suffix }) };
  }, module, module.exports);
  const active = vue.ref(true);
  const sessionId = vue.ref('one');
  const { visible, retained } = app.runWithContext(() => scope.run(() => ({
    visible: module.exports.useVibe64SystemGraph({ active, sessionId, projection: 'architecture' }),
    retained: module.exports.useVibe64SystemGraph({ active: false, sessionId, projection: 'architecture' })
  })));
  await visible.reload();
  assert.equal(visible.error.value, '');
  assert.equal(retained.error.value, '');
  assert.equal(visible.architecture.value.files[0].path, 'controller.go');
  assert.ok(requests.includes('/api/app/vibe64/system-graph/sessions/one/architecture'));
  assert.ok(requests.every(path => path.startsWith('/api/app/vibe64/system-graph/sessions/one/')));
  active.value = false;
  await vue.nextTick();
  const suspendedCount = requests.length;
  await visible.reload();
  await retained.reload();
  assert.equal(requests.length, suspendedCount, 'hidden readers must not initiate reloads');
  assert.equal(visible.architecture.value.files[0].path, 'controller.go', 'hiding must retain existing data');
  active.value = true;
  sessionId.value = 'two';
  await vue.nextTick();
  await visible.reload();
  assert.equal(visible.error.value, '');
  assert.ok(requests.includes('/api/app/vibe64/system-graph/sessions/two/architecture'));
});

test('fresh and retained viewers reconcile scan progress, completion and failure through the shared socket', async t => {
  const listeners = new Map();
  const socket = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, payload) { for (const fn of listeners.get(name) || []) fn(payload); }
  };
  const projectSlug = vue.ref('project-one');
  const sessionId = vue.ref('session-one');
  let scan = { status: 'running', startedAt: Date.now() - 42000, message: 'Scanning source…' };
  let revision = 1;
  const requests = [];
  const client = { request: async path => {
    requests.push(path);
    if (path.endsWith('/refresh/status')) return { refresh: scan ? { ...scan } : null };
    if (path.endsWith('/status')) return { cities: { machine: { available: true } } };
    if (path.endsWith('/architecture')) return { architecture: { revision } };
    throw new Error('Unexpected read: ' + path);
  } };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = vue.createApp({ render: () => null });
  app.use(VueQueryPlugin, { queryClient });
  app.provide('jskit.realtime.runtime.client.socket', socket);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'vue') return vue;
    if (name === '@jskit-ai/realtime/client/composables/useRealtimeEvent') return { useRealtimeEvent };
    if (name === '@/composables/useVibe64ProjectScope.js') return { useVibe64ProjectSlug: () => projectSlug };
    if (name === '@jskit-ai/http-web/client/composables/useEndpointResource') return { useEndpointResource: options => useEndpointResource({ ...options, client }) };
    assert.equal(name, '@jskit-ai/shell-web/client/navigation/usePaths');
    return { usePaths: () => ({ api: suffix => '/api/app' + suffix }) };
  }, module, module.exports);
  const scopes = [];
  function mount(active = vue.ref(true)) {
    const scope = vue.effectScope(); scopes.push(scope);
    return app.runWithContext(() => scope.run(() => module.exports.useVibe64SystemGraph({ active, sessionId, projection: 'architecture' })));
  }
  async function settle() { for (let n = 0; n < 12; n++) { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick(); } }
  t.after(() => { scopes.forEach(scope => scope.stop()); queryClient.clear(); queryClient.unmount(); });
  const active = vue.ref(true);
  const first = mount(active);
  await first.reload(); await settle();
  assert.equal(first.refreshing.value, true, 'a reader which did not start the request discovers the running scan');
  assert.ok(first.refreshProgress.value.elapsedSeconds >= 42, 'elapsed time uses server start time');
  assert.equal(await first.refresh(), null, 'a second click does not submit another scan');
  const second = mount(); await second.reload(); await settle();
  assert.equal(second.refreshing.value, true);
  assert.equal(second.refreshProgress.value.message, 'Scanning source…');
  const count = requests.length;
  socket.emit('vibe64.session.changed', { projectSlug: 'other', sessionId: 'session-one', reason: 'architecture-refresh' });
  socket.emit('vibe64.session.changed', { projectSlug: 'project-one', sessionId: 'other', reason: 'architecture-refresh' });
  await settle(); assert.equal(requests.length, count, 'other project/session events do not reload this view');
  scan = { ...scan, status: 'complete', finishedAt: Date.now(), message: 'Analysis complete.' }; revision = 2;
  socket.emit('vibe64.session.changed', { projectSlug: 'project-one', sessionId: 'session-one', reason: 'architecture-refresh' });
  await settle();
  assert.equal(first.refreshing.value, false); assert.equal(second.refreshing.value, false);
  assert.equal(first.architecture.value.revision, 2); assert.equal(second.architecture.value.revision, 2);
  const completedReads = requests.length; await settle();
  assert.equal(requests.length, completedReads, 'terminal status does not cause an endless reload');
  active.value = false; scopes[1].stop(); await vue.nextTick();
  assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 0, 'hidden/unmounted views release listeners');
  scan = { status: 'failed', startedAt: Date.now(), finishedAt: Date.now(), message: 'Inspector failed while away', commandOutput: 'specific diagnostic' };
  active.value = true; await settle();
  assert.equal(first.error.value, 'Inspector failed while away');
  assert.equal(first.refreshOutput.value, 'specific diagnostic');
  scan = { status: 'running', startedAt: Date.now() - 8000, message: 'Next scan' };
  socket.emit('connect'); await settle();
  assert.equal(first.refreshing.value, true); assert.ok(first.refreshProgress.value.elapsedSeconds >= 8);
  scopes[0].stop();
  scan = { ...scan, status: 'complete', finishedAt: Date.now() }; revision = 3;
  const remounted = mount(); await remounted.reload(); await settle();
  assert.equal(remounted.refreshing.value, false);
  assert.equal(remounted.architecture.value.revision, 3, 'completion while all views were absent is read on remount');
});
