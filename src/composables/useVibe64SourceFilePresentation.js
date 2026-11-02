import { computed, ref, toRef, watch } from "vue";
import { Marked } from "marked";
import { useVibe64SystemGraph } from "@local/vibe64-system-graph/client";
import { filePreviewImageType } from "@local/vibe64-source-editor/shared/fileTypes";
import { markdownDocumentLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { vibe64SourceEditorDownloadPath } from "@/lib/vibe64SessionRequestConfig.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { sourceEditorPathIsMarkdown } from "@/lib/vibe64SourceFilePaths.js";

/**
 * How the selected source file is shown: its Interface (public symbols with
 * their saved descriptions and steps), its Code, or the Markdown document or
 * image it renders; and which of them a newly selected file opens in.
 * @param {object} options
 * @param {ReturnType<typeof import("@/composables/useVibe64SourceEditor.js").useVibe64SourceEditor>} options.editor
 * @param {(location: { path: string, symbolId: string, presentation: string, symbolPresentation: string }) => void} options.onInterfaceLocation
 *   Told where a single-file reader is, for its host to record.
 * @param {{ active: boolean, architectureFacts: object | null, assistantAvailable: boolean, codeFocusMode: boolean,
 *   openRequest: object | null, projectSlug: string, sessionId: string, sessionsApiPath: string, singleFile: boolean }} options.props
 *   The source editor's props.
 */
function useVibe64SourceFilePresentation({
  editor,
  onInterfaceLocation,
  props
}) {
  const filePresentation = ref('interface');
  const interfaceSymbolId = ref('');
  const symbolPresentation = ref('description');
  // Architecture supplies its existing snapshot at mount. Only
  // standalone file browsing owns another graph reader.
  const interfaceGraph = props.architectureFacts ? null : useVibe64SystemGraph({ active: toRef(props, 'active'), sessionId: toRef(props, 'sessionId') });
  const interfaceArchitecture = computed(() => props.architectureFacts || interfaceGraph?.architecture.value);
  const interfaceFile = computed(() => interfaceArchitecture.value?.files?.find(file => file.path === editor.selectedPath.value));
  const interfaceCurrent = computed(() => interfaceFile.value?.hash === `sha256:${editor.savedHash.value}` && !editor.dirty.value);
  const interfaceSymbols = computed(() => (interfaceArchitecture.value?.symbols || []).filter(symbol => symbol.fileId === interfaceFile.value?.id && symbol.visibility === 'public'));
  const interfacePrograms = computed(() => (interfaceArchitecture.value?.program?.modules || []).filter(program => program.sources.includes(editor.selectedPath.value)));
  const interfaceSymbol = computed(() => interfaceSymbols.value.find(symbol => symbol.id === interfaceSymbolId.value));
  const interfaceSymbolSource = computed(() => {
    const symbol = interfaceSymbol.value;
    if (!symbol?.end || !interfaceCurrent.value) return '';
    const lines = editor.text.value.split('\n');
    const selected = lines.slice(symbol.start.line - 1, symbol.end.line);
    if (!selected.length) return '';
    selected[selected.length - 1] = selected.at(-1).slice(0, symbol.end.column - 1);
    selected[0] = selected[0].slice(symbol.start.column - 1);
    return selected.join('\n');
  });
  function selectInterfaceSymbol(id) { interfaceSymbolId.value = id; symbolPresentation.value = 'steps'; }
  function currentInterpretation(scope, symbolId, presentation) {
    return editor.interpretations.value.find(record => record.path === editor.selectedPath.value && record.scope === scope && (record.symbolId || '') === symbolId && record.presentation === presentation && record.status === 'current' && record.fileHash === editor.savedHash.value);
  }
  const activeInterfaceInterpretation = computed(() => {
    const range = editor.activeExplanation.value?.sourceRange;
    return Boolean(range?.path === editor.selectedPath.value && range.presentation === symbolPresentation.value
      && (range.symbolId || '') === interfaceSymbolId.value && range.scope === (interfaceSymbolId.value ? 'selection' : 'file'));
  });
  const activeFileInterpretation = computed(() => {
    const range = editor.activeExplanation.value?.sourceRange;
    return range?.path === editor.selectedPath.value && range.scope === 'file' && range.presentation === 'description';
  });
  function presentFileOverview(force = false) {
    if (!force && currentInterpretation('file', '', 'description')) return;
    if (!editor.selectedPath.value || editor.dirty.value || !props.assistantAvailable || editor.explanationBusy.value || editor.explanationClosing.value) return;
    const lines = editor.text.value.split('\n');
    void editor.explainSelection({ scope: 'file', presentation: 'description', force, expectedHash: editor.savedHash.value, startLine: 1, startColumn: 1, endLine: lines.length, endColumn: lines.at(-1).length + 1 });
  }
  function presentInterfaceSymbol(presentation, force = false) {
    symbolPresentation.value = presentation;
    const symbol = interfaceSymbol.value;
    if (presentation !== 'steps' || !Array.isArray(symbol?.parameters) || !symbol?.end || !interfaceCurrent.value || !props.assistantAvailable || editor.explanationBusy.value || editor.explanationClosing.value) return;
    if (!force && currentInterpretation('selection', symbol.id, presentation)) return;
    void editor.explainSelection({ scope: 'selection', symbolId: symbol.id, presentation, force, expectedHash: editor.savedHash.value, startLine: symbol.start.line, startColumn: symbol.start.column, endLine: symbol.end.line, endColumn: symbol.end.column });
  }
  // The file browser opens Markdown formatted; the header switches to its source.
  // GithubMarkdown sanitizes the HTML against its allowlist before display.
  // Embedded single-file views keep Interface/Code, which their host records.
  const markdownRenderable = computed(() => !props.singleFile && sourceEditorPathIsMarkdown(editor.selectedPath.value));
  // SVG opens as the image it draws (from the saved file), with its source a click away.
  const svgRenderable = computed(() => !props.singleFile && filePreviewImageType(editor.selectedPath.value) === 'image/svg+xml');
  const markdownRenderer = new Marked({
    async: false,
    gfm: true,
    walkTokens(token) {
      // Images in the document load from this session's files, like the image preview.
      const path = token.type === 'image' && markdownDocumentLinkTarget(editor.selectedPath.value, token.href);
      if (path) token.href = scopedDevelopmentApiUrl(
        vibe64SourceEditorDownloadPath(readRefOrGetterValue(props.sessionsApiPath), props.sessionId, path),
        props.projectSlug
      );
    }
  });
  const renderedMarkdownHtml = computed(() => filePresentation.value === 'rendered' && markdownRenderable.value ? markdownRenderer.parse(editor.text.value) : '');
  watch(editor.selectedPath, () => {
    const codeRequested = props.codeFocusMode || props.openRequest?.presentation === 'code' && props.openRequest?.path === editor.selectedPath.value;
    filePresentation.value = codeRequested ? 'code' : markdownRenderable.value || svgRenderable.value ? 'rendered' : 'interface';
    interfaceSymbolId.value = ''; symbolPresentation.value = 'description';
  });
  function openMarkdownLink(event) {
    const anchor = event.target?.closest('a[href]');
    if (!anchor) return;
    // Links must not navigate the editor page itself.
    event.preventDefault();
    const target = anchor.getAttribute('href').trim();
    if (/^(?:https?:|mailto:)/iu.test(target)) {
      globalThis.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    const path = markdownDocumentLinkTarget(editor.selectedPath.value, target);
    if (path) void editor.openFile(path);
  }
  watch([interfaceSymbols, interfaceCurrent, () => props.openRequest], () => {
    if (props.openRequest?.path !== editor.selectedPath.value || !interfaceCurrent.value) return;
    const requested = interfaceSymbols.value.find(symbol => symbol.id === props.openRequest.symbolId || (props.openRequest.symbol && (symbol.qualifiedName === props.openRequest.symbol || symbol.name === props.openRequest.symbol)));
    if (requested && requested.id !== interfaceSymbolId.value) selectInterfaceSymbol(requested.id);
    if (props.openRequest.symbolPresentation) symbolPresentation.value = props.openRequest.symbolPresentation;
  });
  watch([editor.selectedPath, interfaceSymbolId, filePresentation, symbolPresentation], () => {
    if (props.singleFile && props.active && interfaceCurrent.value && editor.selectedPath.value) onInterfaceLocation({
      path: editor.selectedPath.value, symbolId: interfaceSymbolId.value,
      presentation: filePresentation.value, symbolPresentation: symbolPresentation.value
    });
  }, { flush: 'post' });
  const imagePreviewVersion = ref(0);
  // Binary images open as images; an SVG does when its image view is chosen.
  const imagePreviewUrl = computed(() => {
    const filePath = editor.downloadOnlyFile.value?.path ||
      (svgRenderable.value && filePresentation.value === 'rendered' ? editor.selectedPath.value : "");
    if (editor.loadingFile.value || !filePreviewImageType(filePath)) return "";
    return scopedDevelopmentApiUrl(
      `${vibe64SourceEditorDownloadPath(readRefOrGetterValue(props.sessionsApiPath), props.sessionId, filePath)}&inline=1`,
      props.projectSlug
    );
  });

  return {
    activeFileInterpretation,
    activeInterfaceInterpretation,
    filePresentation,
    imagePreviewUrl,
    imagePreviewVersion,
    interfaceArchitecture,
    interfaceCurrent,
    interfaceFile,
    interfaceGraph,
    interfacePrograms,
    interfaceSymbolId,
    interfaceSymbolSource,
    interfaceSymbols,
    markdownRenderable,
    openMarkdownLink,
    presentFileOverview,
    presentInterfaceSymbol,
    renderedMarkdownHtml,
    selectInterfaceSymbol,
    svgRenderable,
    symbolPresentation
  };
}

export { useVibe64SourceFilePresentation };
