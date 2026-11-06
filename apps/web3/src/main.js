// Web publica. Cualquiera ve las rifas y consulta su ticket; registrar y aprobar pagos
// exige firmar con una cartera autorizada (MetaMask, Trust Wallet...).
// Los textos se insertan siempre como texto (h), nunca como HTML.

import { mensajeHex } from "../../../services/verificador/src/mensaje.js";
import { cifrar } from "./cifrado.js";
import { ticketsAPng, compartirImagen, imprimirImagen } from "./compartirTickets.js";

// En la copia de IPFS la API no esta en el mismo origen.
const API = /workers\.dev$|^localhost$/.test(location.hostname)
  ? "/api" : "https://sorteos-web3.aliciagadiaz29304.workers.dev/api";
const ZONA = "America/Bogota";
const MAX_SEL = 10;

const raiz = document.getElementById("app");
const cuenta = { direccion: null, firmaCon: null, roles: null, proveedor: null, porWc: false };

function h(etiqueta, attrs = {}, ...hijos) {
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
const cop = (n) => `$ ${Number(n).toLocaleString("es-CO")}`;
const fecha = (iso) => new Date(iso).toLocaleString("es-CO", { timeZone: ZONA, dateStyle: "long", timeStyle: "short" });
const pad = (n, max) => String(n).padStart(String(max).length, "0");
const corta = (d) => `${d.slice(0, 6)}…${d.slice(-4)}`;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(ruta, opciones) {
  const r = await fetch(`${API}${ruta}`, opciones);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "No se pudo completar");
  return d;
}

// ------------------------------- Cartera -------------------------------

const rolDe = (slug) => {
  const { direccion, roles } = cuenta;
  if (!direccion || !roles) return null;
  if (roles.admins.includes(direccion)) return "ADMIN";
  const v = roles.vendedores[direccion];
  if (!v) return "SIN_ROL";
  return !slug || v.rifas.includes(slug) ? "VENDEDOR" : "SIN_ROL";
};

async function iniciarSesion(proveedor, direccion, porWc) {
  Object.assign(cuenta, { proveedor, porWc, firmaCon: direccion, direccion: direccion.toLowerCase(), roles: await pedir("/roles") });
  rutear();
}

async function conectar() {
  if (window.ethereum) {
    const [direccion] = await window.ethereum.request({ method: "eth_requestAccounts" });
    await iniciarSesion(window.ethereum, direccion, false);
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
    await iniciarSesion(proveedor, proveedor.accounts[0], true);
  } catch (e) {
    zona.replaceChildren(h("p", { class: "err" }, e.message || "No se pudo conectar"));
  }
}

async function desconectar() {
  if (cuenta.porWc) await cuenta.proveedor.disconnect().catch(() => {});
  Object.assign(cuenta, { direccion: null, firmaCon: null, proveedor: null, porWc: false });
  rutear();
}

