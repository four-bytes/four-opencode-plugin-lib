import { build } from "bun";
import { rmSync } from "node:fs";

// Clear stale artifacts (e.g. old untranspiled .jsx copies) before rebuilding
rmSync("dist", { recursive: true, force: true });

const result = await build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  minify: true,
  external: ["@opencode-ai/plugin"],
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

// Build TUI entry point (separate bundle for opencode TUI plugins)
const tuiResult = await build({
  entrypoints: ["src/tui.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  // No minify: opencode rewrites `from "solid-js"` imports by regex on the
  // built output, and minified `from"solid-js"` (no space) does not match.
  external: ["solid-js", "@opentui/solid"],
});
if (!tuiResult.success) {
  console.error("TUI build failed:", tuiResult.logs);
  process.exit(1);
}

// TUI components now ship as raw .ts with `opentui:runtime-module:*` virtual-id
// imports (no JSX, no build step) — see src/virtual-modules.d.ts and tui.ts.

// Generate declarations with tsc
const { spawnSync } = await import("child_process");
const tsc = spawnSync("npx", ["tsc", "--emitDeclarationOnly", "--declaration"], {
  stdio: "inherit",
  cwd: process.cwd(),
});
if (tsc.status !== 0) {
  console.error("TSC declaration generation failed");
  process.exit(1);
}

console.log("✅ Built @four-bytes/opencode-plugin-lib");
