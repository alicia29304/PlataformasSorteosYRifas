// Administracion: rifas, vendedores y pagos. No hay usuarios ni contrasenas: la cartera
// firma cada cambio y el verificador comprueba que sea de un administrador.

import {
  avisarError, conectarCartera, cop, corta, cuenta, desconectarCartera, fecha, firmarYEnviar, h,
  modalComprobante, mostrarModal, pad, panelEspera, pedir, rolDe,
} from "../../web3/src/comun.js";
import { descifrar } from "../../web3/src/cifrado.js";

const WEB = "https://sorteos-web3.aliciagadiaz29304.workers.dev";
const raiz = document.getElementById("app");
const enTauri = Boolean(window.__TAURI__);
const estado = { pestana: "rifas", rifaPagos: null, filtroEstado: "TODOS", filtroVendedor: "TODOS", clave: null };

const pintar = () => (cuenta.direccion ? panel() : inicio()).catch((e) => {
  raiz.replaceChildren(h("main", { class: "contenedor" }, h("p", { class: "err" }, e.message), h("button", { class: "btn-ghost", onclick: pintar }, "Reintentar")));
});
const salir = () => desconectarCartera(pintar);

function abrirWeb(url) {
  if (enTauri) window.__TAURI__.core.invoke("open_external", { url }).catch(avisarError);
  else window.open(url, "_blank", "noopener");
}

/** Lanza una accion firmada con su pantalla de espera y vuelve a pintar al terminar. */
async function ejecutar(titulo, accion, datos) {
  const espera = panelEspera();
  const zona = h("div", {}, espera.nodo);
  const cerrar = mostrarModal(titulo, zona);
  try {
    await firmarYEnviar(accion, datos, espera.avanzar);
    espera.detener();
    cerrar();
    await pintar();
    return true;
  } catch (e) {
    espera.detener();
    zona.replaceChildren(h("p", { class: "err" }, e.message));
    return false;
  }
}

function campo(etiqueta, attrs = {}) {
  const input = h(attrs.textarea ? "textarea" : "input", { class: "inp", autocomplete: "off", ...attrs, textarea: null });
  return { input, nodo: h("label", { class: "campo small" }, etiqueta, input) };
}

// ------------------------------- Inicio de sesion -------------------------------

async function inicio() {
  raiz.replaceChildren(h("main", { class: "contenedor", style: "max-width:520px;text-align:center" },
    h("h1", {}, "🎟️ Sorteos Web3"), h("p", { class: "mut" }, "Administración"),
    h("button", { class: "btn", style: "width:100%", onclick: () => conectarCartera(pintar).catch(avisarError) }, window.ethereum ? "Conectar cartera" : "Conectar con QR"),
    h("p", { class: "mut small", style: "margin-top:14px" }, window.ethereum
      ? "Tu cartera firmará cada cambio. No hay contraseñas."
      : "Escanea el código con MetaMask o Trust Wallet en tu celular. No hay contraseñas: tu cartera firma cada cambio."),
    enTauri ? h("button", { class: "btn-ghost", style: "width:100%;margin-top:6px", onclick: () => abrirWeb(`${WEB}/admin/`) }, "Usar la extensión de MetaMask (abre el navegador)") : null));
}

// ------------------------------- Panel -------------------------------

async function panel() {
  if (rolDe() !== "ADMIN") {
    raiz.replaceChildren(h("main", { class: "contenedor", style: "max-width:520px;text-align:center" },
      h("h2", {}, "Esta cartera no es administradora"),
      h("p", { class: "mut" }, corta(cuenta.direccion)),
      h("p", { class: "mut small" }, "Los administradores se asignan siguiendo la guía docs/GUIA-ADMINISTRADORES.md."),
      h("button", { class: "btn-ghost", onclick: salir }, "Salir")));
    return;
  }
  cuenta.roles = await pedir("/roles");
  const rifas = await pedir("/rifas");
  const pestana = (id, txt) => h("button", { class: `chip${estado.pestana === id ? " on" : ""}`, onclick: () => { estado.pestana = id; pintar(); } }, txt);
  const vista = { rifas: vistaRifas, vendedores: vistaVendedores, pagos: vistaPagos }[estado.pestana];
  const contenido = await vista(rifas);
  raiz.replaceChildren(h("main", { class: "contenedor" },
    h("div", { class: "barra" }, h("span", { class: "marca" }, "🎟️ Sorteos Web3 · Admin"),
      h("div", { class: "cuenta" }, h("span", { class: "chip on" }, corta(cuenta.direccion)), h("button", { class: "btn-ghost small", onclick: salir }, "Salir"))),
    h("div", { class: "chips", style: "margin-bottom:18px" }, pestana("rifas", "Rifas"), pestana("pagos", "Pagos"), pestana("vendedores", "Vendedores"),
      h("button", { class: "chip", onclick: pintar }, "↻ Actualizar")),
    contenido));
}

