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
import TreeBranch from '../../packages/vibe64-system-graph/src/client/components/Vibe64SubsystemTreeBranch.vue';

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
  expect(html).not.toContain('>Program context</button>');
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
  expect(html).toContain('Index out of date.');
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
  expect(current).not.toContain('>Program context</button>');
  expect(current).toMatch(/<button[^>]*disabled[^>]*>Regenerate explanation<\/button>/u);
  const stale = await renderInterface({ presentation: 'steps', fileHash: 'changed', interpretations: [record] });
  expect(stale).toContain('Stale — source or guidance changed');
  expect(stale).toContain('Reads a saved record and returns it.');
});


it('supporting files show membership only, without repeating the Program explanation', async () => {
  const html = await renderInterface({ presentation: 'description', programs: [{ id: 'load', path: 'genesis/program/load.md', mainSource: 'storage.py', title: 'Load saved work', description: 'Restores saved work using this file and shared storage.', sources: ['engine.rs', 'storage.py'], publicContract: 'Retains work on failure.' }], programStatus: 'valid' });
  expect(html).toContain('Part of');
  expect(html).toContain('Load saved work');
  expect(html).not.toContain('Restores saved work');
  expect(html).not.toContain('Retains work on failure');
  expect(html).not.toContain('Main Program file');
  expect(html).not.toContain('>Program context</button>');
  const missing = await renderInterface({ programStatus: 'valid', presentation: 'description' });
  expect(missing).toContain('No authored explanation.');
});

it('only the explicitly designated main source carries the Program explanation', async () => {
  const program = { id: 'load', path: 'genesis/program/load.md', mainSource: 'engine.rs', title: 'Load saved work', description: 'Restores saved work.', sources: ['storage.py', 'engine.rs'], publicContract: 'Retains work on failure.' };
  const main = await renderInterface({ programs: [program], programStatus: 'valid' });
  expect(main).toContain('Main Program file');
  expect(main).toContain('source-interface__main');
  expect(main).toContain('Restores saved work.');
  const legacy = await renderInterface({ programs: [{ ...program, mainSource: undefined }] });
  expect(legacy).toContain('Part of');
  expect(legacy).not.toContain('Main Program file');
  expect(legacy).not.toContain('Restores saved work.');
});

it('components and values offer Code without an inapplicable function-explanation button', async () => {
  const html = await renderInterface({ selectedId: 'view', symbols: [{ id: 'view', name: 'View', kind: 'component', rangeAvailable: true }] });
  expect(html).not.toContain('>Explain function</button>');
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Code<\/button>/u);
});


it('file explanations do not require a project index and never offer a whole-project scan', async () => {
  const html = await renderInterface({ current: false, indexed: false, assistantAvailable: true });
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Explain file<\/button>/u);
  expect(html).not.toContain('Re-scan project');
  expect(html).not.toContain('Scanning project');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Explain function<\/button>/u);
  const dirty = await renderInterface({ dirty: true, assistantAvailable: true });
  expect(dirty).toMatch(/<button[^>]*disabled[^>]*>Explain file<\/button>/u);
});

it('saved file overviews remain accessible without a Helper, separate from function pseudocode', async () => {
  const record = { path: 'engine.rs', scope: 'file', symbolId: '', presentation: 'description', body: 'Loads saved records and coordinates storage.', fileHash: 'current', status: 'current' };
  const cached = await renderInterface({ fileHash: 'current', interpretations: [record] });
  expect(cached).toMatch(/<button(?![^>]*disabled)[^>]*>Explain file<\/button>/u);
  expect(cached).toMatch(/<button[^>]*disabled[^>]*>Explain function<\/button>/u);
  const active = await renderInterface({ activeFileInterpretation: true, fileHash: 'changed', interpretations: [record] });
  expect(active).toContain('File overview');
  expect(active).toContain('Stale · source or guidance changed');
  expect(active).toMatch(/<button[^>]*disabled[^>]*>Regenerate overview<\/button>/u);
});

it('file icons distinguish the explicit main source from same-named and shared supporting files', async () => {
  const program = { id: 'run', title: 'Run work', mainSource: 'app/run.py' };
  const items = ['app/run.py', 'shared/run.py', 'shared/math.rs'].map(path => ({ id: path, kind: 'file', name: path.split('/').pop(), file: { path, sourceLines: 10 }, reasons: [], volume: .5, programs: [program] }));
  const html = await renderToString(Vue.createSSRApp(TreeBranch, { items }));
  expect(html.match(/subsystem-tree__file--main/gu)).toHaveLength(1);
  expect(html).toContain('Main ·');
  expect(html.match(/Part of ·/gu)).toHaveLength(2);
  expect(html).toContain('Run work');
  expect(html).toContain('subsystem-tree__volume');
  expect(html).toContain('data-file-path="shared/math.rs"');
});

it('many memberships cannot bury the main marker or repeat capability bodies', async () => {
  const programs = [{ id: 'other', title: 'Other capability', mainSource: 'other.py', description: 'Long repeated body.' }, { id: 'main', title: 'Main capability', mainSource: 'engine.rs' }, { id: 'another', title: 'Another capability', mainSource: 'another.py' }];
  const html = await renderInterface({ programs });
  expect(html.indexOf('Main capability')).toBeLessThan(html.indexOf('Part of 2 other Programs'));
  expect(html).not.toContain('Long repeated body.');
  const icons = await renderToString(Vue.createSSRApp(TreeBranch, { items: [{ id: 'file', kind: 'file', name: 'engine.rs', file: { path: 'engine.rs', sourceLines: 12 }, volume: .3, reasons: [], programs }] }));
  expect(icons.indexOf('Main ·')).toBeLessThan(icons.indexOf('Part of ·'));
  expect(icons).toContain('2 Programs');
});
