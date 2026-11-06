// Administracion: rifas, vendedores y pagos. No hay usuarios ni contrasenas: la cartera
// firma cada cambio y el verificador comprueba que sea de un administrador.

import {
  avisarError, confirmar, conectarCartera, cop, corta, cuenta, desconectarCartera, enviarFirmado, fecha, firmarYEnviar, h,
  modalAdjuntar, modalComprobante, mostrarModal, pad, panelEspera, pedir, rolDe,
} from "../../web3/src/comun.js";
import { descifrar } from "../../web3/src/cifrado.js";
import { crearClaveSesion, delegacionHex, direccionDe, firmarConClave } from "../../../services/verificador/src/mensaje.js";

const WEB = "https://sorteos-web3.aliciagadiaz29304.workers.dev";
const raiz = document.getElementById("app");
const enTauri = Boolean(window.__TAURI__);
const estado = { pestana: "panel", rifaActual: null, filtroEstado: "TODOS", filtroVendedor: "TODOS", claves: [] };

// ------------------------------- Sesion en este equipo -------------------------------
// Solo en la app instalada: se guarda en el Administrador de credenciales de Windows.
// En el navegador nada se recuerda y la cartera firma cada cambio.

const DIAS_SESION = 90;
const secreto = {
  leer: async (nombre) => (enTauri ? window.__TAURI__.core.invoke("leer_secreto", { nombre }) : null),
  guardar: async (nombre, valor) => { if (enTauri) await window.__TAURI__.core.invoke("guardar_secreto", { nombre, valor }); },
  borrar: async (nombre) => { if (enTauri) await window.__TAURI__.core.invoke("borrar_secreto", { nombre }); },
};

function activarSesion({ cartera, privada, delegacion }) {
  Object.assign(cuenta, {
    direccion: cartera, firmaCon: delegacion.sesion, porWc: false, delegacion,
    proveedor: { request: async ({ params }) => firmarConClave(privada, params[0]) },
  });
}

/** Al abrir la app: si este equipo ya esta autorizado, entra sin pedir nada. */
async function restaurar() {
  try {
    estado.claves = JSON.parse((await secreto.leer("claves")) ?? "[]");
    const guardada = JSON.parse((await secreto.leer("sesion")) ?? "null");
    if (!guardada) return;
    if (guardada.delegacion.expira <= Date.now() / 1000 + 60) { await secreto.borrar("sesion"); return; }
    activarSesion(guardada);
  } catch (e) {
    console.error(e);
  }
}

/** Unica firma en el telefono: autoriza a este equipo y suelta la conexion con la cartera. */
async function autorizarEquipo() {
  if (!enTauri || !cuenta.direccion || rolDe() !== "ADMIN") return;
  const clave = crearClaveSesion();
  const expira = Math.floor(Date.now() / 1000) + DIAS_SESION * 86400;
  const cerrar = mostrarModal("Autorizar este equipo", h("p", {}, "Abre tu cartera y confirma una sola vez. Después no volverá a pedirte firmas hasta que cierres sesión."));
  const conexion = cuenta.proveedor;
  const porWc = cuenta.porWc;
  try {
    const firma = await conexion.request({ method: "personal_sign", params: [delegacionHex({ firmante: cuenta.direccion, sesion: clave.direccion, expira }), cuenta.firmaCon] });
    const datos = { cartera: cuenta.direccion, privada: clave.privada, delegacion: { sesion: clave.direccion, expira, firma } };
    await secreto.guardar("sesion", JSON.stringify(datos));
    activarSesion(datos);
    if (porWc) conexion.disconnect().catch(() => {});
  } finally {
    cerrar();
  }
}

