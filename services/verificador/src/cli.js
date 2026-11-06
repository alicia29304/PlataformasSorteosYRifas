// Punto de entrada de GitHub Actions. Lee el sobre de SOBRE_JSON, lo aplica y publica.
//
// Sin `concurrency` en el workflow: GitHub deja una sola ejecucion en espera y descarta
// las demas, asi que en una rafaga se perderian ventas. En su lugar cada ejecucion parte
// del ultimo commit y, si otra se le adelanta, reintenta desde cero. Al repetirse la
// verificacion sobre datos nuevos, dos ventas del mismo numero no pueden colarse.

import { execFileSync } from "node:child_process";
import { setTimeout as esperar } from "node:timers/promises";
import { cargar, guardar } from "./almacen.js";
import { procesar, ErrorFirma } from "./nucleo.js";

const INTENTOS = 8;
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();

const sobre = JSON.parse(process.env.SOBRE_JSON || "null");

/** Azar publico de drand, tomado despues de firmar: el administrador no podia conocerlo. */
async function azarPublico() {
  if (sobre?.accion !== "declarar_ganador" || sobre?.datos?.modo !== "INTERNO") return null;
  try {
    const r = await fetch("https://api.drand.sh/public/latest", { signal: AbortSignal.timeout(10000) });
    const { round, randomness } = await r.json();
    return Number.isInteger(round) && /^[0-9a-f]{64}$/.test(randomness) ? { fuente: "drand", ronda: round, valor: randomness } : null;
  } catch {
    return null;
  }
}

for (let intento = 1; intento <= INTENTOS; intento++) {
  git("fetch", "origin", "main");
  git("reset", "--hard", "origin/main");

  const estado = cargar("data");
  let entrada;
  try {
    entrada = procesar(sobre, estado, undefined, await azarPublico());
  } catch (e) {
    if (e instanceof ErrorFirma) {
      console.error(`Rechazada sin registrar: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  guardar("data", estado, entrada);

  git("add", "--", "data");
  // accion y firmante ya estan validados; execFile no pasa por un shell.
  git("commit", "-m", `${entrada.accion} (${entrada.resultado}) firmado por ${entrada.firmante}`);
  try {
    git("push", "origin", "HEAD:main");
    console.log(`${entrada.resultado}: ${entrada.accion} ${entrada.nonce}${entrada.motivo ? ` - ${entrada.motivo}` : ""}`);
    process.exit(0);
  } catch {
    console.log(`Otro cambio se adelanto (intento ${intento}); reintentando.`);
    await esperar(500 + Math.random() * 2000 * intento);
  }
}
console.error("No se pudo publicar tras varios intentos.");
process.exit(1);
