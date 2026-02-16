import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const SHEBANG = "#!/usr/bin/env node\n";
const FILE = "dist/cli.js";

const content = readFileSync(FILE, "utf8");

if (!content.startsWith("#!")) {
  writeFileSync(FILE, SHEBANG + content);
}

chmodSync(FILE, 0o755);