/** Firma una accion, la envia y espera a que GitHub Actions la aplique. */
async function firmarYEnviar(accion, datos, alAvanzar) {
  const base = { accion, firmante: cuenta.direccion, fecha: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID(), datos };
  alAvanzar(`${cuenta.porWc ? "Abre tu cartera y confirma" : "Confirma"} la firma. No cuesta nada ni usa gas.`);
  const firma = await cuenta.proveedor.request({ method: "personal_sign", params: [mensajeHex(base), cuenta.firmaCon] });
  alAvanzar("Enviando…");
  await pedir("/accion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, firma }) });
  alAvanzar("Firma enviada. Se está registrando; puede tardar hasta 30 segundos…");
  for (let i = 0; i < 30; i++) {
    await pausa(4000);
    const r = await pedir(`/resultado/${base.nonce}`);
    if (r.estado === "ACEPTADA") return base.nonce;
    if (r.estado === "RECHAZADA") throw new Error(r.motivo || "La acción fue rechazada");
  }
  throw new Error("Sigue en proceso. Revisa en unos minutos antes de repetirlo.");
}

// ------------------------------- Modal -------------------------------

function mostrarModal(titulo, ...contenido) {
  const cerrar = () => fondo.remove();
  const fondo = h("div", { class: "modal-back", onclick: cerrar },
    h("div", { class: "modal-card", onclick: (e) => e.stopPropagation() },
      h("div", { class: "modal-top" }, h("h3", { style: "margin:0" }, titulo), h("button", { class: "modal-x", onclick: cerrar }, "✕")),
      ...contenido));
  document.body.append(fondo);
  return cerrar;
}

// ------------------------------- Inicio -------------------------------

function encabezado() {
  return h("div", { class: "barra" },
    h("a", { class: "marca", href: "#/" }, "🎟️ Sorteos y Rifas"),
    h("div", { class: "cuenta" }, cuenta.direccion
      ? [h("span", { class: "chip on" }, `${corta(cuenta.direccion)} · ${{ ADMIN: "Admin", VENDEDOR: "Vendedor", SIN_ROL: "Sin autorización" }[rolDe()]}`),
        h("button", { class: "btn-ghost small", onclick: () => desconectar() }, "Salir")]
      : h("button", { class: "btn-ghost small", onclick: () => conectar().catch(avisarError) }, "Soy vendedor: conectar cartera")));
}
const avisarError = (e) => mostrarModal("No se pudo", h("p", { class: "err" }, e.message));

async function vistaInicio() {
  const rifas = await pedir("/rifas");
  raiz.replaceChildren(h("main", { class: "contenedor" }, encabezado(),
    h("h1", {}, "Sorteos activos"),
    rifas.length === 0 ? h("p", { class: "mut" }, "Aún no hay sorteos.") : h("div", { class: "lista-rifas" },
      rifas.map((r) => h("a", { class: "card", href: `#/rifa/${r.slug}`, style: "color:inherit;text-decoration:none" },
        h("div", { class: "card-body" }, h("h3", { style: "margin:0" }, r.titulo),
          h("div", { class: "mut small" }, `${cop(r.precioCop)} por número · ${r.estado === "ACTIVA" ? "Activa" : "Cerrada"}`),
          h("div", { class: "mut small" }, `Sorteo: ${fecha(r.fechaSorteo)}`)))))));
}

// ------------------------------- Rifa -------------------------------

async function vistaRifa(slug, ticketInicial = null) {
  const rifa = await pedir(`/rifas/${slug}`);
  const roles = cuenta.roles ?? await pedir("/roles");
  const rol = rolDe(slug);
  const opera = (rol === "ADMIN" || rol === "VENDEDOR") && rifa.estado === "ACTIVA";
  const sel = new Set();
  let filtro = "TODOS";
  let busca = "";

  const rejilla = h("div", { class: "grid-nums" });
  const barra = h("div");
  const estadoDe = (n) => rifa.numeros[String(n)]?.estado;
  const libres = () => { const l = []; for (let n = rifa.min; n <= rifa.max; n++) if (!estadoDe(n)) l.push(n); return l; };

  function pintar() {
    const botones = [];
    for (let n = rifa.min; n <= rifa.max; n++) {
      const est = estadoDe(n);
      if (filtro === "VENDIDOS" && est !== "PAGADO") continue;
      if (filtro === "APARTADOS" && est !== "PENDIENTE") continue;
      if (filtro === "LIBRES" && est) continue;
      if (busca && !pad(n, rifa.max).includes(busca)) continue;
      const clase = `num${est === "PAGADO" ? " sold" : est === "PENDIENTE" ? " held" : ""}${sel.has(n) ? " sel" : ""}`;
      botones.push(h("button", { class: clase, onclick: () => tocar(n) }, pad(n, rifa.max)));
    }
    rejilla.replaceChildren(...botones);
    barra.replaceChildren(...(sel.size === 0 ? [] : [h("div", { class: "buy-bar" },
      h("div", { class: "buy-info" }, h("b", {}, String(sel.size)), ` número${sel.size > 1 ? "s" : ""} · ${cop(rifa.precioCop * sel.size)}`),
      h("button", { class: "btn", onclick: () => modalRegistrar(rifa, [...sel].sort((a, b) => a - b)) }, "Registrar pago"))]));
  }
  function tocar(n) {
    if (estadoDe(n)) { modalTicket(rifa, n); return; }
    if (!opera) {
      mostrarModal(`Número ${pad(n, rifa.max)}`, h("p", {}, "Este número está libre. Para comprarlo, habla con un vendedor autorizado; él registra tu pago y te entrega tu código de ticket."),
        vendedores.length ? h("p", { class: "mut small" }, `Vendedores: ${vendedores.join(", ")}`) : null);
      return;
    }
    if (sel.has(n)) sel.delete(n); else if (sel.size < MAX_SEL) sel.add(n);
    pintar();
  }
  function azar(k) {
    const l = libres();
    const r = new Uint32Array(l.length);
    crypto.getRandomValues(r);
    for (let i = 0; i < Math.min(k, l.length); i++) {
      const j = i + (r[i] % (l.length - i));
      [l[i], l[j]] = [l[j], l[i]];
    }
    sel.clear();
    l.slice(0, k).forEach((n) => sel.add(n));
    pintar();
  }
  const vendedores = Object.values(roles.vendedores).filter((v) => v.rifas.includes(slug)).map((v) => v.nombre);
  const chip = (txt, valor) => h("button", { class: `chip${filtro === valor ? " on" : ""}`, onclick: () => { filtro = valor; vistaChips(); pintar(); } }, txt);
  const chips = h("div", { class: "chips" });
  const cuantos = (e) => Object.values(rifa.numeros).filter((x) => x.estado === e).length;
  const vistaChips = () => chips.replaceChildren(chip("Todos", "TODOS"), chip(`Vendidos (${cuantos("PAGADO")})`, "VENDIDOS"), chip("Libres", "LIBRES"), chip(`Apartados (${cuantos("PENDIENTE")})`, "APARTADOS"));
  vistaChips();

  const pendientes = Object.entries(rifa.ordenes).filter(([, o]) => o.estado !== "ANULADO" && (o.estado === "PENDIENTE" || rol === "ADMIN"));

  raiz.replaceChildren(h("main", { class: "contenedor" }, encabezado(),
    h("h1", { style: "margin-bottom:4px" }, rifa.titulo),
    rifa.descripcion ? h("p", { class: "mut", style: "margin-top:0" }, rifa.descripcion) : null,
    h("p", { class: "small" }, `${cop(rifa.precioCop)} por número · Cierre de ventas: ${fecha(rifa.finVentas)} · Sorteo: ${fecha(rifa.fechaSorteo)}`),
    h("div", { class: "controls" },
      h("button", { class: "btn-ghost", onclick: () => modalTicket(rifa) }, "🎫 Mis números"),
      opera ? [3, 5, 10].map((k) => h("button", { class: "btn-azar", onclick: () => azar(k) }, `🎲 ${k} al azar`)) : null,
      h("input", { class: "buscador", inputmode: "numeric", placeholder: "Buscar número…", oninput: (e) => { busca = e.target.value.replace(/\D/g, ""); pintar(); } }),
      chips),
    rejilla, barra,
    (rol === "ADMIN" || rol === "VENDEDOR") ? h("section", { style: "margin-top:26px" }, h("h2", {}, "Pagos por revisar"),
      pendientes.length === 0 ? h("p", { class: "mut" }, "No hay pagos por revisar.")
        : pendientes.map(([id, o]) => filaOrden(rifa, id, o, rol))) : null));
  pintar();
  if (ticketInicial !== null) modalTicket(rifa, ticketInicial);
}

function filaOrden(rifa, id, o, rol) {
  const avance = (txt, nodo) => { nodo.textContent = txt; };
  const estado = h("span", { class: "mut small" });
  const accion = (nombre, datos) => firmarYEnviar(nombre, datos, (t) => avance(t, estado)).then(() => rutear())
    .catch((e) => avance(e.message, estado));
  return h("div", { class: "orden" },
    h("div", {}, h("b", {}, o.numeros.map((n) => pad(n, rifa.max)).join(", ")), ` · ${o.seudonimo} · ${o.metodo} · ${o.estado}`,
      h("div", { class: "mut small" }, `Registró ${corta(o.registradoPor)}`), estado),
    h("div", { class: "cuenta" },
      h("button", { class: "btn-ghost small", onclick: () => modalTicket(rifa, o.numeros[0]) }, "Ver ticket"),
      o.estado === "PENDIENTE" ? h("button", { class: "btn small", onclick: () => accion("aprobar_pago", { slug: rifa.slug, orden: id }) }, "Aprobar") : null,
      rol === "ADMIN" ? h("button", { class: "btn-ghost small", onclick: () => {
        const motivo = window.prompt("Motivo de la anulación");
        if (motivo?.trim()) accion("anular_pago", { slug: rifa.slug, orden: id, motivo: motivo.trim().slice(0, 200) });
      } }, "Anular") : null));
}

// ------------------------------- Registrar pago -------------------------------

function modalRegistrar(rifa, numeros) {
  const campo = (etiqueta, attrs) => {
    const input = h("input", { class: "inp", ...attrs });
    return { input, nodo: h("label", { class: "campo small" }, etiqueta, input) };
  };
  const nombre = campo("Nombre *", { autocomplete: "off", maxlength: 30 });
  const apellido = campo("Apellido", { autocomplete: "off", maxlength: 30 });
  const ciudad = campo("Ciudad", { autocomplete: "off", maxlength: 40 });
  const telefono = campo("Teléfono *", { inputmode: "tel", autocomplete: "off", maxlength: 20 });
  const metodo = campo("Método de pago *", { value: "NEQUI", maxlength: 30 });
  const referencia = campo("Referencia del pago", { autocomplete: "off", maxlength: 60 });
  const estado = h("p", { class: "mut small" });
  const boton = h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: enviar }, "Firmar y registrar");
  const contenido = h("div", {},
    h("p", { class: "mut small" }, `${numeros.map((n) => pad(n, rifa.max)).join(", ")} · ${cop(rifa.precioCop * numeros.length)}`),
    nombre.nodo, apellido.nodo, ciudad.nodo, telefono.nodo, metodo.nodo, referencia.nodo,
    h("p", { class: "mut small" }, "Público: nombre, inicial del apellido y ciudad. El teléfono y la referencia van cifrados: solo el administrador puede leerlos."),
    boton, estado);
  const cerrarModal = mostrarModal("Registrar pago", contenido);

  async function enviar() {
    const nom = nombre.input.value.trim().split(/\s+/)[0];
    const ape = apellido.input.value.trim();
    const tel = telefono.input.value.replace(/\D/g, "");
    if (!nom || tel.length < 7 || !metodo.input.value.trim()) { estado.textContent = "Completa nombre, teléfono y método de pago."; return; }
    boton.disabled = true;
    try {
      const { cifradoPublica } = await pedir("/config");
      const ciudadTxt = ciudad.input.value.trim();
      const datos = {
        slug: rifa.slug, numeros, seudonimo: ape ? `${nom} ${ape[0].toUpperCase()}.` : nom,
        metodo: metodo.input.value.trim(),
        privado: await cifrar({ nombre: nom, apellido: ape, telefono: tel, referencia: referencia.input.value.trim() }, cifradoPublica),
        ...(ciudadTxt ? { ciudad: ciudadTxt } : {}),
      };
      await firmarYEnviar("registrar_pago", datos, (t) => { estado.textContent = t; });
      cerrarModal();
      await vistaRifa(rifa.slug, numeros[0]);
    } catch (e) {
      estado.textContent = e.message;
      boton.disabled = false;
    }
  }
}

