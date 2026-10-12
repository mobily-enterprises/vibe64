import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as vue from 'vue';
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
