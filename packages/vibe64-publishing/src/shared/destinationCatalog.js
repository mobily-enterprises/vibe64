// What the Publish page tells a person about each destination before they add
// it: what it is, what it needs, how long the first and later releases take and
// what it costs. Zero-account destinations come first.
const PUBLISH_DESTINATION_CATALOG = Object.freeze([
  Object.freeze({
    id: "android-sideload",
    label: "Install on my phone",
    shortLabel: "Phone APK",
    summary: "A signed Android app you install from a QR code. No store account.",
    packers: Object.freeze(["capacitor"]),
    zeroAccount: true,
    firstTime: "About 10 minutes, mostly a one-time 1.9 GB download of Android's build tools",
    repeat: "About 2 minutes",
    cost: "Free",
    needs: Object.freeze([
      "An app package (Capacitor, Android) in the project's Packaging section",
      "Accepting Google's Android SDK licence, once on this computer",
      "An install key Vibe64 creates, kept in your publishing keys, with a recovery kit"
    ])
  }),
  Object.freeze({
    id: "github-releases",
    label: "GitHub Releases",
    shortLabel: "GitHub release",
    summary: "Attach the built files to a release of this project's GitHub repository.",
    packers: Object.freeze(["npm", "python-dist", "capacitor", "web-bundle"]),
    zeroAccount: true,
    firstTime: "About 2 minutes",
    repeat: "About 1 minute",
    cost: "Free",
    needs: Object.freeze([
      "This project's repository on GitHub, with the saved work pushed",
      "A GitHub sign-in that can create releases (your GitHub CLI sign-in works)"
    ])
  }),
  Object.freeze({
    id: "npm",
    label: "npm",
    shortLabel: "npm",
    summary: "Publish a JavaScript library people install with npm install.",
    packers: Object.freeze(["npm"]),
    zeroAccount: false,
    firstTime: "About 5 minutes, including creating an access token on npmjs.com",
    repeat: "About 1 minute",
    cost: "Free for public packages",
    needs: Object.freeze([
      "An npm package in the project's Packaging section",
      "An npm account with two-factor authentication and a publish token"
    ])
  }),
  Object.freeze({
    id: "pypi",
    label: "PyPI",
    shortLabel: "PyPI",
    summary: "Publish a Python library people install with pip install.",
    packers: Object.freeze(["python-dist"]),
    zeroAccount: false,
    firstTime: "About 5 minutes, including creating an API token on pypi.org",
    repeat: "About 1 minute",
    cost: "Free",
    needs: Object.freeze([
      "A Python package in the project's Packaging section",
      "A PyPI account and an API token"
    ])
  })
]);

const PUBLISH_ACCOUNT_KINDS = Object.freeze({
  npm: Object.freeze({ id: "npm", label: "npm", destination: "npm", tokenLabel: "npm access token", addressLabel: "Registry", defaultAddress: "https://registry.npmjs.org/" }),
  pypi: Object.freeze({ id: "pypi", label: "PyPI", destination: "pypi", tokenLabel: "PyPI API token", addressLabel: "Upload address", defaultAddress: "https://upload.pypi.org/legacy/" }),
  github: Object.freeze({ id: "github", label: "GitHub", destination: "github-releases", tokenLabel: "GitHub token", addressLabel: "", defaultAddress: "" })
});

export { PUBLISH_ACCOUNT_KINDS, PUBLISH_DESTINATION_CATALOG };
