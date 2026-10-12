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
import Inspector from '../../packages/vibe64-system-graph/src/client/components/Vibe64SubsystemInspector.vue';
import ProgramInspector from '../../packages/vibe64-system-graph/src/client/components/Vibe64ProgramInspector.vue';
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
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Generate pseudocode<\/button>/u);
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
  expect(current).toContain('Saved · matches source');
  expect(current).not.toContain('>Program context</button>');
  expect(current).toMatch(/<button[^>]*disabled[^>]*>Update pseudocode<\/button>/u);
  const stale = await renderInterface({ presentation: 'steps', fileHash: 'changed', interpretations: [record] });
  expect(stale).toContain('Out of date · source or guidance changed');
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
  const missing = await renderInterface({ programStatus: 'valid', presentation: 'description', assistantAvailable: true });
  expect(missing).toContain('No explanation yet.');
});

it('the main source is distinctive and links to the Program view without duplicating its text', async () => {
  const program = { id: 'load', path: 'genesis/program/load.md', mainSource: 'engine.rs', title: 'Load saved work', description: 'Restores saved work.', sources: ['storage.py', 'engine.rs'], publicContract: 'Retains work on failure.' };
  const main = await renderInterface({ programs: [program], programStatus: 'valid' });
  expect(main).toContain('Main Program file');
  expect(main).toContain('source-interface__main');
  expect(main).not.toContain('Restores saved work.');
  expect(main).toContain('Load saved work');
  expect(main).not.toContain('Read Program');
  expect(main).not.toContain('genesis/program/load.md');
  const legacy = await renderInterface({ programs: [{ ...program, mainSource: undefined }] });
  expect(legacy).toContain('Part of');
  expect(legacy).not.toContain('Main Program file');
  expect(legacy).not.toContain('Restores saved work.');
});

it('components and values offer Code without an inapplicable function-explanation button', async () => {
  const html = await renderInterface({ selectedId: 'view', symbols: [{ id: 'view', name: 'View', kind: 'component', rangeAvailable: true }] });
  expect(html).not.toContain('>Pseudocode</button>');
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Code<\/button>/u);
});


it('file explanations do not require a project index and never offer a whole-project scan', async () => {
  const html = await renderInterface({ current: false, indexed: false, assistantAvailable: true });
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Generate explanation<\/button>/u);
  expect(html).not.toContain('Re-scan project');
  expect(html).not.toContain('Scanning project');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Generate pseudocode<\/button>/u);
  const dirty = await renderInterface({ dirty: true, assistantAvailable: true });
  expect(dirty).toMatch(/<button[^>]*disabled[^>]*>Generate explanation<\/button>/u);
});

it('saved file overviews remain accessible without a Helper, separate from function pseudocode', async () => {
  const record = { path: 'engine.rs', scope: 'file', symbolId: '', presentation: 'description', body: 'Loads saved records and coordinates storage.', fileHash: 'current', status: 'current' };
  const cached = await renderInterface({ fileHash: 'current', interpretations: [record] });
  expect(cached).toMatch(/<button[^>]*disabled[^>]*>Update explanation<\/button>/u);
  expect(cached).toContain(record.body);
  expect(cached).toMatch(/<button[^>]*disabled[^>]*>Generate pseudocode<\/button>/u);
  const active = await renderInterface({ activeFileInterpretation: true, fileHash: 'changed', interpretations: [record] });
  expect(active).toContain('File explanation');
  expect(active).toContain('Out of date');
  expect(active).toMatch(/<button[^>]*disabled[^>]*>Update explanation<\/button>/u);
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
  expect(html.indexOf('Main capability')).toBeLessThan(html.indexOf('Other capability'));
  expect(html.indexOf('Main capability')).toBeLessThan(html.indexOf('Another capability'));
  expect(html).not.toContain('Long repeated body.');
  const icons = await renderToString(Vue.createSSRApp(TreeBranch, { items: [{ id: 'file', kind: 'file', name: 'engine.rs', file: { path: 'engine.rs', sourceLines: 12 }, volume: .3, reasons: [], programs }] }));
  expect(icons.indexOf('Main ·')).toBeLessThan(icons.indexOf('Part of ·'));
  expect(icons).toContain('2 Programs');
});


it('the file document has one explanation field and never hides saved text behind a chat or opening button', async () => {
  const empty = await renderInterface({ selectedId: '', assistantAvailable: true });
  expect(empty).toContain('aria-label="File explanation"');
  expect(empty).toContain('No explanation yet.');
  expect(empty).toMatch(/<button(?![^>]*disabled)[^>]*>Generate explanation<\/button>/u);
  const saved = await renderInterface({ selectedId: '', assistantAvailable: true, fileHash: 'now', interpretations: [{ path: 'engine.rs', scope: 'file', presentation: 'description', body: 'Coordinates record storage.', status: 'current', fileHash: 'now' }] });
  expect(saved).toContain('Coordinates record storage.');
  expect(saved).toMatch(/<button(?![^>]*disabled)[^>]*>Update explanation<\/button>/u);
  expect(saved).not.toContain('Generate explanation');
  expect(saved).not.toContain('Hide overview');
  expect(saved).not.toContain('Regenerate overview');
  expect(saved).not.toContain('<form');
  expect(saved).not.toContain('Ask a follow-up');
});