// ------------------------------- Rifas -------------------------------

const aSlug = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
// Las fechas se escriben en hora de Colombia, sea cual sea la zona del equipo.
const aIso = (local) => new Date(`${local}:00-05:00`).toISOString();

function vistaRifas(rifas) {
  return h("section", {},
    h("div", { class: "barra" }, h("h2", { style: "margin:0" }, "Rifas"), h("button", { class: "btn", onclick: modalNuevaRifa }, "+ Nueva rifa")),
    rifas.length === 0 ? h("p", { class: "mut" }, "Aún no hay rifas.") : rifas.map((r) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, r.titulo), ` · ${r.estado}`,
        h("div", { class: "mut small" }, `${cop(r.precioCop)} · números ${r.min} a ${r.max}`),
        h("div", { class: "mut small" }, `Cierre: ${fecha(r.finVentas)} · Sorteo: ${fecha(r.fechaSorteo)}`)),
      h("div", { class: "cuenta" },
        h("button", { class: "btn-ghost small", onclick: () => abrirWeb(`${WEB}/#/rifa/${r.slug}`) }, "Ver en la web"),
        h("button", { class: "btn-ghost small", onclick: () => { estado.pestana = "pagos"; estado.rifaPagos = r.slug; pintar(); } }, "Pagos"),
        r.estado === "ACTIVA"
          ? h("button", { class: "btn-ghost small", onclick: () => ejecutar("Cerrando ventas", "cambiar_estado_rifa", { slug: r.slug, estado: "CERRADA" }) }, "Cerrar ventas")
          : h("button", { class: "btn-ghost small", onclick: () => ejecutar("Reabriendo ventas", "cambiar_estado_rifa", { slug: r.slug, estado: "ACTIVA" }) }, "Reabrir")))));
}

function modalNuevaRifa() {
  const titulo = campo("Título *", { maxlength: 120 });
  const slug = campo("Dirección en la web * (se genera sola)", { maxlength: 60 });
  titulo.input.addEventListener("input", () => { slug.input.value = aSlug(titulo.input.value); });
  const descripcion = campo("Descripción", { maxlength: 1000 });
  const precio = campo("Precio por número (COP) *", { type: "number", min: 1, step: 1 });
  const min = campo("Primer número *", { type: "number", min: 0, value: 0 });
  const max = campo("Último número *", { type: "number", min: 0, value: 99 });
  const fin = campo("Cierre de ventas (hora Colombia) *", { type: "datetime-local" });
  const sorteo = campo("Fecha del sorteo (hora Colombia) *", { type: "datetime-local" });
  const error = h("div", { style: "margin-top:10px" });
  const cerrar = mostrarModal("Nueva rifa", titulo.nodo, slug.nodo, descripcion.nodo, precio.nodo, min.nodo, max.nodo, fin.nodo, sorteo.nodo,
    h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: crear }, "Firmar y crear"), error);

  function crear() {
    const datos = {
      slug: slug.input.value.trim(), titulo: titulo.input.value.trim(), descripcion: descripcion.input.value.trim(),
      precioCop: Number(precio.input.value), min: Number(min.input.value), max: Number(max.input.value),
    };
    const falta = !datos.slug || !datos.titulo || !datos.precioCop || !fin.input.value || !sorteo.input.value;
    if (falta) { error.replaceChildren(h("p", { class: "err" }, "Completa los campos con *.")); return; }
    if (fin.input.value > sorteo.input.value) { error.replaceChildren(h("p", { class: "err" }, "El sorteo no puede ser antes del cierre de ventas.")); return; }
    cerrar();
    ejecutar("Creando rifa", "crear_rifa", { ...datos, finVentas: aIso(fin.input.value), fechaSorteo: aIso(sorteo.input.value) });
  }
}

