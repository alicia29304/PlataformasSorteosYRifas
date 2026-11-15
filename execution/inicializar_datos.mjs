// Deja data/ en cero para una instalacion nueva: borra rifas, pagos y auditoria, y crea el
// primer administrador y la clave de datos. Las credenciales quedan en credenciales/, que
// no se sube a GitHub.
// Uso: node execution/inicializar_datos.mjs --confirmar
//      node execution/inicializar_datos.mjs --confirmar --dir C:\otra\copia   (otra carpeta)
//
// NO lo ejecutes en una instalacion en uso: borra todas sus rifas y pagos.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../services/verificador/package.json", import.meta.url));
const { Wallet } = require("ethers");

const i = process.argv.indexOf("--dir");
const raiz = i > 0 ? resolve(process.argv[i + 1]) : fileURLToPath(new URL("..", import.meta.url));
const data = join(raiz, "data");
const salida = join(raiz, "credenciales");

if (!process.argv.includes("--confirmar")) {
  console.error("Esto borra todas las rifas y pagos de data/. Si estás seguro, agrega --confirmar.");
  process.exit(1);
}
if (existsSync(join(salida, "credenciales-admin.json"))) {
  console.error("Ya existe credenciales/credenciales-admin.json. Muévelo a un lugar seguro antes de crear otro.");
  process.exit(1);
}

const escribir = (ruta, valor) => writeFileSync(ruta, `${JSON.stringify(valor, null, 2)}\n`);
for (const carpeta of ["rifas", "auditoria"]) {
  rmSync(join(data, carpeta), { recursive: true, force: true });
  mkdirSync(join(data, carpeta), { recursive: true });
}
for (const f of readdirSync(data)) if (f.endsWith(".json")) rmSync(join(data, f));

const admin = Wallet.createRandom();
const direccion = admin.address.toLowerCase();
const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
const publica = Buffer.from(await crypto.subtle.exportKey("raw", par.publicKey)).toString("base64");
const claveDatos = await crypto.subtle.exportKey("jwk", par.privateKey);

escribir(join(data, "roles.json"), { admins: [direccion], vendedores: {} });
escribir(join(data, "config.json"), { cifradoPublica: publica });
escribir(join(data, "nonces.json"), {});
escribir(join(data, "sesiones-revocadas.json"), {});
escribir(join(data, "rifas", "index.json"), []);
writeFileSync(join(data, "auditoria", ".gitkeep"), "");

mkdirSync(salida, { recursive: true });
escribir(join(salida, "credenciales-admin.json"), {
  tipo: "sorteosweb3-credenciales", direccion, clavePrivada: admin.privateKey, clavesCifrado: [claveDatos],
});
escribir(join(salida, "clave-datos.json"), claveDatos);

console.log("Datos en cero. Primer administrador:", direccion);
console.log("Credenciales en:", salida);
console.log("  credenciales-admin.json -> para entrar a la app de escritorio (guárdalo en un lugar seguro)");
console.log("  clave-datos.json        -> copia de respaldo de la clave de los datos privados");
console.log("Si se pierden, nadie podrá volver a leer los teléfonos de los compradores.");
