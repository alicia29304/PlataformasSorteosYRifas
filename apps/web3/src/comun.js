// Lo que comparten la web publica y la app de administracion: API, cartera, firmas,
// modales y comprobantes. Los textos se insertan siempre como texto (h), nunca como HTML.

import { mensajeHex } from "../../../services/verificador/src/mensaje.js";

// En la copia de IPFS la API no esta en el mismo origen.
export const API = /workers\.dev$|^localhost$/.test(location.hostname)
  ? "/api" : "https://sorteos-web3.aliciagadiaz29304.workers.dev/api";
export const ZONA = "America/Bogota";

export const cuenta = { direccion: null, firmaCon: null, roles: null, proveedor: null, porWc: false };

export function h(etiqueta, attrs = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...hijos.flat().filter((x) => x != null && x !== false));
  return el;
}
export const cop = (n) => `$ ${Number(n).toLocaleString("es-CO")}`;
export const fecha = (iso) => new Date(iso).toLocaleString("es-CO", { timeZone: ZONA, dateStyle: "long", timeStyle: "short" });
export const pad = (n, max) => String(n).padStart(String(max).length, "0");
export const corta = (d) => `${d.slice(0, 6)}…${d.slice(-4)}`;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pedir(ruta, opciones) {
  const r = await fetch(`${API}${ruta}`, opciones);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "No se pudo completar");
  return d;
}

export const rolDe = (slug) => {
  const { direccion, roles } = cuenta;
  if (!direccion || !roles) return null;
  if (roles.admins.includes(direccion)) return "ADMIN";
  const v = roles.vendedores[direccion];
  if (!v) return "SIN_ROL";
  return !slug || v.rifas.includes(slug) ? "VENDEDOR" : "SIN_ROL";
};

async function iniciarSesion(proveedor, direccion, porWc, alListo) {
  Object.assign(cuenta, { proveedor, porWc, firmaCon: direccion, direccion: direccion.toLowerCase(), roles: await pedir("/roles") });
  alListo();
}

export async function conectarCartera(alListo) {
  if (window.ethereum) {
    const [direccion] = await window.ethereum.request({ method: "eth_requestAccounts" });
    await iniciarSesion(window.ethereum, direccion, false, alListo);
    return;
  }
  // Navegador normal (Chrome, Edge...): WalletConnect enlaza con la cartera por QR.
  const estado = h("p", { class: "mut small" }, "Preparando la conexión…");
  const zona = h("div", { style: "text-align:center" }, estado);
  const sitio = `${location.host}${location.pathname}`;
  const cerrar = mostrarModal("Conectar cartera", zona,
    h("p", { class: "mut small", style: "margin-top:14px" }, "También puedes abrir la página dentro de la cartera:"),
    h("div", { class: "cuenta" },
      h("a", { class: "btn-ghost small", href: `https://metamask.app.link/dapp/${sitio}` }, "Navegador de MetaMask"),
      h("a", { class: "btn-ghost small", href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(location.href)}` }, "Navegador de Trust Wallet")));
  try {
    const { conectarWalletConnect, imagenQr } = await import("./walletconnect.js");
    const proveedor = await conectarWalletConnect(async (uri) => {
      const u = encodeURIComponent(uri);
      zona.replaceChildren(
        h("img", { src: await imagenQr(uri), alt: "Código QR para conectar la cartera", style: "width:240px;height:240px;border-radius:12px" }),
        h("p", { class: "mut small" }, "Escanéalo con MetaMask o Trust Wallet. Si estás en el celular:"),
        h("div", { class: "cuenta", style: "justify-content:center" },
          h("a", { class: "btn small", href: `https://link.trustwallet.com/wc?uri=${u}` }, "Abrir Trust Wallet"),
          h("a", { class: "btn small", href: `https://metamask.app.link/wc?uri=${u}` }, "Abrir MetaMask")));
    });
    cerrar();
    await iniciarSesion(proveedor, proveedor.accounts[0], true, alListo);
  } catch (e) {
    zona.replaceChildren(h("p", { class: "err" }, e.message || "No se pudo conectar"));
  }
}

export async function desconectarCartera(alListo) {
  if (cuenta.porWc) await cuenta.proveedor.disconnect().catch(() => {});
  Object.assign(cuenta, { direccion: null, firmaCon: null, proveedor: null, porWc: false });
  alListo();
}

export const hayVersionNueva = async () => {
  try {
    const r = await fetch("./version.json", { cache: "no-store" });
    return (await r.json()).version !== __VERSION__;
  } catch {
    return false; // Sin red o en la copia de IPFS: no se bloquea por esto.
  }
};

