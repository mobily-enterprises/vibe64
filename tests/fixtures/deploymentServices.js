// A two-service application's Deployment section, as Genesis hands it to Vibe64: Memobot's, a public `web` (pages, the
// API and bots' turns) and an internal `computers` (bots' computers on bigger machines, each desktop in its own gVisor
// sandbox, reached instance by instance), with its files kept in a local folder in development. The deploy engine's
// tests read the same section and resources.
const MEMOBOT_DEPLOYMENT_LINES = Object.freeze([
  "",
  "- Runtimes: `nodejs`",
  "- Recreate on restore: `node_modules` `.tools`",
  "- Generated secrets: `AUTH_LOCAL_SESSION_SECRET` `MEMOBOT_VAULT_KEY` `AUTH_LOCAL_SECOND_FACTOR_KEY` `MEMOBOT_FILES_PASSPHRASE` `MEMOBOT_COMPUTERS_SECRET`",
  "- Setup code: `AUTH_LOCAL_SETUP_CODE`",
  "- Packages: `util-linux` `openssl` `gnugrep` `gnused` `findutils` `gnutar` `gzip` `bzip2` `xz` `zstd` `zip` `unzip` `p7zip` `diffutils` `gawk` `bc` `file` `less` `tree` `which` `procps` `ncurses` `hostname` `glibc` `perl` `git` `ripgrep` `python313` `python313Packages.pandas` `python313Packages.numpy` `python313Packages.matplotlib` `python313Packages.openpyxl` `python313Packages.python-docx` `python313Packages.python-pptx` `python313Packages.pillow` `python313Packages.xlsxwriter` `python313Packages.beautifulsoup4` `python313Packages.lxml` `python313Packages.pyyaml` `python313Packages.python-dateutil` `python313Packages.markdown` `python313Packages.typing-extensions` `python313Packages.pytz` `python313Packages.tzdata` `python313Packages.six` `python313Packages.contourpy` `python313Packages.cycler` `python313Packages.fonttools` `python313Packages.kiwisolver` `python313Packages.packaging` `python313Packages.pyparsing` `python313Packages.tkinter` `python313Packages.et-xmlfile` `python313Packages.soupsieve` `chromium` `xvfb` `x11vnc` `openbox` `fontconfig` `liberation_ttf` `dejavu_fonts` `noto-fonts-cjk-sans` `noto-fonts-cjk-serif` `noto-fonts-color-emoji` `tmux` `ffmpeg` `imagemagick` `libwebp` `libheif` `tesseract` `poppler-utils` `qpdf` `ghostscript` `pandoc` `jq` `sqlite` `hunspell` `hunspellDicts.en_GB-ise` `hunspellDicts.en_US` `nix-ld` `gcc-unwrapped^lib` `dpkg`",
  "- Prepare `Fetch public Memobot at the lock, install dependencies and tools, then compose from it`: `npm` `run` `deploy:prepare`",
  "- Build `Build`: `npm` `--prefix` `.memobot-server-generated/app` `run` `build`",
  "- Migrate `Migrate database`: `npm` `--prefix` `.memobot-server-generated/app` `run` `db:migrate`",
  "",
  "### Service `web`: pages, the API, bots' turns and their commands",
  "",
  "- Exposure: `public`",
  "- Serve `Start`: `node` `bin/memobot-server.js` `serve`",
  "- Ready when: `GET` `/api/health` returns `200`",
  "- Instances: `1` to `6`",
  "- Needs at least: `2` vCPU, `2` GiB memory",
  "- Production: `2` instances",
  "- Reaches: `computers` as `MEMOBOT_COMPUTERS_URL`",
  "- Sandbox allows: `gvisor`",
  "",
  "### Service `computers`: bots' computers, each desktop in its own gVisor sandbox",
  "",
  "- Exposure: `internal`",
  "- Reached: `each instance`",
  "- Serve `Start the computers agent`: `node` `bin/memobot-server.js` `serve`",
  "- Ready when: `GET` `/api/health` returns `200`",
  "- Instances: `1` to `20`",
  "- Needs at least: `8` vCPU, `16` GiB memory",
  "- Production: `2` instances",
  "- Setting `MEMOBOT_COMPUTERS_AGENT`: `1`",
  "- Packages: `tint2` `hsetroot` `xterm` `libx11` `libxcursor` `libxi` `libxkbcommon` `alsa-lib` `vulkan-loader` `mesa`",
  "- Sandbox allows: `gvisor`",
  "",
  "### Resource `files`",
  "",
  "- Development: `local folder`"
]);

// Its resources as Genesis inspects them: a PostgreSQL database and a bucket, each with its preferred bindings.
const MEMOBOT_RESOURCES = Object.freeze([
  {
    component: "jskit-postgresql",
    resource: {
      id: "database",
      kind: "postgresql",
      environmentAlternatives: [{
        preferred: true,
        bindings: { host: "DB_HOST", port: "DB_PORT", database: "DB_NAME", username: "DB_USER", password: "DB_PASSWORD" }
      }]
    }
  },
  {
    component: "jskit-storage",
    resource: {
      id: "files",
      kind: "bucket",
      environmentAlternatives: [{
        preferred: true,
        bindings: {
          bucket: "MEMOBOT_FILES_BUCKET", region: "MEMOBOT_FILES_REGION", endpoint: "MEMOBOT_FILES_ENDPOINT",
          accessKeyId: "MEMOBOT_FILES_KEY_ID", secretAccessKey: "MEMOBOT_FILES_SECRET"
        }
      }]
    }
  }
]);

const MEMOBOT_COMPUTERS_PACKAGES = Object.freeze(["tint2", "hsetroot", "xterm", "libx11", "libxcursor", "libxi", "libxkbcommon", "alsa-lib",
  "vulkan-loader", "mesa"]);

// The services the section describes, normalized.
const MEMOBOT_SERVICES = Object.freeze([
  {
    id: "web",
    summary: "pages, the API, bots' turns and their commands",
    exposure: "public",
    reached: "any",
    serve: { label: "Start", argv: ["node", "bin/memobot-server.js", "serve"] },
    readyWhen: { method: "GET", path: "/api/health", status: 200 },
    instances: { min: 1, max: 6, production: 2 },
    atLeast: { vcpus: 2, memoryGib: 2 },
    reaches: [{ service: "computers", setting: "MEMOBOT_COMPUTERS_URL" }],
    settings: {},
    packages: [],
    sandboxAllowances: ["gvisor"]
  },
  {
    id: "computers",
    summary: "bots' computers, each desktop in its own gVisor sandbox",
    exposure: "internal",
    reached: "each",
    serve: { label: "Start the computers agent", argv: ["node", "bin/memobot-server.js", "serve"] },
    readyWhen: { method: "GET", path: "/api/health", status: 200 },
    instances: { min: 1, max: 20, production: 2 },
    atLeast: { vcpus: 8, memoryGib: 16 },
    reaches: [],
    settings: { MEMOBOT_COMPUTERS_AGENT: "1" },
    packages: [...MEMOBOT_COMPUTERS_PACKAGES],
    sandboxAllowances: ["gvisor"]
  }
]);

export { MEMOBOT_COMPUTERS_PACKAGES, MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES, MEMOBOT_SERVICES };
