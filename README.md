# Sorteos y Rifas Web3

Plataforma de rifas sin servidor propio ni base de datos. Los datos viven en este repositorio,
cada cambio lo firma una cartera autorizada (MetaMask, Trust Wallet) y GitHub Actions lo
verifica antes de guardarlo. Proyecto independiente, derivado de
[PlataformasSorteosYRifas](https://github.com/jhonsu01/PlataformasSorteosYRifas).

**Web:** https://sorteos-web3.aliciagadiaz29304.workers.dev

| Quién | Qué usa | Qué puede hacer |
| --- | --- | --- |
| Administrador | App de escritorio (Windows) | Rifas, vendedores, administradores, pagos, comprobantes, ganadores |
| Vendedor | Web, dentro de su cartera | Registrar y aprobar pagos de sus rifas, buscar clientes, anular sus pendientes |
| Comprador | Enlace del ticket | Ver sus números y compartir el ticket |

Para instalarlo en otra cuenta, sigue [docs/GUIA-DESPLIEGUE.md](docs/GUIA-DESPLIEGUE.md).
Para el día a día del administrador, [docs/GUIA-ADMINISTRADORES.md](docs/GUIA-ADMINISTRADORES.md).

## Cómo funciona

Los diagramas se pueden acercar, alejar y mover con los botones que GitHub muestra sobre cada uno.

### Arquitectura

```mermaid
flowchart LR
  subgraph Clientes
    V["📱 Vendedor<br/>web en su cartera"]
    A["🖥️ Administrador<br/>app de escritorio"]
    C["🎫 Comprador<br/>enlace del ticket"]
  end
  subgraph Cloudflare
    W["Worker<br/>web + intermediario"]
    R2[("R2<br/>comprobantes privados")]
  end
  subgraph GitHub
    GA["GitHub Actions<br/>verificador"]
    D[("data/<br/>rifas · roles · auditoría")]
  end
  P[("Pinata / IPFS<br/>copia de la web")]

  V -- "acción firmada" --> W
  A -- "acción firmada" --> W
  C -- "lectura" --> W
  W -- "repository_dispatch" --> GA
  GA -- "verifica y hace commit" --> D
  W -- "lee" --> D
  W <-- "guarda / entrega" --> R2
  W -. "cada despliegue" .-> P
```

- **Worker:** sirve la web y guarda el token de GitHub. Solo deja pasar acciones firmadas por
  carteras con rol, para que nadie gaste los minutos de Actions con basura.
- **Verificador:** vuelve a comprobar todo: firma, rol, vigencia, que no se repita y las reglas
  del negocio. Es el único que escribe en `data/`.
- **R2:** comprobantes de pago. Solo los ve una cartera autorizada para esa rifa.

### Un cambio firmado, de principio a fin

```mermaid
sequenceDiagram
  autonumber
  actor Vendedor
  participant Web as Web (navegador)
  participant Cartera as Cartera
  participant Worker
  participant Actions as GitHub Actions
  participant Repo as data/ en GitHub

  Vendedor->>Web: Registrar pago (números, datos, comprobante)
  Web->>Web: Cifra teléfono y referencia con la clave pública
  Web->>Cartera: Pide firma (sin gas)
  Cartera-->>Web: Firma
  Web->>Worker: Acción + firma (+ imagen)
  Worker->>Worker: ¿Firma válida? ¿Cartera con rol?
  Worker->>Worker: Guarda la imagen en R2 si coincide con lo firmado
  Worker->>Actions: repository_dispatch
  Actions->>Actions: Verifica firma, rol, nonce y reglas
  alt Aceptada
    Actions->>Repo: Commit con el cambio y su auditoría
  else Rechazada por una regla
    Actions->>Repo: Solo la auditoría, sin los datos
  end
  Web->>Worker: ¿Resultado? (cada 4 s)
  Worker-->>Web: ACEPTADA o RECHAZADA y motivo
```

Tarda entre 15 y 30 segundos. Si dos vendedores registran el mismo número a la vez, el segundo
se rechaza.

### Ciclo de una rifa

```mermaid
stateDiagram-v2
  [*] --> Activa: Admin crea la rifa
  Activa --> Activa: Vendedor registra y aprueba pagos
  Activa --> Cerrada: Cierre de ventas
  Cerrada --> Activa: Reabrir (si no hay ganador)
  Cerrada --> ConGanador: Declarar ganador
  ConGanador --> Cerrada: Anular ganador (queda a la vista)
  Cerrada --> Archivada: Archivar
  ConGanador --> Archivada: Archivar
  Archivada --> Cerrada: Restaurar
```

### Un pago

```mermaid
stateDiagram-v2
  [*] --> Pendiente: Vendedor registra
  Pendiente --> Pagado: Vendedor o admin aprueba
  Pendiente --> Anulado: Su vendedor o el admin anula
  Pagado --> Anulado: Solo el admin
  Anulado --> [*]: Los números quedan libres
```

### Ganador

```mermaid
flowchart TD
  I["Rifa cerrada, sin pagos pendientes"] --> M{¿Cómo?}
  M -- "Sorteo externo" --> E["Admin escribe el número<br/>y de dónde sale (ej. Lotería de Boyacá)"]
  M -- "Entre los vendidos" --> S["El verificador toma azar público de drand<br/>después de la firma"]
  E --> G{¿Ese número se vendió?}
  S --> G2["Ganador entre los números pagados"]
  G -- "Sí" --> GA["Ganador con nombre y ciudad"]
  G -- "No" --> GN["Sin ganador"]
  G2 --> GA
  GA --> PUB["Publicado en la web, verificable por cualquiera"]
  GN --> PUB
```

### Sesión del administrador y clave para vendedores

```mermaid
sequenceDiagram
  actor Admin
  participant App as App de escritorio
  participant Win as Credenciales de Windows
  actor Vendedor
  participant Cel as Celular del vendedor

  Admin->>App: Entra con su archivo de credenciales
  App->>Win: Guarda sesión y clave de datos
  Note over App: No vuelve a pedir nada hasta Cerrar sesión
  Vendedor->>Cel: Toca "Activar teléfonos"
  Cel->>Cel: Crea un candado que no se puede copiar
  Cel->>App: Publica la parte pública (firmada)
  App->>App: Al abrirse, cierra la clave de datos con ese candado
  App-->>Cel: Entrega publicada en roles.json
  Cel->>Cel: La abre sola y busca por teléfono
```

## Privacidad

El repositorio es público y su historial no se borra.

- **Público:** números, nombre con la inicial del apellido ("Ana G."), ciudad, estado y auditoría firmada.
- **Cifrado:** teléfono, nombre completo y referencia de pago. Solo los lee quien tenga la clave de datos.
- **Privado en R2:** imágenes de los comprobantes.
- **Rechazos:** una acción rechazada no publica sus datos, solo su huella.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `services/verificador` | Reglas y verificación de firmas; se ejecuta en GitHub Actions |
| `services/relay` | Cloudflare Worker: web, intermediario y comprobantes |
| `apps/web3` | Web de vendedores y tickets |
| `apps/escritorio` | App del administrador (Tauri, instalador MSI); su interfaz también está en `/admin/` |
| `data` | Rifas, roles, auditoría: lo escribe solo el verificador |
| `execution` | Configurar, inicializar, desplegar y pruebas de punta a punta |
| `docs` | Guías de administración y de despliegue |

## Comandos

```bash
cd services/verificador && npm ci && npm test
```

```bash
cd apps/web3 && npm ci && npm test
```

```bash
node execution/desplegar.mjs
```

```bash
cd apps/escritorio && npx tauri build
```

Licencia MIT.