/** Guarda en Descargas. Devuelve la ruta para mostrarla. */
async function guardarArchivo(nombre, contenido) {
  if (enTauri) return window.__TAURI__.core.invoke("guardar_archivo", { nombre, contenido });
  const url = URL.createObjectURL(new Blob([contenido]));
  const a = h("a", { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  return `Descargas\\${nombre}`;
}

const contenidoCredenciales = (direccion, clavePrivada) => JSON.stringify({
  tipo: "sorteosweb3-credenciales", direccion, clavePrivada, clavesCifrado: estado.claves,
}, null, 2);

/** Entrar subiendo el archivo: sin QR ni telefono. La clave de la cartera no se guarda. */
async function entrarConArchivo(archivo, aviso) {
  let datos;
  try {
    datos = JSON.parse(await archivo.text());
    if (datos.tipo !== "sorteosweb3-credenciales") throw new Error();
    if (direccionDe(datos.clavePrivada) !== datos.direccion) throw new Error();
  } catch {
    aviso.replaceChildren(h("p", { class: "err" }, "Ese no es un archivo de credenciales válido."));
    return;
  }
  const roles = await pedir("/roles");
  if (!roles.admins.includes(datos.direccion)) {
    aviso.replaceChildren(h("p", { class: "err" }, "Esta cartera ya no es administradora."));
    return;
  }
  for (const clave of datos.clavesCifrado ?? []) if (!estado.claves.some((c) => c.d === clave.d)) estado.claves.push(clave);
  await secreto.guardar("claves", JSON.stringify(estado.claves));
  const clave = crearClaveSesion();
  const expira = Math.floor(Date.now() / 1000) + DIAS_SESION * 86400;
  const firma = await firmarConClave(datos.clavePrivada, delegacionHex({ firmante: datos.direccion, sesion: clave.direccion, expira }));
  const sesion = { cartera: datos.direccion, privada: clave.privada, delegacion: { sesion: clave.direccion, expira, firma } };
  await secreto.guardar("sesion", JSON.stringify(sesion));
  activarSesion(sesion);
  await pintar();
}

async function salir() {
  // Se invalida la clave para siempre; si no hay internet, de todos modos vence sola.
  if (cuenta.delegacion) await enviarFirmado("revocar_sesion", { sesion: cuenta.delegacion.sesion }).catch(console.error);
  await secreto.borrar("sesion").catch(console.error);
  await desconectarCartera(pintar);
}

const entrar = () => conectarCartera(() => autorizarEquipo().catch(avisarError).then(pintar)).catch(avisarError);

const pintar = () => (cuenta.direccion ? panel() : inicio()).catch((e) => {
  raiz.replaceChildren(h("main", { class: "contenedor" }, h("p", { class: "err" }, e.message), h("button", { class: "btn-ghost", onclick: pintar }, "Reintentar")));
});

function abrirWeb(url) {
  if (enTauri) window.__TAURI__.core.invoke("open_external", { url }).catch(avisarError);
  else window.open(url, "_blank", "noopener");
}

/** Lanza una accion firmada con su pantalla de espera y vuelve a pintar al terminar. */
async function ejecutar(titulo, accion, datos, comprobante = null) {
  const espera = panelEspera();
  const zona = h("div", {}, espera.nodo);
  const cerrar = mostrarModal(titulo, zona);
  try {
    await firmarYEnviar(accion, datos, espera.avanzar, comprobante);
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
  const aviso = h("div", { style: "margin-top:12px" });
  const archivo = h("input", { type: "file", accept: ".json,application/json", style: "display:none", onchange: () => {
    if (archivo.files[0]) entrarConArchivo(archivo.files[0], aviso).catch((e) => aviso.replaceChildren(h("p", { class: "err" }, e.message)));
  } });
  raiz.replaceChildren(h("main", { class: "contenedor", style: "max-width:520px;text-align:center" },
    h("h1", {}, "🎟️ Sorteos Web3"), h("p", { class: "mut" }, "Administración"),
    enTauri ? [archivo,
      h("button", { class: "btn", style: "width:100%", onclick: () => { archivo.value = ""; archivo.click(); } }, "📄 Entrar con mi archivo de credenciales"),
      h("p", { class: "mut small", style: "margin-top:10px" }, "Súbelo una vez y no vuelve a pedirte nada hasta que cierres sesión."), aviso,
      h("button", { class: "btn-ghost", style: "width:100%;margin-top:14px", onclick: entrar }, "Entrar con mi cartera (QR)")] : [
      h("button", { class: "btn", style: "width:100%", onclick: entrar }, window.ethereum ? "Conectar cartera" : "Conectar con QR"),
      h("p", { class: "mut small", style: "margin-top:14px" }, "Tu cartera firmará cada cambio.")]));
}

// ------------------------------- Panel -------------------------------

async function panel() {
  // Antes de comprobar el rol: una sesion restaurada aun no tiene la lista.
  cuenta.roles = await pedir("/roles");
  if (rolDe() !== "ADMIN") {
    raiz.replaceChildren(h("main", { class: "contenedor", style: "max-width:520px;text-align:center" },
      h("h2", {}, "Esta cartera no es administradora"),
      h("p", { class: "mut" }, corta(cuenta.direccion)),
      h("p", { class: "mut small" }, "Pídele a un administrador que agregue esta cartera en la sección Administradores."),
      h("button", { class: "btn-ghost", onclick: salir }, "Salir")));
    return;
  }
  const rifas = await pedir("/rifas");
  const menu = [["panel", "📊 Panel", vistaPanel], ["rifas", "🎟️ Rifas", vistaRifas], ["pagos", "🧾 Comprobantes", vistaPagos], ["ganadores", "🏆 Ganadores", vistaGanadores], ["vendedores", "🧑‍💼 Usuarios vendedores", vistaVendedores], ["credenciales", "🔑 Administradores", vistaCredenciales]];
  const contenido = await menu.find(([id]) => id === estado.pestana)[2](rifas);
  raiz.replaceChildren(h("div", { class: "admin" },
    h("aside", { class: "sidebar" },
      h("div", { class: "brand" }, h("div", { class: "brand-badge" }, "🎟️"),
        h("div", {}, h("div", { class: "brand-name" }, "Sorteos Web3"), h("div", { class: "brand-sub" }, "Administración"))),
      h("nav", { class: "nav" }, menu.map(([id, txt]) => h("button", { class: `nav-item${estado.pestana === id ? " active" : ""}`, onclick: () => { estado.pestana = id; pintar(); } }, txt))),
      h("div", { class: "sidebar-foot" },
        h("div", { class: "user-mail" }, "Administrador"), h("div", { class: "user-role" }, corta(cuenta.direccion)),
        h("button", { class: "nav-salir", onclick: salir }, "Cerrar sesión"),
        h("button", { class: "nav-actualizar", onclick: pintar }, "↻ Actualizar datos"))),
    h("main", { class: "content" }, contenido)));
}

/** La rifa de trabajo, comun a Panel y Comprobantes: por defecto la activa mas reciente. */
function elegirRifa(rifas) {
  if (rifas.some((r) => r.slug === estado.rifaActual)) return;
  const reciente = (a, b) => (b.creada ?? 0) - (a.creada ?? 0) || Date.parse(b.finVentas) - Date.parse(a.finVentas);
  const activas = rifas.filter((r) => r.estado === "ACTIVA").sort(reciente);
  estado.rifaActual = (activas[0] ?? [...rifas].sort(reciente)[0]).slug;
}

const encabezadoPagina = (titulo, subtitulo, ...acciones) => h("div", { class: "topbar" },
  h("div", {}, h("h1", { class: "page-title" }, titulo), subtitulo ? h("p", { class: "mut" }, subtitulo) : null), h("div", { class: "acciones" }, acciones));

// ------------------------------- Panel -------------------------------

async function vistaPanel(rifas) {
  if (rifas.length === 0) return h("section", {}, encabezadoPagina("Panel de control", "Aún no hay rifas."));
  elegirRifa(rifas);
  const r = await pedir(`/rifas/${estado.rifaActual}`);
  const total = r.max - r.min + 1;
  const numeros = Object.values(r.numeros);
  const vendidos = numeros.filter((x) => x.estado === "PAGADO").length;
  const apartados = numeros.length - vendidos;
  const pendientes = Object.values(r.ordenes).filter((o) => o.estado === "PENDIENTE").length;
  const avance = Math.round((vendidos / total) * 100);
  const dato = (v, t) => h("div", { class: "stat-card" }, h("div", { class: "stat-value" }, String(v)), h("div", { class: "stat-label" }, t));
  const celda = (t, v) => h("div", {}, h("div", { class: "mut small" }, t), h("b", {}, v));
  return h("section", {},
    encabezadoPagina("Panel de control", "Estado general del sorteo",
      rifas.length > 1 ? h("select", { class: "inp", style: "width:auto", onchange: (e) => { estado.rifaActual = e.target.value; pintar(); } },
        rifas.map((x) => h("option", { value: x.slug, selected: x.slug === estado.rifaActual }, x.titulo))) : null),
    h("div", { class: "stats" }, dato(pendientes, "Pagos pendientes"), dato(vendidos, "Números vendidos"), dato(total, "Total de números"), dato(`${avance}%`, "Avance de venta")),
    h("div", { class: "tarjeta" },
      h("h3", { style: "margin:0 0 12px" }, r.estado === "ACTIVA" ? "Rifa activa" : "Rifa cerrada"),
      h("h2", { style: "margin:0 0 10px" }, r.titulo),
      h("div", { class: "datos-rifa" }, celda("Precio / número", cop(r.precioCop)), celda("Rango", `${pad(r.min, r.max)}–${pad(r.max, r.max)}`),
        celda("Vendidos", `${vendidos} de ${total}`), celda("Apartados", String(apartados)), celda("Estado", r.estado),
        celda("Recaudado", cop(vendidos * r.precioCop))),
      h("div", { class: "progress" }, h("div", { class: "progress-bar", style: `width:${avance}%` })),
      r.ganador ? h("p", { style: "margin-top:14px" }, `🏆 Ganador: ${pad(r.ganador.numero, r.max)}${r.ganador.vendido ? ` · ${r.ganador.seudonimo}` : " · número sin vender"}`) : null));
}

// ------------------------------- Ganadores -------------------------------

function vistaGanadores(rifas) {
  return Promise.all(rifas.map((r) => pedir(`/rifas/${r.slug}`))).then((lista) => h("section", {},
    encabezadoPagina("Ganadores", "Asigna el número de un sorteo externo o sortea entre los números vendidos."),
    lista.length === 0 ? h("p", { class: "mut" }, "Aún no hay rifas.") : lista.map(tarjetaGanador)));
}

function tarjetaGanador(r) {
  const g = r.ganador;
  const pagados = Object.values(r.numeros).filter((x) => x.estado === "PAGADO").length;
  const pendientes = Object.values(r.ordenes).filter((o) => o.estado === "PENDIENTE").length;
  const abierta = r.estado === "ACTIVA" && Date.now() <= Date.parse(r.finVentas);
  const cuerpo = [];
  if (g) {
    cuerpo.push(h("p", { class: "ganador-admin" }, `🏆 ${pad(g.numero, r.max)}`),
      h("p", {}, h("b", {}, g.vendido ? `${g.seudonimo}${g.ciudad ? ` · ${g.ciudad}` : ""}` : "Número sin vender: el sorteo queda sin ganador")),
      h("p", { class: "mut small" }, g.modo === "EXTERNO" ? `Sorteo externo: ${g.fuente}` : `Sorteo interno entre ${g.azar.participantes} números · azar público drand, ronda ${g.azar.ronda}`),
      g.vendido ? h("p", { class: "mut small" }, "Abre sus datos en Comprobantes para contactarlo.") : null,
      h("button", { class: "btn-ghost small", onclick: async () => {
        const motivo = await confirmar("Anular ganador", "Quedará registrado públicamente que este resultado se anuló.", { conMotivo: true, boton: "Continuar" });
        ejecutar("Anulando ganador", "anular_ganador", { slug: r.slug, motivo });
      } }, "Anular ganador"));
  } else if (abierta) {
    cuerpo.push(h("p", { class: "mut" }, "Las ventas siguen abiertas. Ciérralas para poder declarar el ganador."),
      h("button", { class: "btn small", onclick: () => ejecutar("Cerrando ventas", "cambiar_estado_rifa", { slug: r.slug, estado: "CERRADA" }) }, "Cerrar ventas"));
  } else if (pendientes > 0) {
    cuerpo.push(h("p", { class: "mut" }, `Hay ${pendientes} pago(s) pendientes. Apruébalos o anúlalos antes: un comprador con pago en revisión no puede quedar por fuera.`),
      h("button", { class: "btn small", onclick: () => { Object.assign(estado, { pestana: "pagos", rifaActual: r.slug, filtroEstado: "PENDIENTE" }); pintar(); } }, "Revisar pagos"));
  } else {
    cuerpo.push(h("p", { class: "mut small" }, `${pagados} número(s) vendidos.`), h("div", { class: "acciones" },
      h("button", { class: "btn small", onclick: () => modalExterno(r) }, "🎯 Sorteo externo"),
      h("button", { class: "btn small", disabled: pagados === 0, onclick: async () => {
        await confirmar("Sortear entre los vendidos", `Participan ${pagados} número(s). El azar lo pone drand, una fuente pública que nadie controla, después de tu firma. El resultado queda publicado.`, { boton: "Continuar" });
        ejecutar("Sorteando", "declarar_ganador", { slug: r.slug, modo: "INTERNO" });
      } }, "🎲 Sortear entre vendidos")));
  }
  return h("div", { class: "tarjeta" }, h("h3", { style: "margin:0 0 4px" }, r.titulo), h("p", { class: "mut small" }, `Sorteo: ${fecha(r.fechaSorteo)} · ${r.estado}`), cuerpo,
    r.ganadoresAnulados?.length ? h("p", { class: "mut small", style: "margin-top:10px" }, `Resultados anulados: ${r.ganadoresAnulados.map((x) => `${pad(x.numero, r.max)} (${x.motivoAnulacion})`).join(", ")}`) : null);
}

function modalExterno(r) {
  const numero = campo(`Número ganador (${pad(r.min, r.max)} a ${pad(r.max, r.max)}) *`, { inputmode: "numeric", maxlength: 6 });
  const fuente = campo("Sorteo de referencia *", { placeholder: "Ej: Lotería de Boyacá, 7 de noviembre", maxlength: 120 });
  const vista = h("div", { style: "margin-top:10px" });
  const valor = () => (/^\d+$/.test(numero.input.value.trim()) ? Number(numero.input.value.trim()) : null);
  numero.input.addEventListener("input", () => {
    const n = valor();
    if (n === null) { vista.replaceChildren(); return; }
    const ref = r.numeros[String(n)];
    const orden = ref?.estado === "PAGADO" ? r.ordenes[ref.orden] : null;
    vista.replaceChildren(h("div", { class: `aviso${orden ? " ok" : ""}` }, n < r.min || n > r.max ? "Ese número está fuera del rango de la rifa."
      : orden ? `Ganaría ${orden.seudonimo}${orden.ciudad ? ` · ${orden.ciudad}` : ""}.` : "Ese número no se vendió: el sorteo quedará sin ganador."));
  });
  const error = h("div");
  const cerrar = mostrarModal(`Sorteo externo · ${r.titulo}`, numero.nodo, fuente.nodo, vista, error,
    h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: () => {
      const n = valor();
      if (n === null || n < r.min || n > r.max) { error.replaceChildren(h("p", { class: "err" }, "Escribe un número dentro del rango.")); return; }
      if (!fuente.input.value.trim()) { error.replaceChildren(h("p", { class: "err" }, "Indica de qué sorteo sale el número.")); return; }
      cerrar();
      ejecutar("Declarando ganador", "declarar_ganador", { slug: r.slug, modo: "EXTERNO", numero: n, fuente: fuente.input.value.trim() });
    } }, "Firmar y declarar"));
}

// ------------------------------- Rifas -------------------------------

const aSlug = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
// Las fechas se escriben en hora de Colombia, sea cual sea la zona del equipo.
const aIso = (local) => new Date(`${local}:00-05:00`).toISOString();

function vistaRifas(rifas) {
  return h("section", {},
    encabezadoPagina("Rifas", "Crea rifas y controla sus ventas.", h("button", { class: "btn", onclick: modalNuevaRifa }, "+ Nueva rifa")),
    rifas.length === 0 ? h("p", { class: "mut" }, "Aún no hay rifas.") : rifas.map((r) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, r.titulo), ` · ${r.estado}`,
        h("div", { class: "mut small" }, `${cop(r.precioCop)} · números ${r.min} a ${r.max}`),
        h("div", { class: "mut small" }, `Cierre: ${fecha(r.finVentas)} · Sorteo: ${fecha(r.fechaSorteo)}`)),
      h("div", { class: "acciones" },
        h("button", { class: "btn-ghost small", onclick: () => abrirWeb(`${WEB}/#/rifa/${r.slug}`) }, "Ver en la web"),
        h("button", { class: "btn-ghost small", onclick: () => { estado.pestana = "pagos"; estado.rifaActual = r.slug; pintar(); } }, "Pagos"),
        r.estado === "ACTIVA"
          ? h("button", { class: "btn-ghost small", onclick: () => ejecutar("Cerrando ventas", "cambiar_estado_rifa", { slug: r.slug, estado: "CERRADA" }) }, "Cerrar ventas")
          : r.numeroGanador == null ? h("button", { class: "btn-ghost small", onclick: () => ejecutar("Reabriendo ventas", "cambiar_estado_rifa", { slug: r.slug, estado: "ACTIVA" }) }, "Reabrir") : null))));
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

