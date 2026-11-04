// readable-check: allow module-state - shared resource: every terminal on the page loads the one xterm module once, and a failed load is retried by the next terminal
let xtermModulePromise = null;

async function loadXtermModules() {
  if (!xtermModulePromise) {
    xtermModulePromise = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/xterm/css/xterm.css")
    ])
      .then(([terminalModule, fitModule]) => ({
        FitAddon: fitModule.FitAddon,
        Terminal: terminalModule.Terminal
      }))
      .catch((error) => {
        xtermModulePromise = null;
        throw error;
      });
  }
  return xtermModulePromise;
}

export {
  loadXtermModules
};
