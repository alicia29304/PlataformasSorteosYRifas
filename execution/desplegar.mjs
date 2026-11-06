// Compila la web, publica el Worker en Cloudflare y deja una copia en Pinata.
// Uso: node execution/desplegar.mjs
// Los secretos salen del .env y no se imprimen.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const NOMBRE_PIN = "sorteos-web3-web";

function correr(cmd, cwd, entrada, extraEnv = {}) {
  const r = spawnSync(cmd, { cwd, input: entrada, shell: true, stdio: [entrada ? "pipe" : "ignore", "inherit", "inherit"], env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) throw new Error(`Fallo: ${cmd}`);
}

correr("npm run build", "apps/web3");

const cf = { CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID };
correr("npx wrangler deploy", "services/relay", undefined, cf);
if (process.argv.includes("--secreto")) {
  correr("npx wrangler secret put GITHUB_TOKEN", "services/relay", env.GITHUB_TOKEN_ALICIA, cf);
}

// Copia en IPFS: un solo pin; se retiran los anteriores para no gastar el plan gratuito.
const H = { Authorization: `Bearer ${env.PINATA_JWT}` };
const previos = await (await fetch(`https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=${NOMBRE_PIN}&pageLimit=50`, { headers: H })).json();

const form = new FormData();
const recorrer = (dir) => readdirSync(dir).flatMap((f) => {
  const ruta = join(dir, f);
  return statSync(ruta).isDirectory() ? recorrer(ruta) : [ruta];
});
for (const ruta of recorrer("apps/web3/dist")) {
  form.append("file", new Blob([readFileSync(ruta)]), `web/${relative("apps/web3/dist", ruta).replaceAll("\\", "/")}`);
}
form.append("pinataMetadata", JSON.stringify({ name: NOMBRE_PIN }));
form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
const subida = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: H, body: form });
const datos = await subida.json();
if (!subida.ok) throw new Error(`Pinata ${subida.status}: ${JSON.stringify(datos)}`);
console.log(`Copia en Pinata. CID: ${datos.IpfsHash}`);

for (const p of previos.rows ?? []) {
  if (p.ipfs_pin_hash === datos.IpfsHash) continue;
  const r = await fetch(`https://api.pinata.cloud/pinning/unpin/${p.ipfs_pin_hash}`, { method: "DELETE", headers: H });
  console.log(`Retirado pin anterior ${p.ipfs_pin_hash}: HTTP ${r.status}`);
}
