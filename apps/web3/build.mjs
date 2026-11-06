// Empaqueta la web en dist/: un solo directorio, con rutas relativas para IPFS.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
// El id de WalletConnect es publico: identifica la app, no da acceso a nada.
const rutaEnv = "../../.env";
const idWc = process.env.WALLETCONNECT_PROJECT_ID
  ?? (existsSync(rutaEnv) ? readFileSync(rutaEnv, "utf8").match(/^WALLETCONNECT_PROJECT_ID=(.*)$/m)?.[1].trim() : "") ?? "";
await build({
  entryPoints: { app: "src/main.js" }, outdir: "dist", splitting: true, chunkNames: "c-[hash]",
  bundle: true, minify: true, format: "esm", target: "es2021",
  define: {
    "process.env.NODE_ENV": '"production"', global: "globalThis",
    __WC_PROJECT_ID__: JSON.stringify(idWc),
  },
});