function bloqueClave(privada, nota) {
  return h("div", { class: "aviso" },
    h("div", { class: "small" }, h("b", {}, "Clave privada de la cartera")),
    h("code", { class: "clave-privada" }, privada),
    h("button", { type: "button", class: "btn-ghost small", style: "margin-top:8px", onclick: (e) => navigator.clipboard.writeText(privada).then(() => { e.target.textContent = "Copiada ✓"; }) }, "Copiar"),
    h("p", { class: "mut small", style: "margin:8px 0 0" }, nota));
}

const instruccionesVendedor = (nombre, c) => `Cartera de vendedor: ${nombre}

Direccion publica: ${c.direccion}
Clave privada: ${c.privada}

Como usarla:
1. En Trust Wallet o MetaMask, elige "Importar cartera" y pega la clave privada (red Ethereum).
2. Abre ${WEB} dentro de la cartera.
3. Toca "Soy vendedor: conectar cartera".

No necesita fondos. Quien tenga esta clave puede vender en tu nombre: no la publiques.
`;

function vistaVendedores(rifas) {
  const lista = Object.entries(cuenta.roles.vendedores);
  return h("section", {},
    encabezadoPagina("Usuarios vendedores", "Solo se necesita su nombre y la dirección pública de su cartera. Sin correos ni contraseñas.",
      h("button", { class: "btn", onclick: () => modalVendedor(rifas) }, "+ Agregar vendedor")),
    lista.length === 0 ? h("p", { class: "mut" }, "Aún no hay vendedores.") : lista.map(([dir, v]) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, v.nombre), h("div", { class: "mut small" }, dir),
        h("div", { class: "mut small" }, v.rifas.length ? `Rifas: ${v.rifas.join(", ")}` : "Sin rifas asignadas")),
      h("div", { class: "acciones" },
        h("button", { class: "btn-ghost small", onclick: () => modalVendedor(rifas, dir, v) }, "Editar"),
        h("button", { class: "btn-ghost small", onclick: async () => {
          await confirmar("Quitar vendedor", `${v.nombre} ya no podrá registrar ni aprobar pagos.`, { boton: "Continuar" });
          ejecutar("Quitando vendedor", "revocar_vendedor", { direccion: dir });
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
  let generada = null;
  const zonaGenerada = h("div");
  const generar = direccion ? null : h("button", { type: "button", class: "btn-ghost small", style: "margin-top:8px", onclick: () => {
    generada = crearClaveSesion();
    dir.input.value = generada.direccion;
    dir.input.readOnly = true;
    generar.remove();
    zonaGenerada.replaceChildren(bloqueClave(generada.privada, "Se guardará también un archivo con estos datos para que se lo entregues al vendedor."));
  } }, "✨ Generar una cartera nueva");
  const cerrar = mostrarModal(direccion ? "Editar vendedor" : "Agregar vendedor", dir.nodo, generar ?? "", zonaGenerada, nombre.nodo,
    h("p", { class: "small", style: "margin:12px 0 0" }, "Rifas asignadas"), marcas.map((m) => m.nodo),
    h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: guardar }, "Firmar y guardar"), error);

  async function guardar() {
    const direccionTxt = dir.input.value.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(direccionTxt)) { error.replaceChildren(h("p", { class: "err" }, "La dirección debe empezar por 0x y tener 42 caracteres.")); return; }
    if (!nombre.input.value.trim()) { error.replaceChildren(h("p", { class: "err" }, "Escribe el nombre.")); return; }
    // Primero el archivo: si algo falla despues, la clave no se pierde.
    const ruta = generada ? await guardarArchivo(`cartera-vendedor-${aSlug(nombre.input.value)}.txt`, instruccionesVendedor(nombre.input.value.trim(), generada)).catch((e) => { error.replaceChildren(h("p", { class: "err" }, String(e))); return null; }) : "";
    if (ruta === null) return;
    cerrar();
    const hecho = await ejecutar("Guardando vendedor", "asignar_vendedor", {
      direccion: direccionTxt, nombre: nombre.input.value.trim(), rifas: marcas.filter((m) => m.input.checked).map((m) => m.slug),
    });
    if (hecho && generada) mostrarModal("Vendedor listo", bloqueClave(generada.privada, "Pásale esta clave privada: la importa en Trust Wallet o MetaMask y entra a la web."), h("p", { class: "small" }, `Archivo guardado en: ${ruta}`));
  }
}

// ------------------------------- Administradores -------------------------------

function vistaCredenciales() {
  const admins = cuenta.roles.admins;
  return h("section", {},
    encabezadoPagina("Administradores", "Agrega o quita administradores desde aquí. No hace falta entrar a GitHub.",
      h("button", { class: "btn", onclick: modalAdmin }, "+ Agregar administrador")),
    admins.map((a) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, a === cuenta.direccion ? "Tú" : "Administrador"), h("div", { class: "mut small" }, a)),
      h("div", { class: "acciones" },
        admins.length > 1 ? h("button", { class: "btn-ghost small", onclick: async () => {
          await confirmar("Quitar administrador", a === cuenta.direccion ? "Es tu propia cartera: perderás el acceso al terminar." : "Esa cartera dejará de tener acceso.", { boton: "Continuar" });
          ejecutar("Quitando administrador", "quitar_admin", { direccion: a });
        } }, "Quitar") : null))),
    h("div", { class: "tarjeta", style: "margin-top:18px" },
      h("h3", { style: "margin:0 0 6px" }, "Datos privados de los compradores"),
      estado.claves.length
        ? h("p", { class: "mut small" }, "Este equipo ya tiene la clave y los muestra solo en Comprobantes.")
        : h("button", { class: "btn-ghost small", onclick: pedirClave }, "🔑 Cargar clave"),
      h("p", { class: "mut small", style: "margin:8px 0 0" }, "Cada archivo de credenciales que generes la incluye: quien lo suba podrá ver esos datos.")));
}

