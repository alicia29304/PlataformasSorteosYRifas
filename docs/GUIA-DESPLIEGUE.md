# Guía: instalar el sistema en otra cuenta

Paso a paso para tener tu propia copia, con tu cuenta de GitHub, tu cuenta de Cloudflare y tu
propia dirección web. La copia nueva empieza sin rifas, con su propio administrador y su propia
clave de datos: no comparte nada con la instalación original.

Tiempo estimado: 1 hora la primera vez.

## Qué necesitas

**Cuentas, todas gratuitas:**

| Servicio | Para qué | Dónde |
| --- | --- | --- |
| GitHub | Guardar el código y los datos | https://github.com |
| Cloudflare | Publicar la web y guardar comprobantes | https://dash.cloudflare.com |
| Reown (WalletConnect) | Conectar carteras por QR | https://dashboard.reown.com |
| Pinata *(opcional)* | Copia de la web en IPFS | https://app.pinata.cloud |

**Programas en tu computador (Windows):**

- [Node.js 22](https://nodejs.org) y [Git](https://git-scm.com).
- Solo para compilar la app de escritorio: [Rust](https://rustup.rs) y
  [Build Tools de Visual Studio](https://visualstudio.microsoft.com/es/visual-cpp-build-tools/)
  con la opción *Desarrollo para el escritorio con C++*.

En los comandos, cambia lo que está entre `< >` por tus datos.

---

## 1. Crear tu repositorio en GitHub

1. En GitHub, **New repository**. Ponle un nombre, por ejemplo `MisRifas`, y márcalo **Public**:
   el proyecto se basa en que cualquiera pueda verificar los datos.
2. No marques README ni licencia: debe quedar vacío.
3. Copia el código a tu repositorio:

```bash
git clone https://github.com/alicia29304/PlataformasSorteosYRifas.git MisRifas
```

```bash
cd MisRifas
```

```bash
git remote set-url origin https://github.com/<tu-usuario>/<tu-repositorio>.git
```

No uses el botón **Fork**: un fork queda ligado al original y sus Pull Requests apuntarían allá.

## 2. Permitir que GitHub Actions guarde los cambios

En tu repositorio: **Settings → Actions → General**.

1. **Actions permissions:** *Allow all actions and reusable workflows*.
2. **Workflow permissions:** *Read and write permissions*. Guarda.

## 3. Token de GitHub

1. **Settings** (de tu perfil) **→ Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → tu repositorio.
3. **Permissions → Repository permissions:**
   - **Contents:** *Read and write*.
   - **Workflows:** *Read and write* (solo para subir el código la primera vez).
4. Copia el token (empieza por `github_pat_`). Solo se muestra una vez.

> Cuando ya esté desplegado puedes crear otro token solo con *Contents* para el Worker y guardar
> este para subir código.

## 4. Cloudflare

1. Crea la cuenta e inicia sesión.
2. **Workers & Pages:** a la derecha verás tu **Account ID** y tu **subdominio**, la parte antes
   de `.workers.dev`. Si te pide elegir un subdominio, elígelo.
3. **R2 Object Storage → Activar.** Cloudflare puede pedir un medio de pago aunque uses el plan
   gratuito; no cobra mientras no pases sus límites.
4. **My Profile → API Tokens → Create Token →** plantilla **Edit Cloudflare Workers**. Copia el token.

## 5. WalletConnect

1. En https://dashboard.reown.com crea un proyecto y copia su **Project ID**.
2. Cuando sepas tu dirección web (paso 9), agrégala en la lista de dominios del proyecto.

## 6. Archivo `.env`

En la carpeta del proyecto, copia `.env.example` como `.env` y complétalo:

```ini
GITHUB_OWNER=<tu-usuario>
GITHUB_REPO=<tu-repositorio>
GITHUB_TOKEN=<token del paso 3>
CLOUDFLARE_ACCOUNT_ID=<del paso 4>
CLOUDFLARE_API_TOKEN=<del paso 4>
CLOUDFLARE_SUBDOMINIO=<del paso 4, sin .workers.dev>
WORKER_NOMBRE=sorteos-web3
WALLETCONNECT_PROJECT_ID=<del paso 5>
PINATA_JWT=<opcional>
```

`WORKER_NOMBRE` es la primera parte de tu dirección web. Tu web quedará en
`https://<WORKER_NOMBRE>.<CLOUDFLARE_SUBDOMINIO>.workers.dev`.

**El `.env` nunca se sube a GitHub:** ya está excluido.

## 7. Instalar dependencias

```bash
cd services/verificador && npm ci && cd ../relay && npm ci && cd ../../apps/web3 && npm ci && cd ../..
```

## 8. Apuntar el proyecto a tus cuentas

```bash
node execution/configurar.mjs --revisar
```

Muestra qué va a cambiar: el repositorio que se firma en cada acción, el Worker, el
almacenamiento y la dirección web. Si está bien, aplícalo:

```bash
node execution/configurar.mjs
```

## 9. Empezar con los datos en cero

```bash
node execution/inicializar_datos.mjs --confirmar
```

Borra las rifas de la instalación original y crea:

- `credenciales/credenciales-admin.json`: tu acceso de administrador a la app de escritorio.
- `credenciales/clave-datos.json`: copia de respaldo de la clave de los datos privados.

**Guarda la carpeta `credenciales` en un lugar seguro** (por ejemplo, una USB) y no la compartas:
quien la tenga administra los sorteos. Si la pierdes, nadie podrá volver a leer los teléfonos.
Esa carpeta no se sube a GitHub.

## 10. Subir a tu repositorio

```bash
git add -A
```

```bash
git commit -m "Instalacion propia"
```

```bash
git push -u origin main
```

Si te pide usuario y contraseña, usa tu usuario de GitHub y el token del paso 3 como contraseña.

## 11. Publicar la web

```bash
node execution/desplegar.mjs --primera-vez
```

Crea el almacenamiento de comprobantes, publica la web y guarda el token de GitHub dentro del
Worker. Las siguientes veces basta con:

```bash
node execution/desplegar.mjs
```

Comprueba que todo responde:

```bash
node execution/verificar_credenciales.mjs
```

Abre `https://<WORKER_NOMBRE>.<CLOUDFLARE_SUBDOMINIO>.workers.dev`: debe decir "Aún no hay
sorteos". Agrega esa dirección en WalletConnect (paso 5).

## 12. App de escritorio

```bash
cd apps/escritorio && npm ci && npx tauri build
```

El instalador queda en `apps/escritorio/src-tauri/target/release/bundle/msi/`. Instálalo, toca
**Entrar con mi archivo de credenciales** y elige `credenciales-admin.json`.

Desde ahí: **Rifas → Nueva rifa** y **Usuarios vendedores → Agregar vendedor**.

## 13. Probar de punta a punta

1. Crea una rifa de prueba en la app.
2. Agrega un vendedor con **Generar una cartera nueva** e importa su clave privada en Trust Wallet.
3. Abre tu web dentro de Trust Wallet, conecta la cartera y registra un pago.
4. En unos 20 segundos debe aparecer en la web y en la app.
5. Archiva la rifa de prueba cuando termines.

---

## Problemas comunes

| Síntoma | Causa probable |
| --- | --- |
| "Esta cartera no está autorizada" | La cartera no está en `data/roles.json`: agrégala desde la app |
| El pago se queda en "Registrando…" | Actions sin permisos de escritura (paso 2) o desactivado en el repositorio |
| `GitHub no acepto la accion` | Token sin *Contents: Read and write* o vencido; repite el paso 3 y `desplegar --secreto` |
| "Los comprobantes aún no están activados" | R2 no estaba activo al desplegar: actívalo y repite `--primera-vez` |
| El QR no conecta | Falta el Project ID o tu dominio en WalletConnect (paso 5) |
| La firma no coincide en todas las acciones | Cambiaste de repositorio sin ejecutar `configurar.mjs` |
| Error al compilar la app | Faltan Rust o las Build Tools de Visual Studio |

## Si cambias de dirección o de cuenta más adelante

Actualiza el `.env`, ejecuta `node execution/configurar.mjs`, sube el cambio y vuelve a desplegar.
Recompila la app de escritorio, porque tiene la dirección de la web incluida.

Si cambias el nombre del repositorio, las firmas hechas para el nombre anterior dejan de valer.
Las acciones ya guardadas no se ven afectadas.
