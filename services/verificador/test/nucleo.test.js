import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { mensajeAFirmar } from "../src/mensaje.js";
import { procesar, ErrorFirma, VENTANA_S } from "../src/nucleo.js";

const AHORA = Math.floor(Date.parse("2026-11-06T12:00:00Z") / 1000);
const admin = Wallet.createRandom();
const vendedor = Wallet.createRandom();
const otroVendedor = Wallet.createRandom();
const extrano = Wallet.createRandom();
const dir = (w) => w.address.toLowerCase();

async function firmar(w, accion, datos, extra = {}) {
  const base = { accion, firmante: dir(w), fecha: AHORA, nonce: randomUUID(), datos, ...extra };
  return { ...base, firma: await w.signMessage(mensajeAFirmar(base)) };
}

const RIFA = { slug: "prueba", titulo: "Prueba", precioCop: 4000, min: 0, max: 99, finVentas: "2026-12-01T00:00:00Z", fechaSorteo: "2026-12-02T00:00:00Z" };
const PAGO = { slug: "prueba", numeros: [7, 8], seudonimo: "Ana G.", ciudad: "Cali", metodo: "NEQUI", codigoHash: `0x${"a".repeat(64)}`, privado: "enc1:QUJD" };

async function escenario() {
  const estado = { roles: { admins: [dir(admin)], vendedores: {} }, nonces: {}, rifas: {} };
  procesar(await firmar(admin, "crear_rifa", RIFA), estado, AHORA);
  procesar(await firmar(admin, "crear_rifa", { ...RIFA, slug: "otra" }), estado, AHORA);
  procesar(await firmar(admin, "asignar_vendedor", { direccion: dir(vendedor), nombre: "Alvaro", rifas: ["prueba"] }), estado, AHORA);
  procesar(await firmar(admin, "asignar_vendedor", { direccion: dir(otroVendedor), nombre: "Bea", rifas: ["otra"] }), estado, AHORA);
  return estado;
}

test("flujo completo: registrar y aprobar deja los numeros pagados", async () => {
  const e = await escenario();
  const reg = await firmar(vendedor, "registrar_pago", PAGO);
  assert.equal(procesar(reg, e, AHORA).resultado, "ACEPTADA");
  assert.equal(e.rifas.prueba.numeros["7"].estado, "PENDIENTE");
  const apr = procesar(await firmar(vendedor, "aprobar_pago", { slug: "prueba", orden: reg.nonce }), e, AHORA);
  assert.equal(apr.resultado, "ACEPTADA");
  assert.equal(e.rifas.prueba.numeros["8"].estado, "PAGADO");
  assert.equal(e.rifas.prueba.ordenes[reg.nonce].aprobadoPor, dir(vendedor));
});

test("una firma repetida se rechaza", async () => {
  const e = await escenario();
  const s = await firmar(vendedor, "registrar_pago", PAGO);
  procesar(s, e, AHORA);
  assert.throws(() => procesar(s, e, AHORA), ErrorFirma);
});

test("una firma vencida se rechaza", async () => {
  const e = await escenario();
  const s = await firmar(vendedor, "registrar_pago", PAGO, { fecha: AHORA - VENTANA_S - 1 });
  assert.throws(() => procesar(s, e, AHORA), /vencida/);
});

test("cambiar los datos despues de firmar invalida la firma", async () => {
  const e = await escenario();
  const s = await firmar(vendedor, "registrar_pago", PAGO);
  assert.throws(() => procesar({ ...s, datos: { ...PAGO, numeros: [50] } }, e, AHORA), ErrorFirma);
});

test("nadie puede firmar a nombre de otra cartera", async () => {
  const e = await escenario();
  const s = await firmar(extrano, "crear_rifa", RIFA);
  assert.throws(() => procesar({ ...s, firmante: dir(admin) }, e, AHORA), /no corresponde/);
});

test("una cartera sin rol no deja rastro", async () => {
  const e = await escenario();
  const antes = JSON.stringify(e);
  await assert.rejects(async () => procesar(await firmar(extrano, "registrar_pago", PAGO), e, AHORA), /no autorizada/);
  assert.equal(JSON.stringify(e), antes);
});

