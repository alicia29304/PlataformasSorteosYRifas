// Comprueba las credenciales del .env sin imprimir sus valores.
// Uso: node execution/verificar_credenciales.mjs
import { readFileSync } from "node:fs";

export function leerEnv(ruta = new URL("../.env", import.meta.url)) {
  const env = {};
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = leerEnv();
const faltan = ["PINATA_API_KEY", "PINATA_API_SECRET", "PINATA_JWT", "GITHUB_TOKEN_ALICIA", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]
  .filter((k) => !env[k]);
console.log("Campos vacios:", faltan.length ? faltan.join(", ") : "ninguno");

async function revisar(nombre, fn) {
  try { console.log(`${nombre}: ${await fn()}`); }
  catch (e) { console.log(`${nombre}: ERROR ${e.message}`); }
}

await revisar("Pinata JWT", async () => {
  const r = await fetch("https://api.pinata.cloud/data/testAuthentication", { headers: { Authorization: `Bearer ${env.PINATA_JWT}` } });
  return `HTTP ${r.status}`;
});
await revisar("Pinata API Key", async () => {
  const r = await fetch("https://api.pinata.cloud/data/testAuthentication", { headers: { pinata_api_key: env.PINATA_API_KEY, pinata_secret_api_key: env.PINATA_API_SECRET } });
  return `HTTP ${r.status}`;
});
await revisar("GitHub", async () => {
  const h = { Authorization: `Bearer ${env.GITHUB_TOKEN_ALICIA}`, Accept: "application/vnd.github+json" };
  const yo = await fetch("https://api.github.com/user", { headers: h });
  const u = yo.ok ? (await yo.json()).login : "(token de grano fino sin lectura de perfil)";
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`, { headers: h });
  const d = await r.json();
  return `usuario=${u} repo=HTTP ${r.status} push=${d.permissions?.push ?? "?"}`;
});
await revisar("Cloudflare token", async () => {
  const r = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  const d = await r.json();
  return `HTTP ${r.status} estado=${d.result?.status ?? "?"}`;
});
await revisar("Cloudflare cuenta", async () => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  const d = await r.json();
  return `HTTP ${r.status} workers=${d.result?.length ?? "?"}`;
});
