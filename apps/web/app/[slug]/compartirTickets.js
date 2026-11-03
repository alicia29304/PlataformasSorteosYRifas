// Tickets de "Mis números" como IMAGEN (PNG) para enviarlos por WhatsApp o
// imprimirlos / guardarlos en PDF.
//
// Se dibuja a mano en un <canvas> (sin librerías de captura de HTML): el
// resultado es igual en todos los navegadores y no depende de fuentes web ni
// de CSS que html2canvas no sabe copiar (degradados, pseudo-elementos).

const ANCHO = 1080;
const PAD = 48;
const ALTO_TICKET = 250;
const SEP = 28;
const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** Parte un texto en lineas que caben en `maxAncho` (maximo `maxLineas`). */
function lineas(ctx, texto, maxAncho, maxLineas) {
  const palabras = String(texto || "").split(/\s+/).filter(Boolean);
  const out = [];
  let actual = "";
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (ctx.measureText(prueba).width <= maxAncho) { actual = prueba; continue; }
    if (actual) out.push(actual);
    actual = p;
    if (out.length === maxLineas) break;
  }
  if (actual && out.length < maxLineas) out.push(actual);
  if (out.length === maxLineas && palabras.join(" ").length > out.join(" ").length) {
    out[maxLineas - 1] = out[maxLineas - 1].replace(/\s*\S*$/, "…");
  }
  return out;
}

function rectRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dibujarTicket(ctx, y, t, datos, fondo) {
  const x = PAD, w = ANCHO - PAD * 2, h = ALTO_TICKET;
  const anchoDer = 230;
  const corte = x + w - anchoDer;

  // Lamina dorada (apagada si aun no esta pagado).
  ctx.save();
  rectRedondo(ctx, x, y, w, h, 28);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  if (t.pagado) {
    g.addColorStop(0, "#fff2b8"); g.addColorStop(0.38, "#f5c518");
    g.addColorStop(0.7, "#d99a06"); g.addColorStop(1, "#fbe38a");
  } else {
    g.addColorStop(0, "#efe6c4"); g.addColorStop(0.38, "#d2bb6a");
    g.addColorStop(0.7, "#b39446"); g.addColorStop(1, "#e3d49f");
  }
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Brillo diagonal.
  const b = ctx.createLinearGradient(x, y, x + w, y + h * 0.6);
  b.addColorStop(0.3, "rgba(255,255,255,0)");
  b.addColorStop(0.45, "rgba(255,255,255,0.4)");
  b.addColorStop(0.6, "rgba(255,255,255,0)");
  ctx.fillStyle = b;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(corte, y, anchoDer, h);
  ctx.restore();

  // Corte punteado + muescas.
  ctx.save();
  ctx.strokeStyle = "rgba(43,29,0,0.35)";
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 10]);
  ctx.beginPath(); ctx.moveTo(corte, y + 20); ctx.lineTo(corte, y + h - 20); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = fondo;
  for (const cy of [y, y + h]) { ctx.beginPath(); ctx.arc(corte, cy, 18, 0, Math.PI * 2); ctx.fill(); }

  // Lado izquierdo: titulo, descripcion, fecha, estado.
  const tx = x + 34, maxW = corte - tx - 24;
  let ty = y + 56;
  ctx.fillStyle = "#2b1d00";
  ctx.font = `900 38px ${FUENTE}`;
  for (const l of lineas(ctx, (datos.titulo || "Sorteo").toUpperCase(), maxW, 1)) { ctx.fillText(l, tx, ty); ty += 44; }
  if (datos.descripcion) {
    ctx.font = `500 26px ${FUENTE}`;
    ctx.fillStyle = "rgba(43,29,0,0.8)";
    for (const l of lineas(ctx, datos.descripcion, maxW, 2)) { ctx.fillText(l, tx, ty); ty += 32; }
  }
  if (datos.fecha) {
    ctx.font = `700 26px ${FUENTE}`;
    ctx.fillStyle = "#2b1d00";
    ctx.fillText(`🗓️ ${datos.fecha}`, tx, ty + 6);
  }
  // Pastilla de estado, pegada abajo.
  ctx.font = `800 24px ${FUENTE}`;
  const pw = ctx.measureText(t.estado).width + 36, ph = 42, py = y + h - ph - 22;
  rectRedondo(ctx, tx, py, pw, ph, 21);
  ctx.fillStyle = t.pagado ? "#1f7a35" : "rgba(43,29,0,0.14)";
  ctx.fill();
  ctx.fillStyle = t.pagado ? "#fff" : "#2b1d00";
  ctx.fillText(t.estado, tx + 18, py + 30);

  // Lado derecho: el numero.
  const cx = corte + anchoDer / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(43,29,0,0.7)";
  ctx.font = `800 26px ${FUENTE}`;
  ctx.fillText("N.º", cx, y + h / 2 - 44);
  ctx.fillStyle = "#2b1d00";
  ctx.font = `900 ${t.num.length > 3 ? 70 : 88}px ${FUENTE}`;
  ctx.fillText(t.num, cx, y + h / 2 + 40);
  ctx.textAlign = "left";
}

