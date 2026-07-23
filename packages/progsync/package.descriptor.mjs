const descriptor = {
  packageVersion: 1,
  packageId: "@local/progsync",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Program parsing, projection, Git-aware synchronization, and the standalone progsync CLI.",
  dependsOn: [],
  capabilities: {
    provides: [
      "library.progsync"
    ],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: ".",
          summary: "Exposes extraction-ready Program parsing, indexing, and synchronization APIs."
        },
        {
          subpath: "./cli",
          summary: "Exposes the standalone ProgSync command-line entrypoint."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    },
    jskit: {
      scaffoldShape: "library-v1",
      scaffoldMode: "manual",
      lane: "default"
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@babel/parser": "^7.29.3",
        "@vue/compiler-dom": "^3.5.34",
        "@vue/compiler-sfc": "^3.5.34"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
};

function deepFreeze(value) {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

export default deepFreeze(descriptor);