test("un vendedor solo opera sus rifas y no hace tareas de admin", async () => {
  const e = await escenario();
  const r = procesar(await firmar(otroVendedor, "registrar_pago", PAGO), e, AHORA);
  assert.equal(r.resultado, "RECHAZADA");
  assert.match(r.motivo, /no esta asignada/);
  assert.equal(procesar(await firmar(vendedor, "crear_rifa", { ...RIFA, slug: "x" }), e, AHORA).resultado, "RECHAZADA");
  const reg = await firmar(vendedor, "registrar_pago", PAGO);
  procesar(reg, e, AHORA);
  assert.equal(procesar(await firmar(vendedor, "anular_pago", { slug: "prueba", orden: reg.nonce, motivo: "x" }), e, AHORA).resultado, "RECHAZADA");
});

test("un numero ya tomado no se vende dos veces, y anular lo libera", async () => {
  const e = await escenario();
  const reg = await firmar(vendedor, "registrar_pago", PAGO);
  procesar(reg, e, AHORA);
  const r = procesar(await firmar(admin, "registrar_pago", { ...PAGO, numeros: [8, 9] }), e, AHORA);
  assert.equal(r.resultado, "RECHAZADA");
  assert.equal(e.rifas.prueba.numeros["9"], undefined, "es todo o nada");
  procesar(await firmar(admin, "anular_pago", { slug: "prueba", orden: reg.nonce, motivo: "no pago" }), e, AHORA);
  assert.equal(procesar(await firmar(admin, "registrar_pago", { ...PAGO, numeros: [8, 9] }), e, AHORA).resultado, "ACEPTADA");
});

test("los datos privados sin cifrar y los telefonos no entran al repositorio", async () => {
  const e = await escenario();
  const a = procesar(await firmar(vendedor, "registrar_pago", { ...PAGO, privado: "3001112233" }), e, AHORA);
  assert.match(a.motivo, /cifrados/);
  const b = procesar(await firmar(vendedor, "registrar_pago", { ...PAGO, seudonimo: "3001112233" }), e, AHORA);
  assert.match(b.motivo, /Nombre publico/);
  const c = procesar(await firmar(vendedor, "registrar_pago", { ...PAGO, telefono: "3001112233" }), e, AHORA);
  assert.match(c.motivo, /Campo no permitido/);
});

test("limite de numeros, rango y cierre de ventas", async () => {
  const e = await escenario();
  const muchos = Array.from({ length: 11 }, (_, i) => i);
  assert.equal(procesar(await firmar(vendedor, "registrar_pago", { ...PAGO, numeros: muchos }), e, AHORA).resultado, "RECHAZADA");
  assert.equal(procesar(await firmar(vendedor, "registrar_pago", { ...PAGO, numeros: [100] }), e, AHORA).resultado, "RECHAZADA");
  const tarde = AHORA + 40 * 86400;
  const s = await firmar(vendedor, "registrar_pago", PAGO, { fecha: tarde });
  assert.match(procesar(s, e, tarde).motivo, /cerraron/);
});

test("nombres especiales no contaminan el objeto", async () => {
  const e = await escenario();
  const r = procesar(await firmar(admin, "aprobar_pago", { slug: "__proto__", orden: "x" }), e, AHORA);
  assert.equal(r.resultado, "RECHAZADA");
  assert.equal(procesar(await firmar(admin, "aprobar_pago", { slug: "prueba", orden: "constructor" }), e, AHORA).resultado, "RECHAZADA");
  assert.throws(() => procesar({ accion: "constructor", firmante: dir(admin), fecha: AHORA, nonce: randomUUID(), datos: {}, firma: "0x" }, e, AHORA), /desconocida/);
});

test("los nonces viejos se purgan sin reabrir firmas vigentes", async () => {
  const e = await escenario();
  const viejo = await firmar(vendedor, "registrar_pago", PAGO);
  procesar(viejo, e, AHORA);
  const luego = AHORA + VENTANA_S * 2 + 1;
  procesar(await firmar(admin, "cambiar_estado_rifa", { slug: "prueba", estado: "ACTIVA" }, { fecha: luego }), e, luego);
  assert.equal(Object.hasOwn(e.nonces, viejo.nonce), false);
  assert.throws(() => procesar(viejo, e, luego), /vencida/);
});
