// Web publica. Cualquiera ve las rifas y consulta su ticket; registrar y aprobar pagos
// exige firmar con una cartera autorizada (MetaMask, Trust Wallet...).

import {
  avisarError, botonRecargar, config, conectarCartera, cop, corta, cuenta, desconectarCartera, fecha, firmarYEnviar, h,
  hayVersionNueva, modalComprobante, mostrarModal, pad, panelEspera, pedir, prepararComprobante, rolDe,
} from "./comun.js";
import { cifrar } from "./cifrado.js";
import { ticketsAPng, compartirImagen, imprimirImagen } from "./compartirTickets.js";

const MAX_SEL = 10;
const raiz = document.getElementById("app");
const conectar = () => conectarCartera(rutear);
const desconectar = () => desconectarCartera(rutear);


// ------------------------------- Inicio -------------------------------

function encabezado() {
  return h("div", { class: "barra" },
    h("a", { class: "marca", href: "#/" }, "🎟️ Sorteos y Rifas"),
    h("div", { class: "cuenta" }, cuenta.direccion
      ? [h("span", { class: "chip on" }, `${corta(cuenta.direccion)} · ${{ ADMIN: "Admin", VENDEDOR: "Vendedor", SIN_ROL: "Sin autorización" }[rolDe()]}`),
        h("button", { class: "btn-ghost small", onclick: () => desconectar() }, "Salir")]
      : h("button", { class: "btn-ghost small", onclick: () => conectar().catch(avisarError) }, "Soy vendedor: conectar cartera")));
}

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
  const accion = async (nombre, datos, titulo, comprobante = null) => {
    const panel = panelEspera();
    const zona = h("div", {}, panel.nodo);
    const cerrar = mostrarModal(titulo, zona);
    try {
      await firmarYEnviar(nombre, datos, panel.avanzar, comprobante);
      panel.detener();
      cerrar();
      rutear();
    } catch (e) {
      panel.detener();
      zona.replaceChildren(h("p", { class: "err" }, e.message), e.recargar ? botonRecargar() : "");
    }
  };
  const adjuntar = (archivo) => archivo && prepararComprobante(archivo)
    .then((c) => accion("adjuntar_comprobante", { slug: rifa.slug, orden: id, comprobanteHash: c.hash }, "Adjuntando comprobante", c.base64))
    .catch(avisarError);
  return h("div", { class: "orden" },
    h("div", {}, h("b", {}, o.numeros.map((n) => pad(n, rifa.max)).join(", ")), ` · ${o.seudonimo} · ${o.metodo} · ${o.estado}`,
      h("div", { class: "mut small" }, `Registró ${corta(o.registradoPor)}`)),
    h("div", { class: "cuenta" },
      h("button", { class: "btn-ghost small", onclick: () => modalTicket(rifa, o.numeros[0]) }, "Ver ticket"),
      o.comprobanteHash
        ? h("button", { class: "btn-ghost small", onclick: () => modalComprobante(rifa.slug, id) }, "Ver comprobante")
        : h("label", { class: "btn-ghost small", style: "cursor:pointer" }, "Adjuntar comprobante",
          h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => adjuntar(e.target.files[0]) })),
      o.estado === "PENDIENTE" ? h("button", { class: "btn small", onclick: () => accion("aprobar_pago", { slug: rifa.slug, orden: id }, "Aprobando pago") }, "Aprobar") : null,
      rol === "ADMIN" ? h("button", { class: "btn-ghost small", onclick: () => {
        const motivo = window.prompt("Motivo de la anulación");
        if (motivo?.trim()) accion("anular_pago", { slug: rifa.slug, orden: id, motivo: motivo.trim().slice(0, 200) }, "Anulando pago");
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
  const archivo = h("input", { class: "inp", type: "file", accept: "image/*" });
  const zonaArchivo = h("label", { class: "campo small", style: "display:none" }, "Comprobante de pago (foto o captura)", archivo);
  config().then((c) => { if (c.comprobantes) zonaArchivo.style.display = ""; }).catch(() => {});
  const estado = h("div", { style: "margin-top:10px" });
  const boton = h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: enviar }, "Firmar y registrar");
  const resumen = `${numeros.map((n) => pad(n, rifa.max)).join(", ")} · ${cop(rifa.precioCop * numeros.length)}`;
  const formulario = h("div", {},
    h("p", { class: "mut small" }, resumen),
    nombre.nodo, apellido.nodo, ciudad.nodo, telefono.nodo, metodo.nodo, referencia.nodo, zonaArchivo,
    h("p", { class: "mut small" }, "Público: nombre, inicial del apellido y ciudad. El teléfono y la referencia van cifrados: solo el administrador puede leerlos. El comprobante solo lo ven los vendedores de esta rifa y el administrador."),
    boton, estado);
  const contenido = h("div", {}, formulario);
  const cerrarModal = mostrarModal("Registrar pago", contenido);

  async function enviar() {
    const nom = nombre.input.value.trim().split(/\s+/)[0];
    const ape = apellido.input.value.trim();
    const tel = telefono.input.value.replace(/\D/g, "");
    if (!nom || tel.length < 7 || !metodo.input.value.trim()) { estado.replaceChildren(h("p", { class: "err" }, "Completa nombre, teléfono y método de pago.")); return; }
    // El formulario se oculta mientras se espera; si algo falla vuelve con sus datos.
    const panel = panelEspera();
    estado.replaceChildren();
    formulario.style.display = "none";
    contenido.append(h("p", { class: "mut small", style: "text-align:center;margin:0" }, resumen), panel.nodo);
    const tarjeta = contenido.closest(".modal-card");
    if (tarjeta) tarjeta.scrollTop = 0;
    try {
      const { cifradoPublica } = await config();
      panel.avanzar("Preparando…");
      const comprobante = archivo.files[0] ? await prepararComprobante(archivo.files[0]) : null;
      const ciudadTxt = ciudad.input.value.trim();
      const datos = {
        slug: rifa.slug, numeros, seudonimo: ape ? `${nom} ${ape[0].toUpperCase()}.` : nom,
        metodo: metodo.input.value.trim(),
        privado: await cifrar({ nombre: nom, apellido: ape, telefono: tel, referencia: referencia.input.value.trim() }, cifradoPublica),
        ...(ciudadTxt ? { ciudad: ciudadTxt } : {}),
        ...(comprobante ? { comprobanteHash: comprobante.hash } : {}),
      };
      await firmarYEnviar("registrar_pago", datos, panel.avanzar, comprobante?.base64);
      panel.detener();
      cerrarModal();
      await vistaRifa(rifa.slug, numeros[0]);
    } catch (e) {
      panel.detener();
      contenido.replaceChildren(formulario);
      formulario.style.display = "";
      estado.replaceChildren(h("p", { class: "err" }, e.message), e.recargar ? botonRecargar() : "");
      estado.scrollIntoView({ block: "center" });
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
// Una pestana que vuelve a primer plano se actualiza sola, salvo con un formulario abierto.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && !document.querySelector(".modal-back") && await hayVersionNueva()) location.reload();
});
window.ethereum?.on?.("accountsChanged", () => { if (!cuenta.porWc) { cuenta.direccion = null; rutear(); } });
rutear();
