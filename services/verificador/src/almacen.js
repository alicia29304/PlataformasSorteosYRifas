// Lectura y escritura de data/. Solo se tocan estas rutas fijas.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const leer = (ruta, porDefecto) => (existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : porDefecto);
const escribir = (ruta, valor) => writeFileSync(ruta, `${JSON.stringify(valor, null, 2)}\n`);

export function cargar(dir) {
  const rifas = {};
  const carpeta = join(dir, "rifas");
  if (existsSync(carpeta)) {
    for (const f of readdirSync(carpeta)) {
      if (f.endsWith(".json") && f !== "index.json") rifas[f.slice(0, -5)] = leer(join(carpeta, f));
    }
  }
  return {
    roles: leer(join(dir, "roles.json"), { admins: [], vendedores: {} }),
    nonces: leer(join(dir, "nonces.json"), {}),
    sesionesRevocadas: leer(join(dir, "sesiones-revocadas.json"), {}),
    rifas,
  };
}

export function guardar(dir, estado, auditoria) {
  mkdirSync(join(dir, "rifas"), { recursive: true });
  mkdirSync(join(dir, "auditoria"), { recursive: true });
  escribir(join(dir, "roles.json"), estado.roles);
  escribir(join(dir, "nonces.json"), estado.nonces);
  escribir(join(dir, "sesiones-revocadas.json"), estado.sesionesRevocadas);
  for (const [slug, rifa] of Object.entries(estado.rifas)) escribir(join(dir, "rifas", `${slug}.json`), rifa);
  escribir(join(dir, "rifas", "index.json"), Object.values(estado.rifas).map(
    ({ slug, titulo, estado: est, precioCop, min, max, finVentas, fechaSorteo, ganador }) => ({ slug, titulo, estado: est, precioCop, min, max, finVentas, fechaSorteo, numeroGanador: ganador?.numero ?? null })
  ));
  const mes = new Date(auditoria.procesado * 1000).toISOString().slice(0, 7);
  appendFileSync(join(dir, "auditoria", `${mes}.jsonl`), `${JSON.stringify(auditoria)}\n`);
}
