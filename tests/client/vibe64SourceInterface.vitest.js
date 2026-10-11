import { renderToString } from '@vue/server-renderer';
import * as Vue from 'vue';
import { expect, it, vi } from 'vitest';

vi.mock('vuetify/components/VBtn', () => ({ VBtn: {
  inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('button', attrs, slots.default?.()),
} }));
vi.mock('vuetify/components/VAlert', () => ({ VAlert: {
  inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('aside', attrs, slots.default?.()),
} }));
import Interface from '../../src/components/studio/vibe64-session/Vibe64SourceInterface.vue';

async function renderInterface(overrides = {}) {
  const app = Vue.createSSRApp(Interface, {
    filePath: 'engine.rs', indexed: true, current: true, selectedId: 'load',
    symbols: [{ id: 'load', name: 'load', kind: 'function', parameters: [], visibilityScope: 'crate', rangeAvailable: true }],
    presentation: 'code', source: 'pub(crate) fn load() -> &str { "😀" }',
    assistantAvailable: false, assistantUnavailableMessage: 'Choose a Helper account.', ...overrides,
  });
  for (const [name, element] of [['VBtn', 'button'], ['VAlert', 'aside']]) app.component(name, Vue.defineComponent({
    inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(element, attrs, slots.default?.()),
  }));
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/gu, '');
}

it('scoped interfaces explain visibility and retain exact Code when no Helper is available', async () => {
  const html = await renderInterface();
  expect(html).toContain('Visibility: crate');
  expect(html).toContain('pub(crate) fn load() -&gt; &amp;str { &quot;😀&quot; }');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Program context<\/button>/u);
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Explain function<\/button>/u);
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Code<\/button>/u);
  expect(html).toContain('Choose a Helper account.');
});

it('dirty files disable indexed symbol use and explanations while keeping the editable whole-file entry', async () => {
  const html = await renderInterface({ dirty: true, assistantAvailable: true, source: '' });
  expect(html).toContain('This file has unsaved edits.');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Code<\/button>/u);
  expect(html).not.toContain('File summary');
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Code · whole file<\/button>/u);
});

it('stale indexes stop indexed Code but retain authored Program context and editing paths', async () => {
  const html = await renderInterface({ current: false, assistantAvailable: true, source: '' });
  expect(html).toContain('The index is out of date for this file.');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Code<\/button>/u);
  expect(html).toContain('Program unavailable.');
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Code · whole file<\/button>/u);
});


it('public callables show indexed parameters and return information without exposing a body by default', async () => {
  const html = await renderInterface({ selectedId: '', presentation: 'description', symbols: [{ id: 'load', name: 'load', kind: 'function', parameters: ['id: number'], returnType: 'Record', rangeAvailable: true }] });
  expect(html).toContain('load(id: number)');
  expect(html).toContain('Returns: Record');
  expect(html).not.toContain('😀');
  const unknown = await renderInterface({ selectedId: '', symbols: [{ id: 'load', name: 'load', kind: 'function', parameters: [], rangeAvailable: true }] });
  expect(unknown).toContain('load()');
  expect(unknown).toContain('Unrecorded returns are omitted');
  expect(unknown).not.toContain('Returns: Not recorded');
});

it('saved function pseudocode remains readable without a Helper and stale source is explicit', async () => {
  const record = { path: 'engine.rs', scope: 'selection', symbolId: 'load', presentation: 'steps', body: 'Reads a saved record and returns it.', summary: 'Reads a saved record.', fileHash: 'current', status: 'current' };
  const current = await renderInterface({ presentation: 'steps', fileHash: 'current', interpretations: [record] });
  expect(current).toContain('Reads a saved record and returns it.');
  expect(current).toContain('Matches saved source');
  expect(current).toContain('Informational interpretation');
  expect(current).toMatch(/<button[^>]*disabled[^>]*>Program context<\/button>/u);
  expect(current).toMatch(/<button[^>]*disabled[^>]*>Regenerate explanation<\/button>/u);
  const stale = await renderInterface({ presentation: 'steps', fileHash: 'changed', interpretations: [record] });
  expect(stale).toContain('Stale — source or guidance changed');
  expect(stale).toContain('Reads a saved record and returns it.');
});


it('Genesis capabilities appear without a Helper and do not imply every declaration has a function explanation', async () => {
  const html = await renderInterface({ presentation: 'description', programs: [{ id: 'load', title: 'Load saved work', description: 'Restores saved work using this file and shared storage.', sources: ['engine.rs', 'storage.py'], publicContract: 'Retains work on failure.' }], programStatus: 'valid' });
  expect(html).toContain('Load saved work');
  expect(html).toContain('Restores saved work');
  expect(html).toContain('Program explanations are authored');
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Program context<\/button>/u);
  expect(html).not.toContain('File summary');
  const missing = await renderInterface({ programStatus: 'valid', presentation: 'description' });
  expect(missing).toContain('No authored explanation.');
  expect(missing).not.toContain('Description comes from');
  expect(missing).not.toContain('Saved function Steps and Code remain readable');
});


it('project rescanning shows its own stage without masquerading as function explanation', async () => {
  const html = await renderInterface({ refreshing: true, refreshProgress: { message: 'Scanning project source…', elapsedSeconds: 31 } });
  expect(html).toContain('Re-scan project');
  expect(html).toContain('Updates signatures and links; no explanations.');
  expect(html).toContain('Scanning project source… · 31s');
  expect(html).toContain('Explain function needs an available Helper.');
  expect(html).not.toContain('Preparing Steps');
});
