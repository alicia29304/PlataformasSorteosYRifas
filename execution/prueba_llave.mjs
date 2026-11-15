// Prueba la entrega automatica de la clave a un vendedor, contra el sistema publicado.
// Uso: node execution/prueba_llave.mjs
// Usa la cartera de vendedor de prueba y entrega la clave de datos real, cerrada para ella.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../services/verificador/package.json", import.meta.url));
const { Wallet } = require("ethers");
const { mensajeAFirmar } = await import("../services/verificador/src/mensaje.js");
const { cifrar, descifrar } = await import("../apps/web3/src/cifrado.js");
const candado = async () => {
  const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  return { privada: k.privateKey, publica: Buffer.from(await crypto.subtle.exportKey("raw", k.publicKey)).toString("base64") };
};
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const BASE = "https://sorteos-web3.aliciagadiaz29304.workers.dev";
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function accion(clave, nombre, datos) {
  const w = new Wallet(clave);
  const base = { accion: nombre, firmante: w.address.toLowerCase(), fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos };
  const r = await fetch(`${BASE}/api/accion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, firma: await w.signMessage(mensajeAFirmar(base)) }) });
  if (r.status !== 202) return `HTTP ${r.status} ${await r.text()}`;
  for (let i = 0; i < 40; i++) {
    await pausa(3000);
    const e = await (await fetch(`${BASE}/api/resultado/${base.nonce}`)).json();
    if (e.estado !== "EN_PROCESO") { await pausa(16000); return `${e.estado}${e.motivo ? ` (${e.motivo})` : ""}`; }
  }
  return "SIN_REGISTRO";
}
const roles = async () => (await fetch(`${BASE}/api/roles?x=${Date.now()}`)).json();

// Vendedor temporal sin rifas, con una clave de mentira: no toca vendedores ni datos reales.
const vendedor = Wallet.createRandom();
const yo = vendedor.address.toLowerCase();
const falsa = [{ kty: "EC", crv: "P-256", d: "clave-de-mentira-para-la-prueba" }];
console.log("0. Admin agrega vendedor temporal:", await accion(env.TEST_ADMIN_PRIVATE_KEY, "asignar_vendedor", { direccion: yo, nombre: "Prueba temporal", rifas: [] }));
const { privada, publica } = await candado();
console.log("1. Vendedor publica su candado (un toque):", await accion(vendedor.privateKey, "registrar_llave", { publica }));
console.log("2. La app del admin entrega:", await accion(env.TEST_ADMIN_PRIVATE_KEY, "entregar_llave", { direccion: yo, para: publica, cifrado: await cifrar(falsa, publica) }));
const final = (await roles()).vendedores[yo].llave;
console.log("3. El vendedor la abre:", (await descifrar(final.entrega.cifrado, privada))[0].d === falsa[0].d);
const extrano = await candado();
console.log("4. Otro candado no puede abrirla:", await descifrar(final.entrega.cifrado, extrano.privada).then(() => "SE PUDO").catch(() => "bloqueado"));
console.log("5. Lo publico no trae la clave en claro:", !JSON.stringify(final).includes(falsa[0].d));
console.log("6. Editar al vendedor conserva su acceso:", await accion(env.TEST_ADMIN_PRIVATE_KEY, "asignar_vendedor", { direccion: yo, nombre: "Prueba temporal 2", rifas: [] }), Boolean((await roles()).vendedores[yo].llave.entrega));
console.log("7. Quitar vendedor temporal:", await accion(env.TEST_ADMIN_PRIVATE_KEY, "revocar_vendedor", { direccion: yo }), "| sigue en la lista:", Object.hasOwn((await roles()).vendedores, yo));