function modalAdmin() {
  const dir = campo("Dirección pública (si ya tiene cartera)", { placeholder: "0x… · déjala vacía para generar una nueva", maxlength: 42 });
  const error = h("div", { style: "margin-top:10px" });
  const cerrar = mostrarModal("Agregar administrador", dir.nodo,
    h("p", { class: "mut small" }, "Si la dejas vacía, se crea una cartera nueva y se guarda un archivo de credenciales para entrar a esta app e importarla en tu teléfono."),
    h("button", { class: "btn", style: "width:100%;margin-top:14px", onclick: agregar }, "Agregar"), error);

  async function agregar() {
    const texto = dir.input.value.trim().toLowerCase();
    if (texto && !/^0x[0-9a-f]{40}$/.test(texto)) { error.replaceChildren(h("p", { class: "err" }, "La dirección debe empezar por 0x y tener 42 caracteres.")); return; }
    let nueva = null;
    let ruta = "";
    if (!texto) {
      nueva = crearClaveSesion();
      try {
        // Primero el archivo: si algo falla despues, la clave no se pierde.
        ruta = await guardarArchivo(`credenciales-admin-${nueva.direccion.slice(2, 8)}.json`, contenidoCredenciales(nueva.direccion, nueva.privada));
      } catch (e) {
        error.replaceChildren(h("p", { class: "err" }, String(e)));
        return;
      }
    }
    cerrar();
    const hecho = await ejecutar("Agregando administrador", "asignar_admin", { direccion: texto || nueva.direccion });
    if (hecho && nueva) {
      mostrarModal("Administrador listo", bloqueClave(nueva.privada, "Impórtala en Trust Wallet o MetaMask si quieres usarla también en el teléfono."),
        h("p", { class: "small" }, `Archivo de credenciales: ${ruta}`),
        h("p", { class: "mut small" }, "Para entrar con ella: Cerrar sesión y subir ese archivo. Guárdalo en un lugar seguro."));
    }
  }
}