// ------------------------------- Vendedores -------------------------------

function vistaVendedores(rifas) {
  const lista = Object.entries(cuenta.roles.vendedores);
  return h("section", {},
    h("div", { class: "barra" }, h("h2", { style: "margin:0" }, "Vendedores"), h("button", { class: "btn", onclick: () => modalVendedor(rifas) }, "+ Agregar vendedor")),
    h("p", { class: "mut small" }, "Solo se necesita su nombre y la dirección pública de su cartera. Sin correos ni contraseñas."),
    lista.length === 0 ? h("p", { class: "mut" }, "Aún no hay vendedores.") : lista.map(([dir, v]) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, v.nombre), h("div", { class: "mut small" }, dir),
        h("div", { class: "mut small" }, v.rifas.length ? `Rifas: ${v.rifas.join(", ")}` : "Sin rifas asignadas")),
      h("div", { class: "cuenta" },
        h("button", { class: "btn-ghost small", onclick: () => modalVendedor(rifas, dir, v) }, "Editar"),
        h("button", { class: "btn-ghost small", onclick: () => {
          if (window.confirm(`¿Quitar el acceso de ${v.nombre}?`)) ejecutar("Quitando vendedor", "revocar_vendedor", { direccion: dir });
        } }, "Quitar")))));
}

function modalVendedor(rifas, direccion = "", actual = null) {
  const dir = campo("Dirección pública de la cartera *", { placeholder: "0x…", maxlength: 42, value: direccion, readonly: Boolean(direccion) });
  const nombre = campo("Nombre *", { maxlength: 60, value: actual?.nombre ?? "" });
  const marcas = rifas.map((r) => {
    const input = h("input", { type: "checkbox", checked: actual?.rifas.includes(r.slug) ?? false });
    return { slug: r.slug, input, nodo: h("label", { class: "small", style: "display:flex;gap:8px;margin-top:6px" }, input, r.titulo) };
  });
  const error = h("div", { style: "margin-top:10px" });
  const cerrar = mostrarModal(direccion ? "Editar vendedor" : "Agregar vendedor", dir.nodo, nombre.nodo,
    h("p", { class: "small", style: "margin:12px 0 0" }, "Rifas asignadas"), marcas.map((m) => m.nodo),
    h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: guardar }, "Firmar y guardar"), error);

  function guardar() {
    const direccionTxt = dir.input.value.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(direccionTxt)) { error.replaceChildren(h("p", { class: "err" }, "La dirección debe empezar por 0x y tener 42 caracteres.")); return; }
    if (!nombre.input.value.trim()) { error.replaceChildren(h("p", { class: "err" }, "Escribe el nombre.")); return; }
    cerrar();
    ejecutar("Guardando vendedor", "asignar_vendedor", {
      direccion: direccionTxt, nombre: nombre.input.value.trim(), rifas: marcas.filter((m) => m.input.checked).map((m) => m.slug),
    });
  }
}

// ------------------------------- Pagos -------------------------------

const nombreCartera = (dir) => {
  if (!dir) return "—";
  if (cuenta.roles.admins.includes(dir)) return "Administrador";
  return cuenta.roles.vendedores[dir]?.nombre ?? corta(dir);
};

function pedirClave(alListo) {
  const entrada = h("input", { class: "inp", type: "file", accept: ".json,application/json" });
  const error = h("div");
  const cerrar = mostrarModal("Clave de descifrado",
    h("p", { class: "mut small" }, "Selecciona tu archivo de clave privada. Solo se usa en esta sesión: no se guarda ni se envía."),
    entrada, error);
  entrada.addEventListener("change", async () => {
    try {
      estado.clave = JSON.parse(await entrada.files[0].text());
      cerrar();
      alListo();
    } catch {
      error.replaceChildren(h("p", { class: "err" }, "Ese archivo no es una clave válida."));
    }
  });
}