it('subsystem reading offers Files immediately and omits an empty Program section', async () => {
  const file = { id: 'file:app.py', path: 'app.py', sourceLines: 42 };
  const outline = { owner: { id: 'directory:app', title: 'Application', root: 'app', description: 'Runs the application.' }, files: [file], programs: [], programStatus: 'valid', operations: [], publicEntries: [], publicSymbols: [], boundarySymbols: [], observedSymbols: [], availableSymbols: [], tree: [{ kind: 'file', id: file.id, name: 'app.py', file, reasons: [], volume: 1 }] };
  const html = await renderToString(Vue.createSSRApp(Inspector, { outline, embedded: true }));
  expect(html).toContain('aria-label="In this subsystem"');
  expect(html).toMatch(/<button[^>]*>Files <small[^>]*>1<\/small><\/button>/u);
  expect(html).toContain('data-file-path="app.py"');
  expect(html).not.toContain('No authored explanation');
  expect(html).not.toContain('aria-label="Subsystem Program"');
  expect(html).toContain('aria-label="Subsystem explanation"');
  expect(html).toContain('Runs the application.');
  expect(html).not.toContain('Open Genesis explanation');
  expect(html).not.toContain('genesis/subsystems.md');
});

it('invalid Programs retain responsibility without raw document navigation', async () => {
  const outline = { owner: { id: 'directory:app', title: 'Application', root: 'app', description: 'Coordinates application requests.' }, files: [], programs: [], programStatus: 'invalid', programDiagnostics: [{ code: 'PROGRAM_SOURCE_MISSING', details: { path: 'genesis/program/app/run.md', sourcePath: 'app/missing.go' }, message: 'Missing source citation.' }], operations: [], publicEntries: [], publicSymbols: [], boundarySymbols: [], observedSymbols: [], availableSymbols: [], tree: [] };
  const html = await renderToString(Vue.createSSRApp(Inspector, { outline, embedded: true }));
  expect(html).toContain('Coordinates application requests.');
  expect(html).toContain('Program descriptions need refresh.');
  expect(html).toContain('Missing source citation.');
  expect(html).not.toContain('Review document');
  expect(html).not.toContain('genesis/program/app/run.md');
  expect(html).not.toContain('Program unavailable');
});

it('subsystem import evidence exposes importing file paths without claiming individual use for file-level candidates', async () => {
  const consumer = { id: 'file:ui/view.go', path: 'ui/view.go', subsystemId: 'directory:ui' };
  const source = { path: 'engine/api.go', symbolId: 'run', line: 7 };
  const outline = { owner: { id: 'directory:engine', title: 'Engine', root: 'engine' }, files: [], programs: [], programStatus: 'valid', dependencyCoverage: 'complete', operations: [], publicEntries: [], publicSymbols: [], availableSymbols: [], tree: [],
    observedSymbols: [{ id: 'run', name: 'Run', kind: 'function', source, consumers: [consumer] }],
    boundarySymbols: [{ id: 'other', name: 'Other', kind: 'value', source: { ...source, symbolId: 'other' }, consumers: [consumer] }] };
  const html = await renderToString(Vue.createSSRApp(Inspector, { outline, embedded: true }));
  expect(html).toContain('Imported by 1 subsystem · 1 file');
  expect(html).toContain('Show files that import this declaration.');
  expect(html).toContain('ui/view.go');
  expect(html).toContain('Exports from externally used files');
  expect(html).not.toContain('API review candidates');
  const candidates = await renderToString(Vue.createSSRApp(Inspector, { outline: { ...outline, observedSymbols: [] }, embedded: true }));
  expect(candidates).toContain('Source file imported by 1 subsystem · 1 file');
  expect(candidates).toContain('use of this particular export is unproven.');
  expect(candidates).toContain('ui/view.go');
});


it('a Program reader shows its complete explanation and actual main/supporting sources using shared file icons', async () => {
  const program = { id: 'program:load', title: 'Load records', description: 'Restores saved records.', publicContract: 'Returns records while preserving failures.', mainSource: 'engine/storage.rs', sources: ['engine/storage.rs', 'shared/codec.py'] };
  const architecture = { files: [{ id: 'file:main', path: 'engine/storage.rs', sourceLines: 20 }, { id: 'file:codec', path: 'shared/codec.py', sourceLines: 10 }] };
  const html = await renderToString(Vue.createSSRApp(ProgramInspector, { program, architecture, owner: { title: 'Storage' } }));
  expect(html).toContain('aria-label="Program explanation"');
  expect(html).toContain('Restores saved records.');
  expect(html).toContain('Returns records while preserving failures.');
  expect(html).toContain('Main source file');
  expect(html).toContain('data-file-path="engine/storage.rs"');
  expect(html).toContain('data-file-path="shared/codec.py"');
  expect(html).toContain('subsystem-tree__file--main');
  expect(html).not.toContain('genesis/program/');
});
