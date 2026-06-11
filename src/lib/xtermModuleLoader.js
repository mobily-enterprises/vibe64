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
