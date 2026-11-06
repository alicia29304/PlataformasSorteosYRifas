// Reglas del sistema: que firma vale y que cambio produce cada accion.
//
// Dos tipos de error, a proposito distintos:
// - ErrorFirma: firma invalida, vencida, repetida o de una cartera sin rol. No deja
//   rastro en el repositorio, para que nadie pueda llenarlo de commits a base de basura.
// - ErrorRegla: cartera autorizada que pide algo imposible (numero ya vendido). Se
//   guarda en la auditoria para que su app pueda mostrarle el motivo.
//
// Las acciones llevan TIPO: el cliente nunca elige que archivo se escribe.

import { verifyMessage } from "ethers";
import { hashDatos, mensajeAFirmar } from "./mensaje.js";

export const VENTANA_S = 600;
export const MAX_NUMEROS_POR_ORDEN = 10;

export class ErrorFirma extends Error {}
export class ErrorRegla extends Error {}

const DIRECCION = /^0x[0-9a-f]{40}$/;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const CIFRADO = /^enc1:[A-Za-z0-9+/=]{1,8000}$/;
// Sin digitos: un telefono o documento no puede colarse como nombre publico.
const SEUDONIMO = /^\p{L}[\p{L}' -]{0,38}(?: \p{L}\.)?$/u;
const CIUDAD = /^[\p{L}][\p{L}' .-]{0,59}$/u;
const NOMBRE = /^[\p{L}\p{N}][\p{L}\p{N}' .-]{0,59}$/u;

const regla = (cond, motivo) => { if (!cond) throw new ErrorRegla(motivo); };

function soloCampos(datos, permitidos) {
  regla(datos && typeof datos === "object" && !Array.isArray(datos), "Datos invalidos");
  for (const c of Object.keys(datos)) regla(permitidos.includes(c), "Campo no permitido");
}
const texto = (v, max, campo) => regla(typeof v === "string" && v.trim().length > 0 && v.length <= max, `${campo} invalido`);
const fechaIso = (v, campo) => regla(typeof v === "string" && Number.isFinite(Date.parse(v)), `${campo} invalida`);
const entero = (v) => Number.isInteger(v);

function rolDe(roles, direccion) {
  if (roles.admins.includes(direccion)) return "ADMIN";
  if (Object.hasOwn(roles.vendedores, direccion)) return "VENDEDOR";
  return null;
}

/** Comprueba firma, vigencia, nonce y que el firmante tenga algun rol. */
export function verificarSobre(sobre, estado, ahora = Math.floor(Date.now() / 1000)) {
  const { accion, firmante, fecha, nonce, datos, firma } = sobre ?? {};
  if (typeof accion !== "string" || !Object.hasOwn(ACCIONES, accion)) throw new ErrorFirma("Accion desconocida");
  if (typeof firmante !== "string" || !DIRECCION.test(firmante)) throw new ErrorFirma("Firmante invalido");
  if (!entero(fecha) || Math.abs(ahora - fecha) > VENTANA_S) throw new ErrorFirma("Firma vencida o con fecha fuera de rango");
  if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new ErrorFirma("Nonce invalido");
  if (Object.hasOwn(estado.nonces, nonce)) throw new ErrorFirma("Firma ya utilizada");
  if (typeof firma !== "string") throw new ErrorFirma("Falta la firma");

  let recuperada;
  try {
    recuperada = verifyMessage(mensajeAFirmar({ accion, firmante, fecha, nonce, datos }), firma).toLowerCase();
  } catch {
    throw new ErrorFirma("Firma mal formada");
  }
  if (recuperada !== firmante) throw new ErrorFirma("La firma no corresponde al firmante");

  const rol = rolDe(estado.roles, firmante);
  if (!rol) throw new ErrorFirma("Cartera no autorizada");
  return rol;
}

function rifaDe(estado, slug) {
  regla(typeof slug === "string" && SLUG.test(slug) && Object.hasOwn(estado.rifas, slug), "Rifa no encontrada");
  return estado.rifas[slug];
}
function puedeOperar(estado, rol, firmante, slug) {
  if (rol === "ADMIN") return true;
  return estado.roles.vendedores[firmante].rifas.includes(slug);
}
const soloAdmin = (rol) => regla(rol === "ADMIN", "Solo un administrador puede hacer esto");

const ACCIONES = {
  crear_rifa(estado, d, { rol, fecha }) {
    soloAdmin(rol);
    soloCampos(d, ["slug", "titulo", "descripcion", "precioCop", "min", "max", "finVentas", "fechaSorteo"]);
    regla(typeof d.slug === "string" && SLUG.test(d.slug), "Slug invalido");
    regla(!Object.hasOwn(estado.rifas, d.slug), "Ya existe una rifa con ese slug");
    texto(d.titulo, 120, "Titulo");
    regla(d.descripcion === undefined || (typeof d.descripcion === "string" && d.descripcion.length <= 1000), "Descripcion invalida");
    regla(entero(d.precioCop) && d.precioCop > 0, "Precio invalido");
    regla(entero(d.min) && entero(d.max) && d.min >= 0 && d.max >= d.min && d.max - d.min < 100000, "Rango de numeros invalido");
    fechaIso(d.finVentas, "Fecha de cierre");
    fechaIso(d.fechaSorteo, "Fecha de sorteo");
    estado.rifas[d.slug] = {
      slug: d.slug, titulo: d.titulo, descripcion: d.descripcion ?? "", precioCop: d.precioCop,
      min: d.min, max: d.max, finVentas: d.finVentas, fechaSorteo: d.fechaSorteo,
      estado: "ACTIVA", creada: fecha, numeros: {}, ordenes: {},
    };
    return { rifa: d.slug };
  },

  cambiar_estado_rifa(estado, d, { rol }) {
    soloAdmin(rol);
    soloCampos(d, ["slug", "estado"]);
    const rifa = rifaDe(estado, d.slug);
    regla(["ACTIVA", "CERRADA"].includes(d.estado), "Estado invalido");
    rifa.estado = d.estado;
    return { rifa: d.slug };
  },

  asignar_vendedor(estado, d, { rol }) {
    soloAdmin(rol);
    soloCampos(d, ["direccion", "nombre", "rifas"]);
    regla(typeof d.direccion === "string" && DIRECCION.test(d.direccion), "Direccion invalida");
    regla(!estado.roles.admins.includes(d.direccion), "Esa cartera ya es administradora");
    regla(typeof d.nombre === "string" && NOMBRE.test(d.nombre), "Nombre invalido");
    regla(Array.isArray(d.rifas), "Rifas invalidas");
    d.rifas.forEach((s) => rifaDe(estado, s));
    estado.roles.vendedores[d.direccion] = { nombre: d.nombre, rifas: [...new Set(d.rifas)] };
    return { roles: true };
  },

  revocar_vendedor(estado, d, { rol }) {
    soloAdmin(rol);
    soloCampos(d, ["direccion"]);
    regla(typeof d.direccion === "string" && Object.hasOwn(estado.roles.vendedores, d.direccion), "Vendedor no encontrado");
    delete estado.roles.vendedores[d.direccion];
    return { roles: true };
  },

  registrar_pago(estado, d, { rol, firmante, nonce, fecha }) {
    soloCampos(d, ["slug", "numeros", "seudonimo", "ciudad", "metodo", "privado"]);
    const rifa = rifaDe(estado, d.slug);
    regla(puedeOperar(estado, rol, firmante, d.slug), "Esta rifa no esta asignada a tu cartera");
    regla(rifa.estado === "ACTIVA", "La rifa no esta activa");
    regla(fecha * 1000 <= Date.parse(rifa.finVentas), "Las ventas ya cerraron");
    regla(Array.isArray(d.numeros) && d.numeros.length >= 1 && d.numeros.length <= MAX_NUMEROS_POR_ORDEN, `Elige de 1 a ${MAX_NUMEROS_POR_ORDEN} numeros`);
    regla(new Set(d.numeros).size === d.numeros.length, "Numeros repetidos");
    for (const n of d.numeros) {
      regla(entero(n) && n >= rifa.min && n <= rifa.max, "Numero fuera de rango");
      regla(!Object.hasOwn(rifa.numeros, String(n)), `El numero ${n} ya no esta disponible`);
    }
    regla(typeof d.seudonimo === "string" && SEUDONIMO.test(d.seudonimo), "Nombre publico invalido");
    regla(d.ciudad === undefined || (typeof d.ciudad === "string" && CIUDAD.test(d.ciudad)), "Ciudad invalida");
    regla(typeof d.metodo === "string" && d.metodo.length <= 30, "Metodo invalido");
    // El repositorio es publico: lo privado solo entra cifrado.
    regla(typeof d.privado === "string" && CIFRADO.test(d.privado), "Los datos privados deben ir cifrados");

    rifa.ordenes[nonce] = {
      numeros: d.numeros, seudonimo: d.seudonimo, ciudad: d.ciudad ?? null, metodo: d.metodo,
      privado: d.privado, estado: "PENDIENTE",
      registradoPor: firmante, registrado: fecha, aprobadoPor: null, aprobado: null,
    };
    for (const n of d.numeros) rifa.numeros[String(n)] = { estado: "PENDIENTE", orden: nonce };
    return { rifa: d.slug };
  },

  aprobar_pago(estado, d, { rol, firmante, fecha }) {
    soloCampos(d, ["slug", "orden"]);
    const rifa = rifaDe(estado, d.slug);
    regla(puedeOperar(estado, rol, firmante, d.slug), "Esta rifa no esta asignada a tu cartera");
    const orden = typeof d.orden === "string" && Object.hasOwn(rifa.ordenes, d.orden) ? rifa.ordenes[d.orden] : null;
    regla(orden, "Orden no encontrada");
    regla(orden.estado === "PENDIENTE", "La orden ya no esta pendiente");
    orden.estado = "PAGADO";
    orden.aprobadoPor = firmante;
    orden.aprobado = fecha;
    for (const n of orden.numeros) rifa.numeros[String(n)].estado = "PAGADO";
    return { rifa: d.slug };
  },

  anular_pago(estado, d, { rol, firmante, fecha }) {
    soloAdmin(rol);
    soloCampos(d, ["slug", "orden", "motivo"]);
    const rifa = rifaDe(estado, d.slug);
    const orden = typeof d.orden === "string" && Object.hasOwn(rifa.ordenes, d.orden) ? rifa.ordenes[d.orden] : null;
    regla(orden, "Orden no encontrada");
    regla(orden.estado !== "ANULADO", "La orden ya esta anulada");
    texto(d.motivo, 200, "Motivo");
    orden.estado = "ANULADO";
    orden.anuladoPor = firmante;
    orden.anulado = fecha;
    orden.motivoAnulacion = d.motivo;
    for (const n of orden.numeros) delete rifa.numeros[String(n)];
    return { rifa: d.slug };
  },
};

/** Olvida nonces que ya no pueden pasar la ventana de tiempo: el archivo no crece sin fin. */
function purgarNonces(nonces, ahora) {
  for (const [n, t] of Object.entries(nonces)) if (ahora - t > VENTANA_S * 2) delete nonces[n];
}

/**
 * Verifica y aplica un sobre sobre `estado` (lo modifica).
 * Lanza ErrorFirma si no debe dejar rastro. Devuelve la entrada de auditoria.
 */
export function procesar(sobre, estado, ahora = Math.floor(Date.now() / 1000)) {
  const rol = verificarSobre(sobre, estado, ahora);
  const { accion, firmante, fecha, nonce, datos, firma } = sobre;
  purgarNonces(estado.nonces, ahora);
  estado.nonces[nonce] = fecha;

  const base = { accion, firmante, rol, fecha, nonce, firma, procesado: ahora };
  try {
    ACCIONES[accion](estado, datos, { rol, firmante, nonce, fecha });
    return { ...base, datos, resultado: "ACEPTADA" };
  } catch (e) {
    // La auditoria es publica y estos datos no pasaron la validacion (pueden traer un
    // telefono sin cifrar): solo se guarda su hash, y `motivo` nunca repite lo enviado.
    if (e instanceof ErrorRegla) return { ...base, datosHash: hashDatos(datos), resultado: "RECHAZADA", motivo: e.message };
    throw e;
  }
}
