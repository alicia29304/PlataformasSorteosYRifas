import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { MAX_SESION_S, mensajeAFirmar, mensajeDelegacion } from "../src/mensaje.js";
import { elegirGanador, procesar, ErrorFirma, VENTANA_S } from "../src/nucleo.js";

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
const PAGO = { slug: "prueba", numeros: [7, 8], seudonimo: "Ana G.", ciudad: "Cali", metodo: "NEQUI", privado: "enc1:QUJD" };

async function escenario() {
  const estado = { roles: { admins: [dir(admin)], vendedores: {} }, nonces: {}, rifas: {}, sesionesRevocadas: {} };
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

test("una accion rechazada no publica lo que trajo", async () => {
  const e = await escenario();
  const TEL = "3001112233";
  for (const datos of [
    { ...PAGO, privado: TEL },
    { ...PAGO, seudonimo: TEL },
    { ...PAGO, [TEL]: "x" },
    { ...PAGO, numeros: [Number(TEL)] },
  ]) {
    const r = procesar(await firmar(vendedor, "registrar_pago", datos), e, AHORA);
    assert.equal(r.resultado, "RECHAZADA");
    assert.equal(r.datos, undefined);
    assert.match(r.datosHash, /^0x[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(r).includes(TEL), "no debe aparecer en la auditoria");
  }
  assert.ok(!JSON.stringify(e).includes(TEL), "ni en el estado");
});

test("comprobantes: al registrar o despues, y solo con hash valido", async () => {
  const e = await escenario();
  const H1 = "a".repeat(64);
  const H2 = "b".repeat(64);
  const reg = await firmar(vendedor, "registrar_pago", { ...PAGO, comprobanteHash: H1 });
  assert.equal(procesar(reg, e, AHORA).resultado, "ACEPTADA");
  assert.equal(e.rifas.prueba.ordenes[reg.nonce].comprobanteHash, H1);
  assert.match(procesar(await firmar(vendedor, "adjuntar_comprobante", { slug: "prueba", orden: reg.nonce, comprobanteHash: H2 }), e, AHORA).motivo, /ya tiene/);
  assert.equal(procesar(await firmar(admin, "adjuntar_comprobante", { slug: "prueba", orden: reg.nonce, comprobanteHash: H2 }), e, AHORA).resultado, "ACEPTADA");

  const sin = await firmar(vendedor, "registrar_pago", { ...PAGO, numeros: [20] });
  procesar(sin, e, AHORA);
  assert.match(procesar(await firmar(vendedor, "adjuntar_comprobante", { slug: "prueba", orden: sin.nonce, comprobanteHash: "../x" }), e, AHORA).motivo, /invalido/);
  assert.match(procesar(await firmar(otroVendedor, "adjuntar_comprobante", { slug: "prueba", orden: sin.nonce, comprobanteHash: H2 }), e, AHORA).motivo, /no esta asignada/);
  assert.equal(procesar(await firmar(vendedor, "adjuntar_comprobante", { slug: "prueba", orden: sin.nonce, comprobanteHash: H2 }), e, AHORA).resultado, "ACEPTADA");
});

test("el sorteo no puede ser antes del cierre", async () => {
  const e = await escenario();
  const r = procesar(await firmar(admin, "crear_rifa", { ...RIFA, slug: "mal", fechaSorteo: "2026-11-30T00:00:00Z" }), e, AHORA);
  assert.match(r.motivo, /antes del cierre/);
});

const AZAR = { fuente: "drand", ronda: 1, valor: "c".repeat(64) };
async function conVentas() {
  const e = await escenario();
  const reg = await firmar(vendedor, "registrar_pago", PAGO);
  procesar(reg, e, AHORA);
  procesar(await firmar(vendedor, "aprobar_pago", { slug: "prueba", orden: reg.nonce }), e, AHORA);
  return { e, orden: reg.nonce };
}
const cerrar = async (e) => procesar(await firmar(admin, "cambiar_estado_rifa", { slug: "prueba", estado: "CERRADA" }), e, AHORA);
const externo = (numero) => ({ slug: "prueba", modo: "EXTERNO", numero, fuente: "Loteria de Boyaca" });

test("ganador externo: numero vendido, y numero sin vender queda sin dueno", async () => {
  const { e, orden } = await conVentas();
  await cerrar(e);
  assert.equal(procesar(await firmar(admin, "declarar_ganador", externo(7)), e, AHORA).resultado, "ACEPTADA");
  const g = e.rifas.prueba.ganador;
  assert.deepEqual([g.vendido, g.seudonimo, g.orden, g.fuente], [true, "Ana G.", orden, "Loteria de Boyaca"]);

  const otro = await conVentas();
  await cerrar(otro.e);
  procesar(await firmar(admin, "declarar_ganador", externo(50)), otro.e, AHORA);
  assert.deepEqual([otro.e.rifas.prueba.ganador.vendido, otro.e.rifas.prueba.ganador.seudonimo], [false, null]);
});

test("ganador interno: sale de los pagados y se puede recalcular", async () => {
  const { e } = await conVentas();
  await cerrar(e);
  const s = await firmar(admin, "declarar_ganador", { slug: "prueba", modo: "INTERNO" });
  assert.equal(procesar(s, e, AHORA, AZAR).resultado, "ACEPTADA");
  const g = e.rifas.prueba.ganador;
  assert.ok([7, 8].includes(g.numero));
  assert.equal(g.numero, elegirGanador([8, 7], AZAR.valor, "prueba"), "no importa el orden");
  assert.deepEqual(g.azar, { ...AZAR, participantes: 2 });
});

test("el sorteo interno reparte entre todos los numeros", () => {
  const vistos = new Set();
  for (let i = 0; i < 200; i++) vistos.add(elegirGanador([1, 2, 3, 4], i.toString(16).padStart(64, "0"), "x"));
  assert.equal(vistos.size, 4);
});

test("sin azar publico o sin pagados no hay sorteo interno", async () => {
  const { e } = await conVentas();
  await cerrar(e);
  assert.match(procesar(await firmar(admin, "declarar_ganador", { slug: "prueba", modo: "INTERNO" }), e, AHORA).motivo, /azar publico/);
  assert.match(procesar(await firmar(admin, "declarar_ganador", { slug: "otra", modo: "INTERNO" }), e, AHORA, AZAR).motivo, /Cierra las ventas/);
  procesar(await firmar(admin, "cambiar_estado_rifa", { slug: "otra", estado: "CERRADA" }), e, AHORA);
  assert.match(procesar(await firmar(admin, "declarar_ganador", { slug: "otra", modo: "INTERNO" }), e, AHORA, AZAR).motivo, /No hay numeros/);
  assert.match(procesar(await firmar(admin, "declarar_ganador", { slug: "prueba", modo: "INTERNO", numero: 8 }), e, AHORA, AZAR).motivo, /no recibe numero/);
});

test("reglas del ganador: rol, ventas abiertas, pendientes y rango", async () => {
  const { e } = await conVentas();
  assert.match(procesar(await firmar(admin, "declarar_ganador", externo(7)), e, AHORA).motivo, /Cierra las ventas/);
  await cerrar(e);
  assert.match(procesar(await firmar(vendedor, "declarar_ganador", externo(7)), e, AHORA).motivo, /administrador/);
  assert.match(procesar(await firmar(admin, "declarar_ganador", externo(500)), e, AHORA).motivo, /fuera de rango/);
  assert.match(procesar(await firmar(admin, "declarar_ganador", { ...externo(7), fuente: "" }), e, AHORA).motivo, /Sorteo de referencia/);

  const conPendiente = await escenario();
  procesar(await firmar(vendedor, "registrar_pago", PAGO), conPendiente, AHORA);
  await cerrar(conPendiente);
  assert.match(procesar(await firmar(admin, "declarar_ganador", externo(7)), conPendiente, AHORA).motivo, /pendientes/);
});

test("con ganador no se reabre ni se anula su orden; anularlo deja rastro", async () => {
  const { e, orden } = await conVentas();
  await cerrar(e);
  procesar(await firmar(admin, "declarar_ganador", externo(7)), e, AHORA);
  assert.match(procesar(await firmar(admin, "declarar_ganador", externo(8)), e, AHORA).motivo, /ya tiene ganador/);
  assert.match(procesar(await firmar(admin, "cambiar_estado_rifa", { slug: "prueba", estado: "ACTIVA" }), e, AHORA).motivo, /ya tiene ganador/);
  assert.match(procesar(await firmar(admin, "anular_pago", { slug: "prueba", orden, motivo: "x" }), e, AHORA).motivo, /ganador/);
  assert.equal(procesar(await firmar(vendedor, "anular_ganador", { slug: "prueba", motivo: "x" }), e, AHORA).resultado, "RECHAZADA");

  assert.equal(procesar(await firmar(admin, "anular_ganador", { slug: "prueba", motivo: "numero mal escrito" }), e, AHORA).resultado, "ACEPTADA");
  assert.equal(e.rifas.prueba.ganador, undefined);
  assert.equal(e.rifas.prueba.ganadoresAnulados[0].numero, 7);
  assert.equal(e.rifas.prueba.ganadoresAnulados[0].motivoAnulacion, "numero mal escrito");
  assert.equal(procesar(await firmar(admin, "declarar_ganador", externo(8)), e, AHORA).resultado, "ACEPTADA");
});

async function delegar(cartera, expira = AHORA + 86400) {
  const clave = Wallet.createRandom();
  const sesion = dir(clave);
  const firma = await cartera.signMessage(mensajeDelegacion({ firmante: dir(cartera), sesion, expira }));
  return { clave, delegacion: { sesion, expira, firma } };
}
async function conSesion(s, accion, datos, firmante = admin, extra = {}) {
  const base = { accion, firmante: dir(firmante), fecha: AHORA, nonce: randomUUID(), datos, ...extra };
  return { ...base, delegacion: s.delegacion, firma: await s.clave.signMessage(mensajeAFirmar(base)) };
}
const CERRAR = { slug: "prueba", estado: "CERRADA" };

test("sesion: la clave autorizada firma en nombre de la cartera", async () => {
  const e = await escenario();
  const s = await delegar(admin);
  const r = procesar(await conSesion(s, "cambiar_estado_rifa", CERRAR), e, AHORA);
  assert.equal(r.resultado, "ACEPTADA");
  assert.equal(r.firmante, dir(admin));
  assert.equal(r.delegacion.sesion, s.delegacion.sesion, "queda en la auditoria");
});

test("sesion: otra clave, otra cartera o datos alterados no pasan", async () => {
  const e = await escenario();
  const s = await delegar(admin);
  const intruso = { ...s, clave: Wallet.createRandom() };
  await assert.rejects(async () => procesar(await conSesion(intruso, "cambiar_estado_rifa", CERRAR), e, AHORA), /no firmo/);
  // La delegacion de un extrano no sirve para hacerse pasar por el admin.
  const ajena = await delegar(extrano);
  await assert.rejects(async () => procesar(await conSesion(ajena, "cambiar_estado_rifa", CERRAR), e, AHORA), /no autorizo/);
  const buena = await conSesion(s, "cambiar_estado_rifa", CERRAR);
  assert.throws(() => procesar({ ...buena, datos: { slug: "otra", estado: "CERRADA" } }, e, AHORA), /no firmo/);
  await assert.rejects(async () => procesar(await conSesion(s, "cambiar_estado_rifa", CERRAR, vendedor), e, AHORA), /no autorizo/);
});

test("sesion: el rol lo pone la cartera, no la clave", async () => {
  const e = await escenario();
  const s = await delegar(vendedor);
  const r = procesar(await conSesion(s, "crear_rifa", { ...RIFA, slug: "x" }, vendedor), e, AHORA);
  assert.match(r.motivo, /administrador/);
  const propia = await delegar(extrano);
  await assert.rejects(async () => procesar(await conSesion(propia, "cambiar_estado_rifa", CERRAR, extrano), e, AHORA), /no autorizada/);
  // Quitarle el rol a la cartera anula sus sesiones.
  const deAdmin = await delegar(admin);
  e.roles.admins = [];
  await assert.rejects(async () => procesar(await conSesion(deAdmin, "cambiar_estado_rifa", CERRAR), e, AHORA), /no autorizada/);
});

test("sesion: vencida o con vigencia excesiva se rechaza", async () => {
  const e = await escenario();
  await assert.rejects(async () => procesar(await conSesion(await delegar(admin, AHORA - 1), "cambiar_estado_rifa", CERRAR), e, AHORA), /vencida/);
  await assert.rejects(async () => procesar(await conSesion(await delegar(admin, AHORA + MAX_SESION_S + 1), "cambiar_estado_rifa", CERRAR), e, AHORA), /vencida/);
  const mal = await conSesion(await delegar(admin), "cambiar_estado_rifa", CERRAR);
  assert.throws(() => procesar({ ...mal, delegacion: { sesion: "x" } }, e, AHORA), /mal formada/);
});

test("sesion: al cerrarla deja de valer, y solo su dueno o un admin puede cerrarla", async () => {
  const e = await escenario();
  const s = await delegar(admin);
  const v = await delegar(vendedor);
  const ajena = procesar(await conSesion(v, "revocar_sesion", { sesion: s.delegacion.sesion }, vendedor), e, AHORA);
  assert.match(ajena.motivo, /propia sesion/);
  assert.equal(procesar(await conSesion(s, "revocar_sesion", { sesion: s.delegacion.sesion }), e, AHORA).resultado, "ACEPTADA");
  await assert.rejects(async () => procesar(await conSesion(s, "cambiar_estado_rifa", CERRAR), e, AHORA), /Sesion cerrada/);
  assert.equal(procesar(await firmar(admin, "cambiar_estado_rifa", CERRAR), e, AHORA).resultado, "ACEPTADA", "la cartera sigue valiendo");
  // Otra sesion nueva funciona.
  assert.equal(procesar(await conSesion(await delegar(admin), "cambiar_estado_rifa", CERRAR), e, AHORA).resultado, "ACEPTADA");
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
