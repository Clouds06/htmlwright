import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["server/cli.ts", "server/native-host.ts"],
  format: ["esm"],
  platform: "node",
  outDir: "dist/server",
  sourcemap: true,
  clean: true,
  external: ["vite"],
  banner: { js: "#!/usr/bin/env node" },
});
