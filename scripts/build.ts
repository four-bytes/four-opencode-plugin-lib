import { build } from "bun";

const result = await build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  minify: true,
  sourcemap: "external",
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
  minify: true,
  sourcemap: "external",
  external: ["solid-js", "@opentui/solid"],
});
if (!tuiResult.success) {
  console.error("TUI build failed:", tuiResult.logs);
  process.exit(1);
}

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
