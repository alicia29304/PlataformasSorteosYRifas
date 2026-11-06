import test from "node:test";
import assert from "node:assert/strict";
import { cifrar, descifrar } from "../src/cifrado.js";

const CURVA = { name: "ECDH", namedCurve: "P-256" };
const par = async () => {
  const k = await crypto.subtle.generateKey(CURVA, true, ["deriveKey"]);
  return {
    publica: btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey)))),
    privada: await crypto.subtle.exportKey("jwk", k.privateKey),
  };
};

test("el admin recupera lo cifrado y el texto no se ve", async () => {
  const { publica, privada } = await par();
  const datos = { telefono: "3001112233", referencia: "M123", nombre: "Ana María" };
  const c = await cifrar(datos, publica);
  assert.match(c, /^enc1:[A-Za-z0-9+/=]+$/);
  assert.ok(!c.includes("3001112233") && !atob(c.slice(5)).includes("3001112233"));
  assert.deepEqual(await descifrar(c, privada), datos);
});

test("otra clave no puede leerlo y dos cifrados del mismo dato difieren", async () => {
  const a = await par();
  const b = await par();
  const c = await cifrar({ telefono: "1" }, a.publica);
  assert.notEqual(c, await cifrar({ telefono: "1" }, a.publica));
  await assert.rejects(() => descifrar(c, b.privada));
});

test("un cifrado alterado se rechaza", async () => {
  const { publica, privada } = await par();
  const bytes = Uint8Array.from(atob((await cifrar({ a: 1 }, publica)).slice(5)), (x) => x.charCodeAt(0));
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(() => descifrar(`enc1:${btoa(String.fromCharCode(...bytes))}`, privada));
});
