"use strict";

// Source entry point required by the root package.json.
// The TypeScript main process is compiled to dist-electron before Electron runs.
require("../dist-electron/main.js");