// ------------------------------- Pagos -------------------------------

const nombreCartera = (dir) => {
  if (!dir) return "—";
  if (cuenta.roles.admins.includes(dir)) return "Administrador";
  return cuenta.roles.vendedores[dir]?.nombre ?? corta(dir);
};

function pedirClave() {
  const entrada = h("input", { class: "inp", type: "file", accept: ".json,application/json" });
  const error = h("div");
  const cerrar = mostrarModal("Clave de descifrado",
    h("p", { class: "mut small" }, enTauri
      ? "Selecciona tu archivo de clave privada. Se guarda protegido en este equipo y no se vuelve a pedir."
      : "Selecciona tu archivo de clave privada. Solo se usa mientras esta página esté abierta."),
    entrada, error);
  entrada.addEventListener("change", async () => {
    try {
      const clave = JSON.parse(await entrada.files[0].text());
      if (clave.kty !== "EC" || !clave.d) throw new Error("no es una clave");
      if (!estado.claves.some((c) => c.d === clave.d)) estado.claves.push(clave);
      await secreto.guardar("claves", JSON.stringify(estado.claves));
      cerrar();
      pintar();
    } catch {
      error.replaceChildren(h("p", { class: "err" }, "Ese archivo no es una clave válida."));
    }
  });
}

/** Prueba las claves guardadas: al cambiar de clave, los pagos viejos siguen abriendo con la anterior. */
async function datosDe(orden) {
  for (const clave of estado.claves) {
    try {
      return await descifrar(orden.privado, clave);
    } catch { /* con esta clave no abre: se prueba la siguiente */ }
  }
  return null;
}

