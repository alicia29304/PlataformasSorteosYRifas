// Empaqueta la web en dist/: un solo directorio, con rutas relativas para IPFS.
import { cpSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/main.js"], outfile: "dist/app.js",
  bundle: true, minify: true, format: "esm", target: "es2021",
});
