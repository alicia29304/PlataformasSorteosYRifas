// Prueba ganadores contra el sistema publicado, en una rifa propia para no tocar otras.
// Uso: node execution/prueba_ganador.mjs
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../services/verificador/package.json", import.meta.url));
const { Wallet } = require("ethers");
const { mensajeAFirmar } = await import("../services/verificador/src/mensaje.js");
const { elegirGanador } = await import("../services/verificador/src/nucleo.js");
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const BASE = "https://sorteos-web3.aliciagadiaz29304.workers.dev";
const SLUG = `prueba-ganadores-${Date.now().toString(36)}`;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function accion(nombre, datos) {
  const w = new Wallet(env.TEST_ADMIN_PRIVATE_KEY);
  const base = { accion: nombre, firmante: w.address.toLowerCase(), fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos };
  const r = await fetch(`${BASE}/api/accion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, firma: await w.signMessage(mensajeAFirmar(base)) }) });
  if (r.status !== 202) throw new Error(`${nombre}: HTTP ${r.status} ${await r.text()}`);
  for (let i = 0; i < 45; i++) {
    await pausa(3000);
    const e = await (await fetch(`${BASE}/api/resultado/${base.nonce}`)).json();
    if (e.estado !== "EN_PROCESO") { await pausa(9000); return { ...e, nonce: base.nonce }; }
  }
  return { estado: "SIN_REGISTRO" };
}
const ver = (t, e) => console.log(`${t}: ${e.estado}${e.motivo ? ` (${e.motivo})` : ""}`);
const rifa = async () => (await fetch(`${BASE}/api/rifas/${SLUG}?x=${Date.now()}`)).json();
const vender = (numeros, seudonimo) => accion("registrar_pago", { slug: SLUG, numeros, seudonimo, ciudad: "Tunja", metodo: "NEQUI", privado: `enc1:${randomBytes(24).toString("base64")}` });

const fin = new Date(Date.now() + 864e5).toISOString();
ver("Crear rifa", await accion("crear_rifa", { slug: SLUG, titulo: "Prueba de ganadores", descripcion: "Solo para pruebas.", precioCop: 1000, min: 0, max: 9, finVentas: fin, fechaSorteo: fin }));
const o1 = await vender([1, 2], "Ana G.");
const o2 = await vender([5], "Luis P.");
ver("Antes de cerrar", await accion("declarar_ganador", { slug: SLUG, modo: "EXTERNO", numero: 1, fuente: "Prueba" }));
await accion("cambiar_estado_rifa", { slug: SLUG, estado: "CERRADA" });
ver("Con pagos pendientes", await accion("declarar_ganador", { slug: SLUG, modo: "INTERNO" }));
await accion("aprobar_pago", { slug: SLUG, orden: o1.nonce });
await accion("aprobar_pago", { slug: SLUG, orden: o2.nonce });

ver("Sorteo interno", await accion("declarar_ganador", { slug: SLUG, modo: "INTERNO" }));
const g1 = (await rifa()).ganador;
console.log("  Ganador:", g1.numero, g1.seudonimo, "| ronda", g1.azar.ronda, "| participantes", g1.azar.participantes);
const publica = await (await fetch(`https://api.drand.sh/public/${g1.azar.ronda}`)).json();
console.log("  El valor coincide con drand:", publica.randomness === g1.azar.valor);
console.log("  Recalculado por fuera coincide:", elegirGanador([1, 2, 5], publica.randomness, SLUG) === g1.numero);
ver("Reabrir con ganador", await accion("cambiar_estado_rifa", { slug: SLUG, estado: "ACTIVA" }));

ver("Anular ganador", await accion("anular_ganador", { slug: SLUG, motivo: "prueba" }));
ver("Externo, numero sin vender", await accion("declarar_ganador", { slug: SLUG, modo: "EXTERNO", numero: 9, fuente: "Loteria de Boyaca, prueba" }));
const g2 = (await rifa()).ganador;
console.log("  Vendido:", g2.vendido, "| dueno:", g2.seudonimo);
await accion("anular_ganador", { slug: SLUG, motivo: "prueba" });
ver("Externo, numero vendido", await accion("declarar_ganador", { slug: SLUG, modo: "EXTERNO", numero: 5, fuente: "Loteria de Boyaca, prueba" }));
const final = await rifa();
console.log("  Ganador:", final.ganador.numero, final.ganador.seudonimo, final.ganador.ciudad, "| anulados a la vista:", final.ganadoresAnulados.length);
console.log("Rifa:", SLUG);
