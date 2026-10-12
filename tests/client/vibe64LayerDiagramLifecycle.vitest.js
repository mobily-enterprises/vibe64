import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from '@vue/compiler-dom';
import { compileScript, parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import Diagram from '../../packages/vibe64-system-graph/src/client/components/Vibe64LayerDiagram.vue';
import { layeredGraph } from '../../packages/vibe64-system-graph/src/client/layeredGraph.js';

const filename = fileURLToPath(new URL('../../packages/vibe64-system-graph/src/client/components/Vibe64LayerDiagram.vue', import.meta.url));
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename });
const script = compileScript(descriptor, { id: 'layer-lifecycle' });
Diagram.render = new Function('Vue', compile(descriptor.template.content, { bindingMetadata: script.bindings, mode: 'function', prefixIdentifiers: true }).code)(Vue);

afterEach(() => vi.unstubAllGlobals());

it('retained diagrams stop observation and pending geometry work when hidden, then remeasure on return', async () => {
  const observers = [];
  const frames = new Map();
  let nextFrame = 0;
  const bounds = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 300 }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  });
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const element = tag => ({ tag, props: {}, children: [], parent: null, clientWidth: 400, clientHeight: 300, scrollLeft: 0, scrollTop: 0,
    get dataset() { return { nodeId: this.props['data-node-id'] }; },
    getBoundingClientRect: bounds,
    querySelectorAll() { return descendants(this).filter(node => node.props['data-node-id']); }
  });
  const renderer = Vue.createRenderer({
    createElement: element, createText: text => ({ ...element('#text'), text }), createComment: () => element('#comment'),
    setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; node.children = []; },
    patchProp: (node, key, previous, value) => { node.props[key] = value; },
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent;
    },
    remove(node) { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  });
  const active = Vue.ref(true); const query = Vue.ref('');
  const graph = layeredGraph([{ id: 'a', title: 'Caller' }, { id: 'b', title: 'Dependency' }], [{ fromId: 'a', toId: 'b' }]);
  const app = renderer.createApp({ setup: () => () => Vue.h(Diagram, { active: active.value, query: query.value, graph, selectedId: 'a' }) });
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  const root = element('root');
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  try {
    app.mount(root); await Vue.nextTick(); flush(); await Vue.nextTick();
    expect(observers[0].targets.size).toBe(1);
    expect(descendants(root).filter(node => node.tag === 'path' && node.props.d?.startsWith('M'))).toHaveLength(2); // Marker and dependency.
    observers[0].callback();
    const lateFrame = [...frames.values()][0];
    active.value = false; await Vue.nextTick();
    expect(observers[0].targets.size).toBe(0);
    expect(frames.size).toBe(0);
    const before = bounds.mock.calls.length;
    lateFrame(); observers[0].callback(); query.value = 'Caller'; await Vue.nextTick();
    expect(frames.size).toBe(0);
    expect(bounds.mock.calls.length).toBe(before);
    active.value = true; await Vue.nextTick(); await Vue.nextTick(); flush();
    expect(observers[0].targets.size).toBe(1);
    expect(bounds.mock.calls.length).toBeGreaterThan(before);
    observers[0].callback();
    app.unmount();
    expect(frames.size).toBe(0);
    expect(observers[0].targets.size).toBe(0);
  } finally { if (root.children.length) app.unmount(); }
});
