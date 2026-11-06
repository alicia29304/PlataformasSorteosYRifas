// Crea la clave con la que se cifran los datos privados de los compradores.
// La publica va a data/config.json; la privada se guarda en un archivo FUERA del repositorio.
// Uso: node execution/nueva_clave_cifrado.mjs "C:\ruta\privada\clave-admin.json"
//
// Los pagos ya registrados siguen necesitando la clave anterior: no la borres.
import { existsSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const salida = process.argv[2] && resolve(process.argv[2]);
const repo = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (!salida) { console.error("Indica la ruta del archivo de la clave privada."); process.exit(1); }
if (salida.startsWith(repo + sep)) { console.error("La clave privada no puede guardarse dentro del repositorio."); process.exit(1); }
if (existsSync(salida)) { console.error("Ese archivo ya existe; no se sobrescribe."); process.exit(1); }

const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
const publica = Buffer.from(await crypto.subtle.exportKey("raw", k.publicKey)).toString("base64");
writeFileSync(salida, JSON.stringify(await crypto.subtle.exportKey("jwk", k.privateKey)), { flag: "wx" });
writeFileSync(resolve(repo, "data/config.json"), `${JSON.stringify({ cifradoPublica: publica }, null, 2)}\n`);
console.log("Clave privada guardada en:", salida);
console.log("Sube data/config.json al repositorio para empezar a usarla.");
