// Texto exacto que firma la cartera. Lo usan igual el verificador y los clientes
// (web, escritorio). Se reconstruye siempre a partir de los campos: jamas se
// confia en un "mensaje" enviado por el cliente.

import { Wallet, getBytes, hexlify, keccak256, toUtf8Bytes, verifyMessage } from "ethers";

export const REPOSITORIO = "alicia29304/PlataformasSorteosYRifas";

/** JSON con las claves ordenadas: el mismo dato siempre da el mismo hash. */
export function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor && typeof valor === "object") {
    const claves = Object.keys(valor).sort();
    return `{${claves.map((c) => `${JSON.stringify(c)}:${canonico(valor[c])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export const hashDatos = (datos) => keccak256(toUtf8Bytes(canonico(datos)));

export function mensajeAFirmar({ accion, firmante, fecha, nonce, datos }) {
  return [
    "SorteosWeb3: autorizacion de cambio",
    `Repositorio: ${REPOSITORIO}`,
    `Accion: ${accion}`,
    `Firmante: ${firmante}`,
    `Fecha: ${fecha}`,
    `Nonce: ${nonce}`,
    `Datos: ${hashDatos(datos)}`,
  ].join("\n");
}

export const MAX_SESION_S = 100 * 86400;

/**
 * Lo que firma la cartera una sola vez al entrar: autoriza a una clave guardada en ese
 * equipo a firmar en su nombre hasta una fecha. La cartera sigue siendo quien responde.
 */
export function mensajeDelegacion({ firmante, sesion, expira }) {
  return [
    "SorteosWeb3: autorizar este equipo",
    `Repositorio: ${REPOSITORIO}`,
    `Cartera: ${firmante}`,
    `Clave de sesion: ${sesion}`,
    `Vence: ${expira}`,
    "Este equipo podra firmar cambios en tu nombre hasta esa fecha o hasta cerrar sesion.",
  ].join("\n");
}

/**
 * Cartera responsable del sobre (en minusculas). Lanza si la firma no es valida.
 * Con delegacion exige dos firmas: la cartera autorizo la clave y la clave firmo el cambio.
 */
export function recuperarFirmante(sobre, ahora = Math.floor(Date.now() / 1000)) {
  const { delegacion } = sobre;
  if (delegacion === undefined) return verifyMessage(mensajeAFirmar(sobre), sobre.firma).toLowerCase();
  const { sesion, expira, firma } = delegacion ?? {};
  if (typeof sesion !== "string" || !/^0x[0-9a-f]{40}$/.test(sesion) || !Number.isInteger(expira) || typeof firma !== "string") {
    throw new Error("Delegacion mal formada");
  }
  if (expira <= ahora || expira - ahora > MAX_SESION_S) throw new Error("Sesion vencida");
  if (verifyMessage(mensajeDelegacion({ firmante: sobre.firmante, sesion, expira }), firma).toLowerCase() !== sobre.firmante) {
    throw new Error("La cartera no autorizo esta sesion");
  }
  if (verifyMessage(mensajeAFirmar(sobre), sobre.firma).toLowerCase() !== sesion) throw new Error("La clave de sesion no firmo este cambio");
  return sobre.firmante;
}

/** Clave de sesion nueva, y firma con ella (mensaje en hexadecimal, como personal_sign). */
export function crearClaveSesion() {
  const w = Wallet.createRandom();
  return { direccion: w.address.toLowerCase(), privada: w.privateKey };
}
export const firmarConClave = (privada, hex) => new Wallet(privada).signMessage(getBytes(hex));
export const delegacionHex = (datos) => hexlify(toUtf8Bytes(mensajeDelegacion(datos)));

/** Mensaje en hexadecimal, como lo pide `personal_sign` en la cartera. */
export const mensajeHex = (sobre) => hexlify(toUtf8Bytes(mensajeAFirmar(sobre)));
