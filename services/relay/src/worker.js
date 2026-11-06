// Intermediario entre las carteras y GitHub. Guarda el token y sirve la lectura publica.
//
// No decide nada de negocio: eso lo hace el verificador en GitHub Actions, que vuelve
// a comprobar todo. Aqui solo se filtra lo que no tiene firma de una cartera con rol,
// para que un script no pueda gastar los minutos de Actions con peticiones basura.

import { recuperarFirmante } from "../../verificador/src/mensaje.js";

const MAX_CUERPO = 32 * 1024;
const MAX_COMPROBANTE = 500 * 1024; // bytes de la imagen; el cliente la reduce antes de enviar
const SHA256 = /^[0-9a-f]{64}$/;
const CON_COMPROBANTE = ["registrar_pago", "adjuntar_comprobante"];
const VENTANA_S = 600;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIRECCION = /^0x[0-9a-f]{40}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (valor, status = 200, extra = {}) => new Response(JSON.stringify(valor), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...CORS, ...extra },
});

/** Lee un archivo de data/ por la API (sin la cache de 5 min de raw.githubusercontent). */
async function leerDato(env, ruta, ctx, ttl = 8) {
  const clave = new Request(`https://cache.interna/${ruta}`);
  const guardado = await caches.default.match(clave);
  if (guardado) return guardado.text();
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${ruta}?ref=main`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github.raw+json",
      "User-Agent": "sorteos-web3-relay", "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const texto = await r.text();
  ctx.waitUntil(caches.default.put(clave, new Response(texto, { headers: { "Cache-Control": `max-age=${ttl}` } })));
  return texto;
}

async function recibirAccion(request, env, ctx) {
  const cuerpo = await request.text();
  if (cuerpo.length > MAX_CUERPO + MAX_COMPROBANTE * 1.4) return json({ error: "Peticion demasiado grande" }, 413);
  let s;
  try { s = JSON.parse(cuerpo); } catch { return json({ error: "JSON invalido" }, 400); }

  const { accion, firmante, fecha, nonce, datos, firma, comprobante } = s ?? {};
  if (cuerpo.length - (typeof comprobante === "string" ? comprobante.length : 0) > MAX_CUERPO) return json({ error: "Peticion demasiado grande" }, 413);
  if (typeof accion !== "string" || accion.length > 40 || typeof firmante !== "string" || !DIRECCION.test(firmante)
    || !Number.isInteger(fecha) || typeof nonce !== "string" || !NONCE.test(nonce) || typeof firma !== "string"
    || !datos || typeof datos !== "object") {
    return json({ error: "Accion mal formada" }, 400);
  }
  if (Math.abs(Date.now() / 1000 - fecha) > VENTANA_S) return json({ error: "Firma vencida; revisa la hora del equipo" }, 400);

  let recuperada;
  try { recuperada = recuperarFirmante(s); } catch { return json({ error: "Firma invalida" }, 400); }
  if (recuperada !== firmante) return json({ error: "Firma invalida" }, 403);

  const roles = JSON.parse(await leerDato(env, "roles.json", ctx, 15));
  if (!roles.admins.includes(firmante) && !Object.hasOwn(roles.vendedores, firmante)) {
    return json({ error: "Esta cartera no esta autorizada" }, 403);
  }

  // El hash de cada comprobante es publico en el repositorio: declararlo sin subir la imagen
  // permitiria apuntar una orden propia al comprobante de otra persona.
  if (comprobante !== undefined || datos.comprobanteHash !== undefined) {
    const fallo = await guardarComprobante(env, accion, datos, comprobante);
    if (fallo) return fallo;
  }

  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
      "User-Agent": "sorteos-web3-relay", "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ event_type: "accion-firmada", client_payload: { accion, firmante, fecha, nonce, datos, firma } }),
  });
  if (r.status !== 204) return json({ error: "GitHub no acepto la accion" }, 502);
  return json({ nonce }, 202);
}

// Cada rifa tiene su espacio: un hash copiado de otra rifa no encuentra nada aqui.
const claveComprobante = (slug, hash) => `comprobantes/${slug}/${hash}.jpg`;

/** La imagen solo se acepta si coincide con el hash que la cartera firmo. */
async function guardarComprobante(env, accion, datos, comprobante) {
  if (!env.COMPROBANTES) return json({ error: "Los comprobantes aun no estan activados" }, 503);
  if (!CON_COMPROBANTE.includes(accion) || typeof comprobante !== "string" || typeof datos.comprobanteHash !== "string" || !SHA256.test(datos.comprobanteHash)
    || typeof datos.slug !== "string" || !SLUG.test(datos.slug)) {
    return json({ error: "Comprobante invalido" }, 400);
  }
  let bytes;
  try { bytes = Uint8Array.from(atob(comprobante), (c) => c.charCodeAt(0)); } catch { return json({ error: "Comprobante invalido" }, 400); }
  if (bytes.length > MAX_COMPROBANTE) return json({ error: "El comprobante es demasiado pesado" }, 413);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ error: "El comprobante debe ser una imagen" }, 400);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== datos.comprobanteHash) return json({ error: "El comprobante no coincide con la firma" }, 400);
  await env.COMPROBANTES.put(claveComprobante(datos.slug, hash), bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return null;
}

/** Entrega un comprobante privado a una cartera con permiso sobre esa rifa. */
async function verComprobante(request, env, ctx) {
  if (!env.COMPROBANTES) return json({ error: "Los comprobantes aun no estan activados" }, 503);
  const cuerpo = await request.text();
  if (cuerpo.length > 4096) return json({ error: "Peticion demasiado grande" }, 413);
  let s;
  try { s = JSON.parse(cuerpo); } catch { return json({ error: "JSON invalido" }, 400); }
  const { accion, firmante, fecha, nonce, datos, firma, orden } = s ?? {};
  const slug = datos?.slug;
  if (accion !== "ver_comprobantes" || typeof firmante !== "string" || !DIRECCION.test(firmante) || !Number.isInteger(fecha)
    || typeof nonce !== "string" || !NONCE.test(nonce) || typeof firma !== "string"
    || typeof slug !== "string" || !SLUG.test(slug) || typeof orden !== "string" || !NONCE.test(orden)) {
    return json({ error: "Peticion mal formada" }, 400);
  }
  if (Math.abs(Date.now() / 1000 - fecha) > VENTANA_S) return json({ error: "Firma vencida" }, 403);
  let recuperada;
  try { recuperada = recuperarFirmante({ accion, firmante, fecha, nonce, datos, firma }); } catch { return json({ error: "Firma invalida" }, 400); }
  if (recuperada !== firmante) return json({ error: "Firma invalida" }, 403);

  const roles = JSON.parse(await leerDato(env, "roles.json", ctx, 15));
  const permitido = roles.admins.includes(firmante)
    || (Object.hasOwn(roles.vendedores, firmante) && roles.vendedores[firmante].rifas.includes(slug));
  if (!permitido) return json({ error: "Esta cartera no tiene acceso a esta rifa" }, 403);

  const texto = await leerDato(env, `rifas/${slug}.json`, ctx);
  const ordenes = texto ? JSON.parse(texto).ordenes : {};
  const hash = Object.hasOwn(ordenes, orden) ? ordenes[orden].comprobanteHash : null;
  if (!hash || !SHA256.test(hash)) return json({ error: "Esta orden no tiene comprobante" }, 404);
  const objeto = await env.COMPROBANTES.get(claveComprobante(slug, hash));
  if (!objeto) return json({ error: "Comprobante no encontrado" }, 404);
  return new Response(objeto.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...CORS },
  });
}

/** Resultado de una accion: se busca su nonce en la auditoria de este mes y del anterior. */
async function resultado(env, nonce, ctx) {
  const ahora = new Date();
  const meses = [ahora, new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1))]
    .map((d) => d.toISOString().slice(0, 7));
  for (const mes of meses) {
    const texto = await leerDato(env, `auditoria/${mes}.jsonl`, ctx, 3);
    if (!texto) continue;
    const linea = texto.split("\n").find((l) => l.includes(`"nonce":"${nonce}"`));
    if (linea) {
      const { resultado: res, motivo } = JSON.parse(linea);
      return json({ estado: res, motivo: motivo ?? null });
    }
  }
  return json({ estado: "EN_PROCESO" });
}

/** Vista publica de una rifa: los datos cifrados no hacen falta en la web. */
function vistaRifa(texto, conCifrados) {
  const rifa = JSON.parse(texto);
  if (conCifrados) return rifa;
  for (const o of Object.values(rifa.ordenes)) delete o.privado;
  return rifa;
}

async function api(request, env, ctx, partes, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "POST" && partes[0] === "accion" && partes.length === 1) return recibirAccion(request, env, ctx);
  if (request.method === "POST" && partes[0] === "comprobante" && partes.length === 1) return verComprobante(request, env, ctx);
  if (request.method !== "GET") return json({ error: "Metodo no permitido" }, 405);

  if (partes[0] === "rifas" && partes.length === 1) {
    return json(JSON.parse((await leerDato(env, "rifas/index.json", ctx)) ?? "[]"));
  }
  if (partes[0] === "rifas" && partes.length === 2 && SLUG.test(partes[1])) {
    const texto = await leerDato(env, `rifas/${partes[1]}.json`, ctx);
    // Los cifrados ya son publicos en el repositorio: pedirlos no da acceso a su contenido.
    return texto ? json(vistaRifa(texto, url.searchParams.get("cifrados") === "1")) : json({ error: "Rifa no encontrada" }, 404);
  }
  if (partes[0] === "roles" && partes.length === 1) return json(JSON.parse(await leerDato(env, "roles.json", ctx, 15)));
  if (partes[0] === "config" && partes.length === 1) {
    return json({ ...JSON.parse(await leerDato(env, "config.json", ctx, 60)), comprobantes: Boolean(env.COMPROBANTES) });
  }
  if (partes[0] === "resultado" && partes.length === 2 && NONCE.test(partes[1])) return resultado(env, partes[1], ctx);
  return json({ error: "No encontrado" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, ctx, url.pathname.split("/").filter(Boolean).slice(1), url);
    } catch (e) {
      console.error(e.message);
      return json({ error: "Error interno" }, 500);
    }
  },
};
