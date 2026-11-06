// Firma una accion con una cartera de PRUEBA del .env y la envia a GitHub Actions.
// Uso: node execution/enviar_accion.mjs <ADMIN|VENDEDOR|COMPRADOR> <accion> '<datos JSON>'
// Sustituye al Worker de Cloudflare mientras este no exista.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../services/verificador/package.json", import.meta.url));
const { Wallet } = require("ethers");
const { mensajeAFirmar } = await import("../services/verificador/src/mensaje.js");

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);

export async function enviar(rol, accion, datos, extra = {}) {
  const cartera = new Wallet(env[`TEST_${rol}_PRIVATE_KEY`]);
  const base = {
    accion, firmante: cartera.address.toLowerCase(),
    fecha: Math.floor(Date.now() / 1000), nonce: randomUUID(), datos, ...extra,
  };
  const sobre = { ...base, firma: await cartera.signMessage(mensajeAFirmar(base)) };
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN_ALICIA}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ event_type: "accion-firmada", client_payload: sobre }),
  });
  if (r.status !== 204) throw new Error(`GitHub respondio ${r.status}: ${await r.text()}`);
  return sobre;
}

if (process.argv[1]?.endsWith("enviar_accion.mjs")) {
  const [rol, accion, datos] = process.argv.slice(2);
  const sobre = await enviar(rol, accion, JSON.parse(datos));
  console.log("Enviada. Nonce:", sobre.nonce);
}
