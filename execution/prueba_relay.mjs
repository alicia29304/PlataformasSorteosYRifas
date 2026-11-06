// Prueba el Worker publicado: lectura, ataques y una accion firmada.
// Uso: node execution/prueba_relay.mjs
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../services/verificador/package.json", import.meta.url));
const { Wallet } = require("ethers");
const { mensajeAFirmar } = await import("../services/verificador/src/mensaje.js");
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const BASE = "https://sorteos-web3.aliciagadiaz29304.workers.dev";
const SLUG = "rifa-prueba-web3";

async function sobre(clave, accion, datos, extra = {}) {
  const w = new Wallet(clave);
  const base = { accion, firmante: w.address.toLowerCase(), fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos, ...extra };
  return { ...base, firma: await w.signMessage(mensajeAFirmar(base)) };
}
const enviar = async (s) => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/accion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
  return `HTTP ${r.status} ${(await r.text()).slice(0, 90)} (${Date.now() - t0} ms)`;
};

for (const ruta of ["/api/rifas", `/api/rifas/${SLUG}`, "/api/roles", "/api/config", "/api/rifas/__proto__", "/api/nada"]) {
  const r = await fetch(BASE + ruta);
  console.log(ruta, "HTTP", r.status);
}
const rifa = await (await fetch(`${BASE}/api/rifas/${SLUG}`)).json();
console.log("Vista publica sin datos cifrados:", !JSON.stringify(rifa).includes("enc1:"));

const web = await fetch(BASE + "/");
console.log("Web HTTP", web.status, "| CSP:", Boolean(web.headers.get("content-security-policy")), "| no-sniff:", web.headers.get("x-content-type-options"));

const datos = { slug: "rifa-numero-dos", estado: "CERRADA" };
console.log("JSON roto:", (await fetch(`${BASE}/api/accion`, { method: "POST", body: "{" })).status);
console.log("Sin firma:", await enviar({ accion: "crear_rifa", firmante: env.TEST_ADMIN_ADDRESS, fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos: {} }));
const ajeno = await sobre(Wallet.createRandom().privateKey, "cambiar_estado_rifa", datos);
console.log("Firma a nombre del admin:", await enviar({ ...ajeno, firmante: env.TEST_ADMIN_ADDRESS }));
console.log("Cartera sin rol:", await enviar(await sobre(env.TEST_COMPRADOR_PRIVATE_KEY, "cambiar_estado_rifa", datos)));
console.log("Firma vencida:", await enviar(await sobre(env.TEST_ADMIN_PRIVATE_KEY, "cambiar_estado_rifa", datos, { fecha: Math.floor(Date.now() / 1000) - 3600 })));

const robado = await sobre(env.TEST_VENDEDOR_PRIVATE_KEY, "adjuntar_comprobante", { slug: SLUG, orden: "00000000-0000-4000-8000-000000000000", comprobanteHash: "a".repeat(64) });
console.log("Hash sin imagen:", await enviar(robado));

const bueno = await sobre(env.TEST_ADMIN_PRIVATE_KEY, "cambiar_estado_rifa", datos);
console.log("Admin firmado:", await enviar(bueno));
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const e = await (await fetch(`${BASE}/api/resultado/${bueno.nonce}`)).json();
  if (e.estado !== "EN_PROCESO") { console.log(`Resultado tras ${(i + 1) * 4}s:`, e.estado); break; }
}

// Sesion delegada: firma de la clave local, con la cartera autorizando una sola vez.
const { mensajeDelegacion } = await import("../services/verificador/src/mensaje.js");
const admin = new Wallet(env.TEST_ADMIN_PRIVATE_KEY);
const clave = Wallet.createRandom();
const sesionDir = clave.address.toLowerCase();
const expira = Math.floor(Date.now() / 1000) + 3600;
const delegacion = { sesion: sesionDir, expira, firma: await admin.signMessage(mensajeDelegacion({ firmante: admin.address.toLowerCase(), sesion: sesionDir, expira })) };
async function conSesion(accion, d) {
  const base = { accion, firmante: admin.address.toLowerCase(), fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos: d };
  return { ...base, delegacion, firma: await clave.signMessage(mensajeAFirmar(base)) };
}
async function resultado(nonce) {
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const e = await (await fetch(`${BASE}/api/resultado/${nonce}`)).json();
    if (e.estado !== "EN_PROCESO") return e.estado;
  }
  return "SIN_REGISTRO";
}
const cerradaOk = { slug: "rifa-numero-dos", estado: "CERRADA" };
const s1 = await conSesion("cambiar_estado_rifa", cerradaOk);
console.log("Sesion, cambio sin tocar la cartera:", await enviar(s1), await resultado(s1.nonce));
const lectura = await conSesion("ver_comprobantes", { slug: SLUG });
console.log("Sesion, leer comprobante inexistente:", (await fetch(`${BASE}/api/comprobante`, { method: "POST", body: JSON.stringify({ ...lectura, orden: "00000000-0000-4000-8000-000000000000" }) })).status, "(404 = paso la firma)");
const fin = await conSesion("revocar_sesion", { sesion: sesionDir });
console.log("Cerrar sesion:", await enviar(fin), await resultado(fin.nonce));
await new Promise((r) => setTimeout(r, 8000));
console.log("Sesion cerrada, otro cambio:", await enviar(await conSesion("cambiar_estado_rifa", cerradaOk)));
const l2 = await conSesion("ver_comprobantes", { slug: SLUG });
console.log("Sesion cerrada, leer:", (await fetch(`${BASE}/api/comprobante`, { method: "POST", body: JSON.stringify({ ...l2, orden: "00000000-0000-4000-8000-000000000000" }) })).status, "(debe ser 403)");
