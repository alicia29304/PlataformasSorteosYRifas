// Mide si Pinata sirve una pagina HTML por el gateway del proyecto.
// Sube una carpeta minima (1 pin) y prueba varias puertas de enlace.
// Uso: node execution/pinata_prueba_html.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])
);

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba SorteosWeb3</title></head>
<body><h1>Prueba SorteosWeb3</h1><script src="./app.js"></script></body></html>`;
const js = `document.body.insertAdjacentHTML("beforeend", "<p id='ok'>JS relativo OK</p>");`;

const form = new FormData();
form.append("file", new Blob([html], { type: "text/html" }), "prueba-web3/index.html");
form.append("file", new Blob([js], { type: "text/javascript" }), "prueba-web3/app.js");
form.append("pinataMetadata", JSON.stringify({ name: "prueba-html-sorteosweb3" }));
form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

const subida = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
  method: "POST", headers: { Authorization: `Bearer ${env.PINATA_JWT}` }, body: form,
});
const datos = await subida.json();
if (!subida.ok) { console.log("Subida fallo:", subida.status, JSON.stringify(datos)); process.exit(1); }
const cid = datos.IpfsHash;
console.log("Subida OK. CID:", cid, "bytes:", datos.PinSize);

const urls = [
  `https://${env.PINATA_GATEWAY}/ipfs/${cid}/`,
  `https://${env.PINATA_GATEWAY}/ipfs/${cid}/app.js`,
  `https://${cid}.ipfs.dweb.link/`,
  `https://${cid}.ipfs.w3s.link/`,
];
for (const url of urls) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: "follow" });
    const cuerpo = await r.text();
    console.log(`\n${url}\n  HTTP ${r.status} tipo=${r.headers.get("content-type")} es_la_pagina=${cuerpo.includes("Prueba SorteosWeb3") || cuerpo.includes("JS relativo OK")}`);
    if (!r.ok) console.log("  respuesta:", cuerpo.slice(0, 300).replace(/\s+/g, " "));
  } catch (e) {
    console.log(`\n${url}\n  ERROR ${e.name}: ${e.message}`);
  }
}
