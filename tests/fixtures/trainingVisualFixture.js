function browserVisualResource(resource) {
  const encode = file => ({ path: file.path, encoding: "base64", bytes: Buffer.from(file.bytes).toString("base64") });
  return { ...resource, svg: encode(resource.svg), controller: encode(resource.controller), assets: resource.assets.map(encode) };
}

// A separate, deliberately small authored visual exercises the generic host
// boundary. It is not a substitute for the published topic controller.
function alternateVisualResource() {
  const visual = { schemaVersion: 1, id: "alternate", title: "Alternate diagram", description: "A labelled indicator.",
    states: ["idle", "shown"], initialState: "idle", commands: [
      { name: "advance", completionState: "shown", parameters: [{ name: "label", required: true, maxLength: 24 }] },
      { name: "probe", completionState: "unchanged", parameters: [] },
      { name: "stall", completionState: "unchanged", parameters: [] }
    ] };
  const controller = `export function mountVisual(svg, port, init) {
    let state = init.snapshot?.state ?? init.initialState;
    let labels = { caption: init.snapshot?.labels.caption ?? 'Waiting' };
    let disposed = false;
    const send = (type, fields = {}) => port.postMessage({ protocolVersion: 1, playerInstanceId: init.playerInstanceId, type, state, ...fields });
    const render = () => { svg.querySelector('text').textContent = labels.caption; };
    port.onmessage = async ({ data }) => {
      if (disposed || data.playerInstanceId !== init.playerInstanceId || data.protocolVersion !== 1) return;
      if (data.type === 'snapshot') { send('snapshot', { requestId: data.requestId, paused: false, labels, description: labels.caption }); return; }
      send('accepted', { commandId: data.commandId });
      if (data.name === 'stall') return;
      if (data.name === 'probe') {
        let parentBlocked = false, networkBlocked = false;
        try { void parent.document.body; } catch { parentBlocked = true; }
        try { await fetch('/api/private'); } catch { networkBlocked = true; }
        labels.caption = parentBlocked && networkBlocked ? 'Isolation confirmed' : 'Isolation failed';
      } else {
        if (!init.reducedMotion) await svg.querySelector('circle').animate([{ opacity: .2 }, { opacity: 1 }], { duration: 180 }).finished;
        state = 'shown'; labels.caption = data.parameters.label;
      }
      if (disposed) return;
      render(); send('completed', { commandId: data.commandId, description: labels.caption });
    };
    port.start(); render(); send('ready', { commands: ['advance', 'probe', 'stall'], description: labels.caption });
    return () => { disposed = true; port.onmessage = null; port.close(); };
  }`;
  return browserVisualResource({ id: visual.id, visual,
    svg: { path: "alternate/diagram.svg", bytes: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" role="img"><title>Alternate diagram</title><circle cx="30" cy="40" r="20"/><text x="10" y="100" font-size="18">Waiting</text></svg>' },
    controller: { path: "alternate/controller.js", bytes: controller }, assets: [] });
}

export { alternateVisualResource, browserVisualResource };
