# Guía: asignar administradores

Un administrador puede crear rifas, gestionar vendedores y anular pagos. Por seguridad **no
se asigna desde la app**: se cambia directamente en GitHub con la cuenta `alicia29304`. Así,
si alguien roba la cartera de un administrador, no puede crearse otros.

Los **vendedores** sí se agregan desde la app, en la pestaña *Vendedores*.

## Asignar un administrador

**1. Consigue la dirección pública de su cartera.**

- **MetaMask:** abre la app y toca el nombre de la cuenta para copiar la dirección.
- **Trust Wallet:** toca *Recibir*, elige *Ethereum* y copia la dirección.

Debe empezar por `0x` y tener 42 caracteres. Es pública: se puede enviar por chat.
**Nunca pidas ni compartas la frase de recuperación ni la clave privada.**

**2. Pásala a minúsculas.** El sistema solo reconoce direcciones en minúsculas. Por ejemplo,
`0xAbC123…` se escribe `0xabc123…`.

**3. Abre el archivo de roles.** Con la sesión de `alicia29304` iniciada, entra a
[data/roles.json](https://github.com/alicia29304/PlataformasSorteosYRifas/edit/main/data/roles.json).

**4. Agrega la dirección a la lista `admins`.** Cada dirección va entre comillas y separada
por una coma; la última no lleva coma:

```json
{
  "admins": [
    "0xdireccion_del_primer_admin",
    "0xdireccion_del_nuevo_admin"
  ],
  "vendedores": { }
}
```

No cambies la parte de `vendedores`: déjala como esté en el archivo.

**5. Guarda.** Pulsa *Commit changes* y confirma. GitHub marca el error si falta una coma o
una comilla en el archivo; revísalo antes de guardar.

**6. Comprueba.** Espera un minuto, abre la app de administración y conecta esa cartera.
Si dice *Esta cartera no es administradora*, revisa que la dirección esté bien copiada y en
minúsculas.

## Darle acceso a los datos privados

Teléfono y referencia de pago van cifrados. Para que el nuevo administrador pueda leerlos con
**Ver datos**, entrégale una copia del archivo de la clave privada por un medio seguro, nunca
por el repositorio ni por un chat público. Si no lo recibe, puede hacer todo lo demás.

## Quitar un administrador

Repite los pasos 3 a 5 borrando su línea de `admins`, sin dejar una coma sobrante. Debe quedar
al menos un administrador.

Si esa persona tenía el archivo de la clave privada, crea una nueva (ver abajo).

## Pasar de pruebas a producción

Hazlo en este orden cuando todo esté probado:

1. Asigna tu cartera real como administradora siguiendo esta guía y comprueba que entra.
2. Borra de `admins` la cartera de prueba `0x1cc5ac7eff0165f86ef359f49d1e1e7ffed10280`.
3. En la app, pestaña *Vendedores*, quita al vendedor de prueba y agrega a los reales.
4. Crea una clave de cifrado nueva, guardando la privada fuera del proyecto:

   ```bash
   node execution/nueva_clave_cifrado.mjs "C:\ruta\privada\clave-admin.json"
   ```

   Sube a GitHub el `data/config.json` que genera. Haz copia de esa clave: **si se pierde,
   nadie podrá volver a leer esos datos.**
5. Crea para el Worker un token de GitHub solo con permiso *Contents* y cámbialo con
   `npx wrangler secret put GITHUB_TOKEN` en `services/relay`.

## Si una cartera de administrador se ve comprometida

1. Con la sesión de `alicia29304`, bórrala de inmediato de `data/roles.json`. Queda sin acceso
   en cuanto se guarda el cambio (como máximo, unos segundos después).
2. Revisa en [data/auditoria](https://github.com/alicia29304/PlataformasSorteosYRifas/tree/main/data/auditoria)
   qué firmó esa cartera.
3. Protege la cuenta `alicia29304` con verificación en dos pasos: quien la controle controla
   la lista de administradores.
