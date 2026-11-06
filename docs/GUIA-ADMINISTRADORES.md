# Guía rápida de administradores

Todo se hace desde la app de escritorio. No hace falta GitHub ni comandos.

## Entrar

Abre la app, toca **Entrar con mi archivo de credenciales** y sube el archivo. No vuelve a
pedir nada hasta que toques **Cerrar sesión**.

## Agregar un vendedor

**Usuarios vendedores → Agregar vendedor → Generar una cartera nueva.** Escribe el nombre y
marca sus rifas. Se guarda en Descargas un archivo con su clave privada y las instrucciones
para entregárselo.

## Agregar un administrador

**Administradores → Agregar administrador**, dejando la dirección vacía. Se guarda en Descargas
un archivo `credenciales-admin-….json`: con él se entra a la app y su clave privada se puede
importar en Trust Wallet o MetaMask.

## Pasar de la cartera de prueba a la definitiva

1. Crea tu administrador nuevo como se indica arriba.
2. Toca **Cerrar sesión** y entra con el archivo nuevo.
3. En **Administradores**, quita la cartera anterior.

## Cuidados

- Quien tenga un archivo de credenciales o una clave privada puede administrar los sorteos y ver
  los datos de los compradores. Guárdalos en un lugar seguro y no los publiques.
- Si pierdes el computador o un archivo, entra con otro administrador y quita esa cartera.
- Protege la cuenta de GitHub `alicia29304` con verificación en dos pasos: controla el repositorio.
- Si no queda ningún administrador disponible, la lista se puede corregir en
  [data/roles.json](https://github.com/alicia29304/PlataformasSorteosYRifas/edit/main/data/roles.json),
  con la dirección en minúsculas.
