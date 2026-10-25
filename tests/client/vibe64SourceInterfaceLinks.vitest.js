import { renderToString } from '@vue/server-renderer';
import * as Vue from 'vue';
import { expect, it, vi } from 'vitest';

vi.mock('vuetify/components/VBtn', () => ({ VBtn: { setup: (_, { slots }) => () => Vue.h('button', slots.default?.()) } }));
vi.mock('vuetify/components/VAlert', () => ({ VAlert: { setup: (_, { slots }) => () => Vue.h('aside', slots.default?.()) } }));
const linkHandlers = [];
vi.mock('@jskit-ai/assistant-core/client/conversation', () => ({ LongTextPreviewBlocks: {
  inheritAttrs: false, setup: (_, { attrs }) => { linkHandlers.push(attrs.onLinkClick); return () => Vue.h('div'); },
} }));
import Interface from '../../src/components/studio/vibe64-session/Vibe64SourceInterface.vue';

async function renderedLinkHandler() {
  linkHandlers.length = 0;
  const events = [];
  const app = Vue.createSSRApp(Interface, {
    filePath: 'engine.rs', indexed: true, current: true, presentation: 'description',
    interpretations: [{ path: 'engine.rs', scope: 'file', symbolId: '', presentation: 'description', body: 'See [storage](storage.py).', status: 'current' }],
    programs: [{ id: 'load', path: 'genesis/program/load.md', mainSource: 'engine.rs', title: 'Load' }],
    onOpenProgram: (id) => events.push(['open-program', id]),
    onOpenSource: (target) => events.push(['open-source', target.path]),
  });
  await renderToString(app);
  return { events, openLink: linkHandlers[0] };
}

function click() {
  return { preventDefault: vi.fn() };
}

it('opens a text-only path link the same way the explanation panel does', async () => {
  const { events, openLink } = await renderedLinkHandler();
  const event = click();
  openLink({ event, href: '', text: 'src/storage.py' });
  expect(events).toEqual([['open-source', 'src/storage.py']]);
  expect(event.preventDefault).toHaveBeenCalled();
});

it("opens this file's Program and hands any other Program document to the host", async () => {
  const { events, openLink } = await renderedLinkHandler();
  openLink({ event: click(), href: 'genesis/program/load.md' });
  openLink({ event: click(), href: 'genesis/program/other.md' });
  expect(events).toEqual([['open-program', 'load'], ['open-source', 'genesis/program/other.md']]);
});

it('leaves web links to the browser', async () => {
  const { events, openLink } = await renderedLinkHandler();
  const event = click();
  openLink({ event, href: 'https://example.com/' });
  expect(events).toEqual([]);
  expect(event.preventDefault).not.toHaveBeenCalled();
});
