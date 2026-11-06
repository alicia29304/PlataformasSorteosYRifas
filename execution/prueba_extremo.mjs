// Prueba de punta a punta contra GitHub Actions real, con las carteras de prueba.
// Uso: node execution/prueba_extremo.mjs
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { enviar } from "./enviar_accion.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const SLUG = "rifa-prueba-web3";
const API = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
const H = { Authorization: `Bearer ${env.GITHUB_TOKEN_ALICIA}`, Accept: "application/vnd.github.raw+json" };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function auditoria() {
  const mes = new Date().toISOString().slice(0, 7);
  const r = await fetch(`${API}/contents/data/auditoria/${mes}.jsonl?ref=main&t=${Date.now()}`, { headers: H });
  if (!r.ok) return [];
  return (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
}
async function esperar(nonce, maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const e = (await auditoria()).find((x) => x.nonce === nonce);
    if (e) return { ...e, segundos: Math.round((Date.now() - t0) / 1000) };
    await pausa(5000);
  }
  return { resultado: "SIN_REGISTRO", segundos: Math.round((Date.now() - t0) / 1000) };
}
const pago = (numeros, seudonimo) => ({
  slug: SLUG, numeros, seudonimo, ciudad: "Cali", metodo: "NEQUI",
  privado: `enc1:${randomBytes(24).toString("base64")}`,
});
const ver = (nombre, e) => console.log(`${nombre}: ${e.resultado}${e.motivo ? ` (${e.motivo})` : ""} en ${e.segundos}s`);

const fin = new Date(Date.now() + 30 * 864e5).toISOString();
const sorteo = new Date(Date.now() + 31 * 864e5).toISOString();

ver("1. Admin crea la rifa", await esperar((await enviar("ADMIN", "crear_rifa", {
  slug: SLUG, titulo: "Rifa de prueba Web3", descripcion: "Solo para pruebas. No es un sorteo real.",
  precioCop: 1000, min: 0, max: 99, finVentas: fin, fechaSorteo: sorteo,
})).nonce));

const vendedor = env.TEST_VENDEDOR_ADDRESS;
ver("2. Admin asigna vendedor", await esperar((await enviar("ADMIN", "asignar_vendedor", {
  direccion: vendedor, nombre: "Vendedor de prueba", rifas: [SLUG],
})).nonce));

const n = 10 + Math.floor(Math.random() * 80);
const reg = await enviar("VENDEDOR", "registrar_pago", pago([n], "Ana G."));
ver("3. Vendedor registra pago", await esperar(reg.nonce));
ver("4. Vendedor aprueba", await esperar((await enviar("VENDEDOR", "aprobar_pago", { slug: SLUG, orden: reg.nonce })).nonce));
ver("5. Vendedor intenta anular", await esperar((await enviar("VENDEDOR", "anular_pago", { slug: SLUG, orden: reg.nonce, motivo: "x" })).nonce));

// Dos ventas simultaneas del mismo numero: solo una puede ganar.
const m = n === 99 ? 98 : n + 1;
const [a, b] = await Promise.all([
  enviar("VENDEDOR", "registrar_pago", pago([m], "Luis P.")),
  enviar("ADMIN", "registrar_pago", pago([m], "Eva R.")),
]);
const [ea, eb] = await Promise.all([esperar(a.nonce), esperar(b.nonce)]);
ver("6a. Venta simultanea A", ea);
ver("6b. Venta simultanea B", eb);

// Ataques: no deben dejar rastro.
const sinRol = await enviar("COMPRADOR", "registrar_pago", pago([5], "Mal O."));
const repetida = reg;
await fetch(`${API}/dispatches`, {
  method: "POST", headers: H,
  body: JSON.stringify({ event_type: "accion-firmada", client_payload: repetida }),
});
await pausa(75000);
const final = await auditoria();
console.log("7. Cartera sin rol dejo rastro:", final.some((x) => x.nonce === sinRol.nonce));
console.log("8. Firma repetida aplicada veces:", final.filter((x) => x.nonce === repetida.nonce).length);

const runs = await (await fetch(`${API}/actions/runs?event=repository_dispatch&per_page=4`, { headers: { ...H, Accept: "application/vnd.github+json" } })).json();
console.log("Ultimas ejecuciones:", runs.workflow_runs.map((r) => `${r.conclusion}`).join(", "));

const rifa = await (await fetch(`${API}/contents/data/rifas/${SLUG}.json?ref=main&t=${Date.now()}`, { headers: H })).json();
console.log("Numero vendido:", n, JSON.stringify(rifa.numeros[String(n)]?.estado), "| disputado:", m, JSON.stringify(rifa.numeros[String(m)]?.estado));

const crudo = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/main/data/rifas/${SLUG}.json`;
const pub = await fetch(crudo);
console.log("Lectura publica sin token: HTTP", pub.status, "CORS:", pub.headers.get("access-control-allow-origin"), "cache:", pub.headers.get("cache-control"));
