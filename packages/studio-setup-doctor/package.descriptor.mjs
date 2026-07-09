export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/studio-setup-doctor",
  version: "0.1.0",
  kind: "runtime",
  description: "Mandatory local runtime Studio Setup checks and repairs for Studio.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-adapters",
    "@local/vibe64-core",
    "@local/vibe64-execution",
    "@local/setup-doctor-core",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [
      "feature.studio-setup-doctor"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/StudioSetupDoctorProvider.js",
          export: "StudioSetupDoctorProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/actions",
          summary: "Exports Studio Setup Doctor status and repair action definitions."
        }
      ],
      containerTokens: {
        server: [
          "feature.studio-setup-doctor.service"
        ],
        client: []
      }
    },
    jskit: {
      scaffoldShape: "feature-server-v1",
      scaffoldMode: "orchestrator",
      lane: "default"
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "json-rest-schema": "^1.0.16"
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
});
