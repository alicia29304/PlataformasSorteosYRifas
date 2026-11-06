// Prueba los comprobantes en R2 contra el Worker publicado, incluidos los accesos indebidos.
// Uso: node execution/prueba_comprobantes.mjs
import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../services/verificador/package.json", import.meta.url));
const { Wallet } = require("ethers");
const { mensajeAFirmar } = await import("../services/verificador/src/mensaje.js");
const { enviar: directo } = await import("./enviar_accion.mjs");
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);
const BASE = "https://sorteos-web3.aliciagadiaz29304.workers.dev";
const A = "rifa-prueba-web3";
const B = "rifa-numero-dos";
const K = { ADMIN: env.TEST_ADMIN_PRIVATE_KEY, VENDEDOR: env.TEST_VENDEDOR_PRIVATE_KEY, COMPRADOR: env.TEST_COMPRADOR_PRIVATE_KEY };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function sobre(rol, accion, datos) {
  const w = new Wallet(K[rol]);
  const base = { accion, firmante: w.address.toLowerCase(), fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos };
  return { ...base, firma: await w.signMessage(mensajeAFirmar(base)) };
}
const postear = (ruta, cuerpo) => fetch(`${BASE}/api/${ruta}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
async function esperar(nonce) {
  for (let i = 0; i < 45; i++) {
    await pausa(4000);
    const e = await (await fetch(`${BASE}/api/resultado/${nonce}`)).json();
    if (e.estado !== "EN_PROCESO") return `${e.estado}${e.motivo ? ` (${e.motivo})` : ""}`;
  }
  return "SIN_REGISTRO";
}
const pago = (slug, n, extra = {}) => ({ slug, numeros: [n], seudonimo: "Prueba C.", metodo: "NEQUI", privado: `enc1:${randomBytes(24).toString("base64")}`, ...extra });
const ver = async (rol, slug, orden) => {
  const r = await postear("comprobante", { ...(await sobre(rol, "ver_comprobantes", { slug })), orden });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : `HTTP ${r.status}`;
};
const libre = async (slug) => {
  const r = await (await fetch(`${BASE}/api/rifas/${slug}`)).json();
  for (let n = r.max; n >= r.min; n--) if (!r.numeros[String(n)]) return n;
  throw new Error("sin numeros libres");
};

const imagen = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
const hash = createHash("sha256").update(imagen).digest("hex");
const base64 = imagen.toString("base64");

const nA = await libre(A);
const regA = await sobre("VENDEDOR", "registrar_pago", pago(A, nA, { comprobanteHash: hash }));

const r0 = await postear("accion", await sobre("VENDEDOR", "registrar_pago", pago(A, nA, { comprobanteHash: hash })));
console.log("1. Hash sin imagen:", r0.status, "(debe ser 400)");
const malo = await postear("accion", { ...(await sobre("VENDEDOR", "registrar_pago", pago(A, nA, { comprobanteHash: "b".repeat(64) }))), comprobante: base64 });
console.log("2. Imagen que no coincide con la firma:", malo.status, "(debe ser 400)");
const noImg = await postear("accion", { ...(await sobre("VENDEDOR", "registrar_pago", pago(A, nA, { comprobanteHash: createHash("sha256").update("hola").digest("hex") }))), comprobante: Buffer.from("hola").toString("base64") });
console.log("3. Archivo que no es imagen:", noImg.status, "(debe ser 400)");

const ok = await postear("accion", { ...regA, comprobante: base64 });
console.log("4. Registro con comprobante:", ok.status, await esperar(regA.nonce));

const delVendedor = await ver("VENDEDOR", A, regA.nonce);
console.log("5. Lo abre su vendedor:", Buffer.isBuffer(delVendedor) && delVendedor.equals(imagen));
const delAdmin = await ver("ADMIN", A, regA.nonce);
console.log("6. Lo abre el admin:", Buffer.isBuffer(delAdmin) && delAdmin.equals(imagen));
console.log("7. Cartera sin rol:", await ver("COMPRADOR", A, regA.nonce), "(debe ser 403)");

// Vendedor de OTRA rifa: el intento real de leer un comprobante ajeno.
const asignar = await sobre("ADMIN", "asignar_vendedor", { direccion: env.TEST_COMPRADOR_ADDRESS, nombre: "Vendedor B", rifas: [B] });
console.log("   Asignar vendedor de la rifa B:", (await postear("accion", asignar)).status, await esperar(asignar.nonce));
await pausa(17000); // la cache de roles del Worker
console.log("8. Vendedor B pide la orden de A:", await ver("COMPRADOR", A, regA.nonce), "(debe ser 403)");
const nB = await libre(B);
const copia = await postear("accion", await sobre("COMPRADOR", "registrar_pago", pago(B, nB, { comprobanteHash: hash })));
console.log("9. Vendedor B declara el hash copiado:", copia.status, "(debe ser 400)");
// Aun si el hash llegara a una orden de B saltandose el Worker, no debe abrir nada.
const salto = await directo("COMPRADOR", "registrar_pago", pago(B, nB, { comprobanteHash: hash }));
console.log("   Orden en B con hash copiado, sin pasar por el Worker:", await esperar(salto.nonce));
await pausa(9000);
console.log("10. Vendedor B abre esa orden:", await ver("COMPRADOR", B, salto.nonce), "(debe ser 404)");

// Limpieza.
const anular = await sobre("ADMIN", "anular_pago", { slug: B, orden: salto.nonce, motivo: "prueba de seguridad" });
console.log("   Anular orden de prueba:", (await postear("accion", anular)).status, await esperar(anular.nonce));
const anularA = await sobre("ADMIN", "anular_pago", { slug: A, orden: regA.nonce, motivo: "prueba de comprobantes" });
console.log("   Anular orden de A:", (await postear("accion", anularA)).status, await esperar(anularA.nonce));
const quitar = await sobre("ADMIN", "revocar_vendedor", { direccion: env.TEST_COMPRADOR_ADDRESS });
console.log("   Quitar vendedor B:", (await postear("accion", quitar)).status, await esperar(quitar.nonce));