// ------------------------------- Mis numeros -------------------------------

const enlaceTicket = (slug, n) => `${location.origin}${location.pathname}#/rifa/${slug}/ticket/${n}`;

async function copiar(texto, boton) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Algunos navegadores internos de carteras bloquean el portapapeles.
    const t = h("textarea", { style: "position:fixed;opacity:0" }, texto);
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  boton.textContent = "Copiado ✓";
}

const aDataUrl = (blob) => new Promise((ok) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.readAsDataURL(blob);
});

/** Salida cuando el navegador no comparte archivos ni imprime (el de la cartera). */
async function modalImagen(blob, nombre, enlace) {
  const url = await aDataUrl(blob);
  mostrarModal("Tu ticket",
    h("img", { src: url, alt: "Imagen de los tickets", style: "width:100%;border-radius:12px" }),
    h("p", { class: "mut small" }, "Mantén presionada la imagen para guardarla. Si no te deja, copia el enlace y ábrelo en Chrome: allí podrás compartirla e imprimirla."),
    h("div", { class: "compartir-bar" },
      h("button", { class: "btn-ghost", onclick: (e) => copiar(enlace, e.target) }, "Copiar enlace"),
      h("a", { class: "btn-ghost", href: url, download: nombre, style: "text-align:center" }, "Descargar")));
}

