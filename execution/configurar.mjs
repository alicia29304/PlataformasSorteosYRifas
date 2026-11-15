// Apunta el proyecto a otra cuenta de GitHub y otro Worker de Cloudflare.
// Lee los valores nuevos del .env y los reemplaza en los archivos que los usan.
// Uso: node execution/configurar.mjs            (aplica)
//      node execution/configurar.mjs --revisar  (solo muestra que cambiaria)
//
// .env:  GITHUB_OWNER, GITHUB_REPO, CLOUDFLARE_SUBDOMINIO (lo que va antes de .workers.dev)
//        WORKER_NOMBRE (opcional, por defecto sorteos-web3), R2_BUCKET (opcional)
import { readFileSync, writeFileSync } from "node:fs";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const env = Object.fromEntries(
  leer(".env").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const revisar = process.argv.includes("--revisar");

// Valores actuales, tomados de los propios archivos para poder repetir el script sin riesgo.
const actual = {
  repositorio: leer("services/verificador/src/mensaje.js").match(/REPOSITORIO = "([^"]+)"/)[1],
  web: leer("apps/web3/src/comun.js").match(/"(https:\/\/[^"]+\.workers\.dev)\/api"/)[1],
  worker: leer("services/relay/wrangler.toml").match(/^name = "([^"]+)"/m)[1],
  bucket: leer("services/relay/wrangler.toml").match(/^bucket_name = "([^"]+)"/m)[1],
};
const [ownerActual, repoActual] = actual.repositorio.split("/");

for (const k of ["GITHUB_OWNER", "GITHUB_REPO", "CLOUDFLARE_SUBDOMINIO"]) {
  if (!env[k]) { console.error(`Falta ${k} en el .env`); process.exit(1); }
}
const worker = env.WORKER_NOMBRE || actual.worker;
const nuevo = {
  owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, worker,
  web: `https://${worker}.${env.CLOUDFLARE_SUBDOMINIO}.workers.dev`,
  bucket: env.R2_BUCKET || `${worker}-comprobantes`,
};
const validos = /^[A-Za-z0-9_.-]+$/;
if (![nuevo.owner, nuevo.repo, nuevo.worker, nuevo.bucket, env.CLOUDFLARE_SUBDOMINIO].every((v) => validos.test(v))) {
  console.error("Algún valor del .env tiene caracteres no permitidos.");
  process.exit(1);
}

const cambios = [
  ["services/verificador/src/mensaje.js", `REPOSITORIO = "${actual.repositorio}"`, `REPOSITORIO = "${nuevo.owner}/${nuevo.repo}"`],
  ["services/relay/wrangler.toml", `name = "${actual.worker}"`, `name = "${nuevo.worker}"`],
  ["services/relay/wrangler.toml", `GITHUB_OWNER = "${ownerActual}"`, `GITHUB_OWNER = "${nuevo.owner}"`],
  ["services/relay/wrangler.toml", `GITHUB_REPO = "${repoActual}"`, `GITHUB_REPO = "${nuevo.repo}"`],
  ["services/relay/wrangler.toml", `bucket_name = "${actual.bucket}"`, `bucket_name = "${nuevo.bucket}"`],
  ["apps/web3/src/comun.js", `"${actual.web}/api"`, `"${nuevo.web}/api"`],
  ["apps/escritorio/ui/main.js", `const WEB = "${actual.web}";`, `const WEB = "${nuevo.web}";`],
  ["apps/escritorio/src-tauri/tauri.conf.json", actual.web, nuevo.web],
];

let total = 0;
for (const [ruta, de, a] of cambios) {
  if (de === a) continue;
  const texto = leer(ruta);
  if (!texto.includes(de)) { console.error(`No encontré "${de}" en ${ruta}. Revisa el archivo a mano.`); process.exit(1); }
  console.log(`${revisar ? "Cambiaría" : "Cambiado"} ${ruta}: ${de}  →  ${a}`);
  if (!revisar) writeFileSync(new URL(ruta, raiz), texto.split(de).join(a));
  total += 1;
}
console.log(total ? `\n${total} cambio(s). Web: ${nuevo.web}` : "Todo ya apunta a esa cuenta: no hay nada que cambiar.");
if (total && !revisar) console.log("Siguiente paso: node execution/inicializar_datos.mjs --confirmar");