async function verDatosPrivados(orden) {
  try {
    const d = await descifrar(orden.privado, estado.clave);
    mostrarModal("Datos del comprador",
      h("p", {}, h("b", {}, "Nombre: "), `${d.nombre} ${d.apellido}`), h("p", {}, h("b", {}, "Teléfono: "), d.telefono),
      h("p", {}, h("b", {}, "Referencia: "), d.referencia || "—"));
  } catch {
    estado.clave = null;
    avisarError(new Error("Esta clave no abre estos datos. Puede que se hayan cifrado con otra."));
  }
}

async function vistaPagos(rifas) {
  if (rifas.length === 0) return h("p", { class: "mut" }, "Aún no hay rifas.");
  if (!rifas.some((r) => r.slug === estado.rifaPagos)) estado.rifaPagos = rifas[0].slug;
  const rifa = await pedir(`/rifas/${estado.rifaPagos}?cifrados=1`);
  const ordenes = Object.entries(rifa.ordenes).sort(([, a], [, b]) => b.registrado - a.registrado);
  const vendedores = [...new Set(ordenes.map(([, o]) => o.registradoPor))];
  const visibles = ordenes.filter(([, o]) => (estado.filtroEstado === "TODOS" || o.estado === estado.filtroEstado)
    && (estado.filtroVendedor === "TODOS" || o.registradoPor === estado.filtroVendedor));

  const opcion = (valor, txt, actual) => h("option", { value: valor, selected: valor === actual }, txt);
  const selector = (opciones, alCambiar) => h("select", { class: "inp", style: "width:auto", onchange: (e) => { alCambiar(e.target.value); pintar(); } }, opciones);
  const recaudo = visibles.filter(([, o]) => o.estado === "PAGADO").reduce((t, [, o]) => t + o.numeros.length * rifa.precioCop, 0);

  return h("section", {},
    h("h2", { style: "margin:0 0 10px" }, "Pagos"),
    h("div", { class: "cuenta", style: "margin-bottom:12px" },
      selector(rifas.map((r) => opcion(r.slug, r.titulo, estado.rifaPagos)), (v) => { estado.rifaPagos = v; }),
      selector(["TODOS", "PENDIENTE", "PAGADO", "ANULADO"].map((e) => opcion(e, e === "TODOS" ? "Todos los estados" : e, estado.filtroEstado)), (v) => { estado.filtroEstado = v; }),
      selector([opcion("TODOS", "Todos los vendedores", estado.filtroVendedor), ...vendedores.map((v) => opcion(v, nombreCartera(v), estado.filtroVendedor))], (v) => { estado.filtroVendedor = v; })),
    h("p", { class: "mut small" }, `${visibles.length} pago(s) · Pagado en esta vista: ${cop(recaudo)}`),
    visibles.length === 0 ? h("p", { class: "mut" }, "No hay pagos con este filtro.") : visibles.map(([id, o]) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, o.numeros.map((n) => pad(n, rifa.max)).join(", ")), ` · ${o.seudonimo}${o.ciudad ? ` · ${o.ciudad}` : ""} · ${o.metodo} · ${o.estado}`,
        h("div", { class: "mut small" }, `Registró ${nombreCartera(o.registradoPor)} · ${fecha(new Date(o.registrado * 1000).toISOString())}`),
        o.aprobadoPor ? h("div", { class: "mut small" }, `Aprobó ${nombreCartera(o.aprobadoPor)}`) : null,
        o.motivoAnulacion ? h("div", { class: "mut small" }, `Anulado: ${o.motivoAnulacion}`) : null),
      h("div", { class: "cuenta" },
        h("button", { class: "btn-ghost small", onclick: () => (estado.clave ? verDatosPrivados(o) : pedirClave(() => verDatosPrivados(o))) }, "Ver datos"),
        o.comprobanteHash ? h("button", { class: "btn-ghost small", onclick: () => modalComprobante(rifa.slug, id) }, "Comprobante") : null,
        o.estado === "PENDIENTE" ? h("button", { class: "btn small", onclick: () => ejecutar("Aprobando pago", "aprobar_pago", { slug: rifa.slug, orden: id }) }, "Aprobar") : null,
        o.estado !== "ANULADO" ? h("button", { class: "btn-ghost small", onclick: () => {
          const motivo = window.prompt("Motivo de la anulación");
          if (motivo?.trim()) ejecutar("Anulando pago", "anular_pago", { slug: rifa.slug, orden: id, motivo: motivo.trim().slice(0, 200) });
        } }, "Anular") : null))));
}

pintar();
