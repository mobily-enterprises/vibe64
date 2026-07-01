const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

export { addPlacementTopology };
export default { placements };

const menuLinkRenderers = Object.freeze({
  link: "local.main.ui.surface-aware-menu-link-item"
});

const bottomNavLinkRenderers = Object.freeze({
  link: "local.main.ui.tab-link-item"
});

addPlacementTopology({
  id: "shell.primary-nav",
  description: "Primary navigation for the current surface.",
  surfaces: ["*"],
  default: true,
  variants: {
    compact: {
      outlet: "shell-layout:primary-bottom-nav",
      renderers: bottomNavLinkRenderers
    },
    medium: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "shell.secondary-nav",
  description: "Secondary navigation for the current surface.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "shell.identity",
  description: "Current surface identity and switcher controls.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:top-left"
    },
    medium: {
      outlet: "shell-layout:top-left"
    },
    expanded: {
      outlet: "shell-layout:top-left"
    }
  }
});

addPlacementTopology({
  id: "shell.status",
  description: "Surface status, connection, and utility indicators.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:top-right"
    },
    medium: {
      outlet: "shell-layout:top-right"
    },
    expanded: {
      outlet: "shell-layout:top-right"
    }
  }
});

addPlacementTopology({
  id: "shell.global-actions",
  description: "Global surface actions outside primary navigation.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:top-right",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "shell-layout:top-right",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:top-right",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "page.supporting-content",
  description: "Supporting page content that moves between compact and wide layouts.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:supporting-bottom-sheet"
    },
    medium: {
      outlet: "shell-layout:supporting-side-panel"
    },
    expanded: {
      outlet: "shell-layout:supporting-side-panel"
    }
  }
});

// jskit:ui-generator.topology:page.section-nav:app-dashboard
addPlacementTopology({
  id: "page.section-nav",
  owner: "app-dashboard",
  description: "Navigation between child pages in this section.",
  surfaces: ["app"],
  variants: {
    compact: {
      outlet: "app-dashboard:primary-menu",
      renderers: {
        link: "local.main.ui.surface-aware-menu-link-item"
      }
    },
    medium: {
      outlet: "app-dashboard:primary-menu",
      renderers: {
        link: "local.main.ui.surface-aware-menu-link-item"
      }
    },
    expanded: {
      outlet: "app-dashboard:primary-menu",
      renderers: {
        link: "local.main.ui.surface-aware-menu-link-item"
      }
    }
  }
});

addPlacementTopology({
  id: "page.active-session-nav",
  owner: "vibe64-session",
  description: "Navigation for tools owned by the selected Vibe64 session.",
  surfaces: ["app"],
  variants: {
    compact: {
      outlet: "app-dashboard:active-session-menu",
      renderers: {
        link: "local.main.vibe64.active-session-nav-item"
      }
    },
    medium: {
      outlet: "app-dashboard:active-session-menu",
      renderers: {
        link: "local.main.vibe64.active-session-nav-item"
      }
    },
    expanded: {
      outlet: "app-dashboard:active-session-menu",
      renderers: {
        link: "local.main.vibe64.active-session-nav-item"
      }
    }
  }
});
