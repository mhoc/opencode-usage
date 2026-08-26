import { runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const hostModules = new Set(["@opentui/solid", "solid-js"])
const solidPlugin = createSolidTransformPlugin({
  moduleName: runtimeModuleIdForSpecifier("@opentui/solid"),
  resolvePath(specifier) {
    return hostModules.has(specifier) ? runtimeModuleIdForSpecifier(specifier) : null
  },
})

const result = await Bun.build({
  entrypoints: ["src/index.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [solidPlugin],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
