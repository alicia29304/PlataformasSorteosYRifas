# Sorteos y Rifas Web3

Plataforma de rifas sin servidor propio ni base de datos. Proyecto independiente, derivado
de [PlataformasSorteosYRifas](https://github.com/jhonsu01/PlataformasSorteosYRifas).

**Web:** https://sorteos-web3.aliciagadiaz29304.workers.dev

> Estado: **en pruebas.** La rifa y las carteras actuales son de prueba. No es un sorteo real.

## Como funciona

```
Cartera autorizada -> firma (sin gas) -> Cloudflare Worker -> GitHub Actions
  -> verifica firma, rol, vigencia y que no se repita -> commit en data/
```

- **Datos:** `data/` en este repositorio. Todo cambio queda firmado en `data/auditoria/`.
- **Roles:** `data/roles.json`. El admin crea rifas y vendedores; el vendedor registra y
  aprueba pagos en sus rifas; el publico solo consulta.
- **Privacidad:** el repositorio es publico. Solo se publica nombre, inicial del apellido
  y ciudad. Telefono y referencia van cifrados y solo el admin puede leerlos.
- **Ticket:** se consulta con cualquiera de los numeros comprados y se comparte por enlace,
  WhatsApp o imagen. Solo muestra lo que ya es publico.

## Estructura

| Ruta | Que es |
| --- | --- |
| `services/verificador` | Reglas y verificacion de firmas (se ejecuta en GitHub Actions) |
| `services/relay` | Cloudflare Worker: guarda el token y sirve la lectura publica |
| `apps/web3` | Web publica estatica |
| `apps/admin-windows` | App de escritorio del admin (pendiente de adaptar) |
| `execution` | Despliegue y pruebas de punta a punta |

## Comandos

```bash
cd services/verificador && npm ci && npm test
cd apps/web3 && npm ci && npm test
node execution/desplegar.mjs
```

La copia en IPFS se publica en Pinata, pero su gateway `*.mypinata.cloud` no sirve HTML a
navegadores sin dominio propio; por eso la web se sirve desde Cloudflare.

Licencia MIT.