/** Firma una accion, la envia y espera a que GitHub Actions la aplique. */
export async function firmarYEnviar(accion, datos, alAvanzar, comprobante = null) {
  if (await hayVersionNueva()) {
    throw Object.assign(new Error("Hay una versión nueva de la página. Recárgala antes de firmar."), { recargar: true });
  }
  const base = { accion, firmante: cuenta.direccion, fecha: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID(), datos };
  alAvanzar(`${cuenta.porWc ? "Abre tu cartera y confirma" : "Confirma"} la firma`, "No cuesta nada ni usa gas.");
  let firma;
  try {
    firma = await cuenta.proveedor.request({ method: "personal_sign", params: [mensajeHex(base), cuenta.firmaCon] });
  } catch (e) {
    if (e?.code === 4001 || /reject|denied|cancel/i.test(e?.message ?? "")) throw new Error("Cancelaste la firma. No se registró nada.");
    throw e;
  }
  alAvanzar("Enviando…", "");
  await pedir("/accion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, firma, ...(comprobante ? { comprobante } : {}) }) });
  alAvanzar("Registrando…", "Suele tardar entre 15 y 30 segundos. Deja esta ventana abierta.", true);
  for (let i = 0; i < 30; i++) {
    await pausa(4000);
    const r = await pedir(`/resultado/${base.nonce}`);
    if (r.estado === "ACEPTADA") return base.nonce;
    if (r.estado === "RECHAZADA") throw new Error(r.motivo || "La acción fue rechazada");
  }
  throw new Error("Sigue en proceso. Revisa en unos minutos antes de repetirlo.");
}

// ------------------------------- Modal -------------------------------

export function mostrarModal(titulo, ...contenido) {
  const cerrar = () => fondo.remove();
  const fondo = h("div", { class: "modal-back", onclick: cerrar },
    h("div", { class: "modal-card", onclick: (e) => e.stopPropagation() },
      h("div", { class: "modal-top" }, h("h3", { style: "margin:0" }, titulo), h("button", { class: "modal-x", onclick: cerrar }, "✕")),
      ...contenido));
  document.body.append(fondo);
  return cerrar;
}

/** Pantalla de espera: reemplaza al formulario mientras se firma y se registra. */
export function panelEspera() {
  const paso = h("p", { class: "espera-paso" }, "Preparando…");
  const detalle = h("p", { class: "mut small", style: "margin:0" });
  const reloj = h("p", { class: "mut small", style: "margin:8px 0 0" });
  let temporizador = null;
  const detener = () => clearInterval(temporizador);
  const avanzar = (titulo, texto = "", contar = false) => {
    paso.textContent = titulo;
    detalle.textContent = texto;
    if (contar && !temporizador) {
      const inicio = Date.now();
      temporizador = setInterval(() => { reloj.textContent = `Llevas ${Math.round((Date.now() - inicio) / 1000)} s`; }, 1000);
    }
  };
  return { nodo: h("div", { class: "espera" }, h("div", { class: "espera-giro" }), paso, detalle, reloj), avanzar, detener };
}

export const botonRecargar = () => h("button", { class: "btn small", style: "margin-top:10px", onclick: () => location.reload() }, "Recargar la página");

export const avisarError = (e) => mostrarModal("No se pudo", h("p", { class: "err" }, e.message));

// ------------------------------- Comprobantes -------------------------------

let configCache = null;
export const config = async () => (configCache ??= await pedir("/config"));

const aBase64 = (bytes) => {
  let txt = "";
  for (let i = 0; i < bytes.length; i += 0x8000) txt += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(txt);
};

/** Reduce la foto a un JPEG liviano y calcula su hash. La foto original no sale del equipo. */
export async function prepararComprobante(archivo) {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, 1400 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  let blob = null;
  for (const calidad of [0.72, 0.55, 0.4]) {
    blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
    if (blob.size <= 450 * 1024) break;
  }
  if (!blob || blob.size > 450 * 1024) throw new Error("La imagen del comprobante es demasiado pesada.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { base64: aBase64(bytes), hash, tamano: bytes.length };
}

// Una firma sirve 9 minutos para no pedirla por cada comprobante que se revisa.
const permisosLectura = new Map();

async function permisoLectura(slug) {
  const vigente = permisosLectura.get(slug);
  if (vigente && Date.now() / 1000 - vigente.fecha < 540) return vigente;
  const base = { accion: "ver_comprobantes", firmante: cuenta.direccion, fecha: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID(), datos: { slug } };
  const firma = await cuenta.proveedor.request({ method: "personal_sign", params: [mensajeHex(base), cuenta.firmaCon] });
  const permiso = { ...base, firma };
  permisosLectura.set(slug, permiso);
  return permiso;
}

/** El comprobante es privado: se pide con la firma de una cartera autorizada para esa rifa. */
export async function modalComprobante(slug, orden) {
  const zona = h("div", { style: "text-align:center" }, h("p", { class: "mut small" }, cuenta.porWc ? "Abre tu cartera y confirma para ver el comprobante." : "Confirma en tu cartera para ver el comprobante."));
  mostrarModal("Comprobante de pago", zona);
  try {
    const r = await fetch(`${API}/comprobante`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(await permisoLectura(slug)), orden }),
    });
    if (!r.ok) throw new Error((await r.json()).error || "No se pudo abrir el comprobante");
    const url = URL.createObjectURL(await r.blob());
    zona.replaceChildren(h("img", { src: url, alt: "Comprobante de pago", style: "width:100%;border-radius:12px" }));
  } catch (e) {
    zona.replaceChildren(h("p", { class: "err" }, e.message));
  }
}