/**
 * Dibuja los tickets y devuelve un Blob PNG.
 * datos = { titulo, descripcion, fecha, nombre, tickets: [{ num, estado, pagado }] }
 */
export async function ticketsAPng(datos) {
  const fondo = "#14161c";
  const algunoPagado = datos.tickets.some((t) => t.pagado);
  const altoCabecera = algunoPagado ? 190 : 110;
  const alto = PAD + altoCabecera + datos.tickets.length * (ALTO_TICKET + SEP) - SEP + PAD + 50;

  const cv = document.createElement("canvas");
  cv.width = ANCHO; cv.height = alto;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, alto);

  let y = PAD + 46;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 44px ${FUENTE}`;
  ctx.fillText("🎫 Mis números", PAD, y);
  y += 30;
  if (algunoPagado) {
    const caja = { x: PAD, y: y, w: ANCHO - PAD * 2, h: 92 };
    rectRedondo(ctx, caja.x, caja.y, caja.w, caja.h, 22);
    ctx.fillStyle = "rgba(52,208,88,0.16)"; ctx.fill();
    ctx.strokeStyle = "rgba(52,208,88,0.55)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#34d058";
    ctx.font = `800 34px ${FUENTE}`;
    const saludo = `🎉 ¡Gracias${datos.nombre ? ` ${datos.nombre}` : ""} por tu compra!`;
    ctx.fillText(lineas(ctx, saludo, caja.w - 48, 1)[0] || saludo, caja.x + 24, caja.y + 58);
    y += caja.h;
  }
  y += 30;

  for (const t of datos.tickets) {
    dibujarTicket(ctx, y, t, datos, fondo);
    y += ALTO_TICKET + SEP;
  }

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `500 22px ${FUENTE}`;
  ctx.textAlign = "center";
  ctx.fillText(typeof location !== "undefined" ? location.host + location.pathname : "", ANCHO / 2, alto - PAD + 6);

  return new Promise((ok, mal) => cv.toBlob((bl) => (bl ? ok(bl) : mal(new Error("No se pudo crear la imagen"))), "image/png"));
}

/**
 * Comparte la imagen con el menu del sistema (WhatsApp aparece ahi en el
 * celular). Si el navegador no puede compartir archivos, la descarga.
 * Devuelve "compartido" | "descargado" | "cancelado".
 */
export async function compartirImagen(blob, nombreArchivo, texto) {
  const archivo = new File([blob], nombreArchivo, { type: "image/png" });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: "Mis números", text: texto });
      return "compartido";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelado";
      // Otro fallo (permiso, gesto expirado): se cae a la descarga.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "descargado";
}

/**
 * Imprime la imagen (el dialogo del sistema permite "Guardar como PDF").
 * Usa un iframe oculto: no lo bloquea el bloqueador de ventanas emergentes.
 */
export async function imprimirImagen(blob) {
  const dataUrl = await new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.readAsDataURL(blob);
  });
  const fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(fr);
  const doc = fr.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><title>Mis números</title><style>
    @page { margin: 10mm; } html,body { margin:0; background:#fff; }
    img { width:100%; height:auto; display:block; }
  </style></head><body><img alt="Mis números"></body></html>`);
  doc.close();
  const img = doc.querySelector("img");
  img.onload = () => {
    fr.contentWindow.focus();
    fr.contentWindow.print();
    setTimeout(() => fr.remove(), 60000);
  };
  img.src = dataUrl;
}
