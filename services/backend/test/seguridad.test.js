// Regresiones de SEGURIDAD. Cada prueba aqui corresponde a un fallo real
// corregido: si alguien revierte la correccion, esta suite se pone roja.
//
// Estas pruebas corren SIN WOMPI_EVENTS_KEY ni DATABASE_URL (el entorno por
// defecto del `npm test`), que es justo el escenario "mal configurado" que
// antes dejaba la puerta abierta.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { handler } from "../src/app.js";
import { safeEqualStr, signJwt, verifyJwt } from "../src/crypto-utils.js";
import { verifyEventSignature, computeEventChecksum } from "../src/wompi.js";

function pedir(server, method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: server.address().port, method, path,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: (() => { try { return JSON.parse(data); } catch { return data; } })(),
        }));
      }
    );
    if (body && method !== "GET") req.write(JSON.stringify(body));
    req.end();
  });
}

async function servidor(t) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  return server;
}

// --------------------------- Webhook de pagos ---------------------------

test("CRITICO: sin WOMPI_EVENTS_KEY el webhook RECHAZA el evento (no lo acepta a ciegas)", async (t) => {
  const server = await servidor(t);

  // Evento falsificado: aprueba una compra sin haber pagado un peso.
  const falso = {
    data: { transaction: { id: "fake-tx-1", reference: "ORD-loquesea", status: "APPROVED" } },
    timestamp: 1,
    signature: { checksum: "no-importa", properties: ["transaction.id"] },
  };

  const r = await pedir(server, "POST", "/api/webhooks/wompi", { body: falso });

  // Antes respondia 200 y VENDIA los numeros. Ahora debe negarse.
  assert.notEqual(r.status, 200, "un evento sin firma verificable jamas debe aceptarse");
  assert.equal(r.status, 503, "sin llave de eventos configurada: fail-closed");
});

test("la verificacion de firma acepta el checksum correcto y rechaza el manipulado", () => {
  const secreto = "test_events_secreto";
  const evento = {
    data: { transaction: { id: "tx-1", status: "APPROVED", amount_in_cents: 5000 } },
    timestamp: 1730000000,
    signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum: "" },
  };
  evento.signature.checksum = computeEventChecksum(evento, secreto);

  assert.equal(verifyEventSignature(evento, secreto), true);
  // Cambiar el monto invalida la firma (no se puede inflar un pago ya firmado).
  const manipulado = JSON.parse(JSON.stringify(evento));
  manipulado.data.transaction.amount_in_cents = 1;
  assert.equal(verifyEventSignature(manipulado, secreto), false);
  // Y con otro secreto tampoco valida.
  assert.equal(verifyEventSignature(evento, "otro"), false);
});

// --------------------------- Cabeceras de seguridad ---------------------------

test("las respuestas de la API traen cabeceras de seguridad", async (t) => {
  const server = await servidor(t);
  const r = await pedir(server, "GET", "/health");

  assert.equal(r.status, 200);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["x-frame-options"], "DENY");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.match(r.headers["content-security-policy"] || "", /frame-ancestors 'none'/);
});

// --------------------------- Comparacion de secretos ---------------------------

test("safeEqualStr compara sin filtrar el secreto por tiempos", () => {
  assert.equal(safeEqualStr("Bearer abc", "Bearer abc"), true);
  assert.equal(safeEqualStr("Bearer abc", "Bearer abd"), false);
  assert.equal(safeEqualStr("corta", "mucho mas larga"), false, "longitudes distintas");
  assert.equal(safeEqualStr("", ""), true);
  assert.equal(safeEqualStr(undefined, "algo"), false);
});

// --------------------------- JWT ---------------------------

test("JWT: no se puede falsificar cambiando el algoritmo a 'none'", () => {
  const secreto = "secreto-de-pruebas";
  const bueno = signJwt({ sub: "u1", role: "OPERATOR" }, secreto, 900);
  assert.equal(verifyJwt(bueno, secreto).role, "OPERATOR");

  // Token "alg: none" con rol elevado y sin firma: debe rechazarse.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const falso = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "u1", role: "SUPER_ADMIN", exp: 9e9 })}.`;
  assert.equal(verifyJwt(falso, secreto), null, "alg:none jamas debe validar");

  // Payload manipulado (escalada de rol) con la firma original: invalido.
  const [, , firma] = bueno.split(".");
  const manipulado = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", role: "SUPER_ADMIN", exp: 9e9 })}.${firma}`;
  assert.equal(verifyJwt(manipulado, secreto), null, "firma no coincide con el payload alterado");
});

// --------------------------- Degradacion de 2FA ---------------------------

test("con 2FA activo no se puede reemplazar el secreto sin un codigo valido", async () => {
  const { createStore } = await import("../src/store.js");
  const { setupTotp, enableTotp } = await import("../src/auth.js");
  const { hashPassword, totpCode } = await import("../src/crypto-utils.js");

  const store = createStore();
  await store.createAdmin({ email: "a@x.com", passwordHash: await hashPassword("clave-larga-123"), role: "ADMIN" });
  const user = await store.getAdminByEmail("a@x.com");

  // Activa el 2FA.
  const { secret } = await setupTotp(store, user);
  await enableTotp(store, user, totpCode(secret));
  assert.equal((await store.getAdminByEmail("a@x.com")).totpEnabled, true);

  // Un atacante con la sesion viva intenta regenerar el secreto (lo apagaria).
  await assert.rejects(
    () => setupTotp(store, user),
    /codigo actual/i,
    "sin codigo no debe poder reemplazar el 2FA",
  );
  await assert.rejects(() => setupTotp(store, user, "000000"), /codigo actual/i);

  // Y el 2FA del titular sigue ACTIVO (no se degrado la cuenta).
  assert.equal((await store.getAdminByEmail("a@x.com")).totpEnabled, true);

  // El dueño legitimo, con su codigo actual, si puede rotarlo.
  const fresco = await store.getAdminByEmail("a@x.com");
  const nuevo = await setupTotp(store, user, totpCode(fresco.totpSecret));
  assert.ok(nuevo.secret);
});