function lineaCliente(d) {
  if (!estado.claves.length) return h("button", { class: "btn-ghost small", style: "margin-top:6px", onclick: pedirClave }, "🔑 Cargar clave para ver los datos");
  if (!d) return h("div", { class: "small", style: "margin-top:6px" }, "Cifrado con otra clave. ", h("button", { class: "btn-ghost small", onclick: pedirClave }, "Agregar clave"));
  return h("div", { class: "datos-cliente" },
    h("span", {}, `👤 ${[d.nombre, d.apellido].filter(Boolean).join(" ")}`),
    h("span", {}, `📞 ${d.telefono}`),
    d.referencia ? h("span", {}, `🧾 ${d.referencia}`) : null);
}

async function vistaPagos(rifas) {
  if (rifas.length === 0) return h("p", { class: "mut" }, "Aún no hay rifas.");
  elegirRifa(rifas);
  const rifa = await pedir(`/rifas/${estado.rifaActual}?cifrados=1`);
  const ordenes = Object.entries(rifa.ordenes).sort(([, a], [, b]) => b.registrado - a.registrado);
  const vendedores = [...new Set(ordenes.map(([, o]) => o.registradoPor))];
  const visibles = ordenes.filter(([, o]) => (estado.filtroEstado === "TODOS" || o.estado === estado.filtroEstado)
    && (estado.filtroVendedor === "TODOS" || o.registradoPor === estado.filtroVendedor));

  const opcion = (valor, txt, actual) => h("option", { value: valor, selected: valor === actual }, txt);
  const selector = (opciones, alCambiar) => h("select", { class: "inp", style: "width:auto", onchange: (e) => { alCambiar(e.target.value); pintar(); } }, opciones);
  const datos = await Promise.all(visibles.map(([, o]) => datosDe(o)));
  const recaudo = visibles.filter(([, o]) => o.estado === "PAGADO").reduce((t, [, o]) => t + o.numeros.length * rifa.precioCop, 0);

  return h("section", {},
    encabezadoPagina("Comprobantes", "Revisa, aprueba o anula los pagos registrados."),
    h("div", { class: "acciones", style: "margin-bottom:12px" },
      selector(rifas.map((r) => opcion(r.slug, r.titulo, estado.rifaActual)), (v) => { estado.rifaActual = v; }),
      selector(["TODOS", "PENDIENTE", "PAGADO", "ANULADO"].map((e) => opcion(e, e === "TODOS" ? "Todos los estados" : e, estado.filtroEstado)), (v) => { estado.filtroEstado = v; }),
      selector([opcion("TODOS", "Todos los vendedores", estado.filtroVendedor), ...vendedores.map((v) => opcion(v, nombreCartera(v), estado.filtroVendedor))], (v) => { estado.filtroVendedor = v; })),
    h("p", { class: "mut small" }, `${visibles.length} pago(s) · Pagado en esta vista: ${cop(recaudo)}`),
    visibles.length === 0 ? h("p", { class: "mut" }, "No hay pagos con este filtro.") : visibles.map(([id, o], i) => h("div", { class: "orden" },
      h("div", {}, h("b", {}, o.numeros.map((n) => pad(n, rifa.max)).join(", ")), ` · ${o.seudonimo}${o.ciudad ? ` · ${o.ciudad}` : ""} · ${o.metodo} · ${o.estado}`,
        lineaCliente(datos[i]),
        h("div", { class: "mut small" }, `Registró ${nombreCartera(o.registradoPor)} · ${fecha(new Date(o.registrado * 1000).toISOString())}`),
        o.aprobadoPor ? h("div", { class: "mut small" }, `Aprobó ${nombreCartera(o.aprobadoPor)}`) : null,
        o.motivoAnulacion ? h("div", { class: "mut small" }, `Anulado: ${o.motivoAnulacion}`) : null),
      h("div", { class: "acciones" },
        o.comprobanteHash ? h("button", { class: "btn-ghost small", onclick: () => modalComprobante(rifa.slug, id) }, "Comprobante")
          : o.estado !== "ANULADO" ? h("button", { class: "btn-ghost small", onclick: () => modalAdjuntar((c) => ejecutar("Adjuntando comprobante", "adjuntar_comprobante", { slug: rifa.slug, orden: id, comprobanteHash: c.hash }, c.base64)) }, "Adjuntar comprobante") : null,
        o.estado === "PENDIENTE" ? h("button", { class: "btn small", onclick: () => ejecutar("Aprobando pago", "aprobar_pago", { slug: rifa.slug, orden: id }) }, "Aprobar") : null,
        o.estado !== "ANULADO" ? h("button", { class: "btn-ghost small", onclick: async () => {
          const motivo = await confirmar("Anular pago", "Los números quedarán libres otra vez.", { conMotivo: true, boton: "Continuar" });
          ejecutar("Anulando pago", "anular_pago", { slug: rifa.slug, orden: id, motivo });
        } }, "Anular") : null))));
}

restaurar().then(pintar);
