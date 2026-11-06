// Texto exacto que firma la cartera. Lo usan igual el verificador y los clientes
// (web, escritorio). Se reconstruye siempre a partir de los campos: jamas se
// confia en un "mensaje" enviado por el cliente.

import { keccak256, toUtf8Bytes } from "ethers";

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