function modalTicket(rifa, numeroInicial = null) {
  const input = h("input", { class: "inp", inputmode: "numeric", placeholder: "Ej: 47", autocomplete: "off", maxlength: 6, value: numeroInicial ?? "",
    onkeydown: (e) => { if (e.key === "Enter") buscar(); } });
  const resultado = h("div");
  const contenido = h("div", {},
    h("p", { class: "mut small" }, "Escribe uno de los números del comprador."), input,
    h("button", { class: "btn", style: "width:100%;margin-top:12px", onclick: buscar }, "Ver ticket"), resultado);
  mostrarModal("🎫 Mis números", contenido);
  if (numeroInicial !== null) buscar();

  function buscar() {
    const texto = input.value.replace(/\D/g, "");
    const n = Number(texto);
    const ref = texto && Object.hasOwn(rifa.numeros, String(n)) ? rifa.numeros[String(n)] : null;
    if (!ref) { resultado.replaceChildren(h("p", { class: "err", style: "margin-top:12px" }, "Ese número aún no tiene comprador en este sorteo.")); return; }
    const orden = rifa.ordenes[ref.orden];
    const pagado = orden.estado === "PAGADO";
    const estado = pagado ? "Pagado ✓ — el número es tuyo" : "Pago en revisión…";
    const nombre = orden.seudonimo.split(" ")[0];
    const lista = orden.numeros.map((x) => pad(x, rifa.max)).join(", ");
    const enlace = enlaceTicket(rifa.slug, n);
    const archivo = `tickets-${rifa.slug}-${n}.png`;
    const textoCompartir = `${rifa.titulo} — números: ${lista}`;
    const imagen = () => ticketsAPng({
      titulo: rifa.titulo, descripcion: rifa.descripcion, nombre: pagado ? nombre : "", fecha: fecha(rifa.fechaSorteo),
      tickets: orden.numeros.map((x) => ({ num: pad(x, rifa.max), estado, pagado })),
    });
    // Sin soporte para archivos en un celular suele ser el navegador de una cartera: tampoco imprime.
    const sinSoporte = !navigator.canShare?.({ files: [new File(["x"], "x.png", { type: "image/png" })] }) && navigator.maxTouchPoints > 0;
    resultado.replaceChildren(
      pagado ? h("div", { class: "gracias", style: "margin-top:14px" }, h("div", { class: "gracias-t" }, `🎉 ¡Gracias ${nombre} por tu compra!`)) : "",
      h("div", { class: "tickets", style: "margin-top:14px" }, orden.numeros.map((x) => h("div", { class: `ticket${pagado ? "" : " pend"}` },
        h("div", { class: "ticket-izq" }, h("div", { class: "ticket-rifa" }, rifa.titulo),
          rifa.descripcion ? h("div", { class: "ticket-desc" }, rifa.descripcion) : null,
          h("div", { class: "ticket-fecha" }, `🗓️ ${fecha(rifa.fechaSorteo)}`),
          h("div", { class: `ticket-estado${pagado ? " ok" : ""}` }, estado)),
        h("div", { class: "ticket-der" }, h("span", { class: "ticket-n-l" }, "N.º"), h("span", { class: "ticket-n" }, pad(x, rifa.max)))))),
      h("a", { class: "btn", style: "display:block;text-align:center;margin-top:14px", href: `https://wa.me/?text=${encodeURIComponent(`${textoCompartir}\n${enlace}`)}`, target: "_blank", rel: "noopener" }, "💬 Enviar por WhatsApp"),
      h("div", { class: "compartir-bar" },
        h("button", { class: "btn-ghost", onclick: () => imagen().then(async (b) => {
          const r = await compartirImagen(b, archivo, textoCompartir);
          if (r === "sin_soporte") await modalImagen(b, archivo, enlace);
        }).catch(avisarError) }, "📤 Imagen"),
        h("button", { class: "btn-ghost", onclick: () => imagen().then((b) => (sinSoporte ? modalImagen(b, archivo, enlace) : imprimirImagen(b))).catch(avisarError) }, "🖨️ PDF"),
        h("button", { class: "btn-ghost", onclick: (e) => copiar(enlace, e.target) }, "🔗 Enlace")));
  }
}

// ------------------------------- Rutas -------------------------------

function rutear() {
  const m = location.hash.match(/^#\/rifa\/([a-z0-9-]+)(?:\/ticket\/(\d{1,6}))?$/);
  (m ? vistaRifa(m[1], m[2] ?? null) : vistaInicio()).catch((e) => {
    raiz.replaceChildren(h("main", { class: "contenedor" }, encabezado(), h("p", { class: "err" }, e.message), h("a", { href: "#/" }, "Volver")));
  });
}
window.addEventListener("hashchange", rutear);
window.ethereum?.on?.("accountsChanged", () => { if (!cuenta.porWc) { cuenta.direccion = null; rutear(); } });
rutear();
