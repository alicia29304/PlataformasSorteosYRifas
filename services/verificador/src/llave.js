// Entrega automatica de la clave de datos a cada vendedor, sin archivos.
//
// El vendedor firma un mensaje fijo; de esa firma (siempre igual en MetaMask y Trust
// Wallet) sale su "candado" secp256k1, y publica solo la parte publica. La app del
// administrador cierra la clave de datos con ese candado. Solo quien vuelva a producir
// esa firma, es decir, la cartera del vendedor, puede abrirla.

import { SigningKey, getBytes, hexlify, keccak256, toUtf8Bytes } from "ethers";
import { REPOSITORIO } from "./mensaje.js";

export function mensajeLlave(firmante) {
  return [
    "SorteosWeb3: activar busqueda de clientes",
    `Repositorio: ${REPOSITORIO}`,
    `Cartera: ${firmante}`,
    "Esta firma solo abre los datos de contacto en este dispositivo. No autoriza cambios ni pagos.",
  ].join("\n");
}
export const mensajeLlaveHex = (firmante) => hexlify(toUtf8Bytes(mensajeLlave(firmante)));

/** Candado del vendedor a partir de su firma. */
export function llaveDesdeFirma(firma) {
  const k = new SigningKey(keccak256(firma));
  return { privada: k.privateKey, publica: k.publicKey.toLowerCase() };
}

const aBase64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const deBase64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const claveAes = async (secreto, usos) => crypto.subtle.importKey(
  "raw", await crypto.subtle.digest("SHA-256", getBytes(secreto)), "AES-GCM", false, usos,
);

/** Cierra `datos` para el candado `publica`. Lo usa la app del administrador. */
export async function cerrarPara(publica, datos) {
  const efimera = new SigningKey(hexlify(crypto.getRandomValues(new Uint8Array(32))));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await claveAes(efimera.computeSharedSecret(publica), ["encrypt"]);
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(datos)));
  return { para: publica, efimera: efimera.publicKey.toLowerCase(), iv: aBase64(iv), cifrado: aBase64(cifrado) };
}

/** Abre una entrega con la privada del candado. Lanza si no es para esta llave. */
export async function abrirEntrega(privada, entrega) {
  const aes = await claveAes(new SigningKey(privada).computeSharedSecret(entrega.efimera), ["decrypt"]);
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deBase64(entrega.iv) }, aes, deBase64(entrega.cifrado));
  return JSON.parse(new TextDecoder().decode(claro));
}
