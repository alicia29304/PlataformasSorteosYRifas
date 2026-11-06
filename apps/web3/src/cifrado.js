// Cifra lo privado del comprador (telefono, referencia de pago) con la clave publica del
// admin. El repositorio es publico: solo quien tenga la clave privada puede leerlo.
//
// Web Crypto: ECDH P-256 con clave efimera + AES-GCM. Sin librerias.
// Formato: enc1:base64( clavePublicaEfimera(65) | iv(12) | cifrado )

const CURVA = { name: "ECDH", namedCurve: "P-256" };
const aBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deBase64 = (txt) => Uint8Array.from(atob(txt), (c) => c.charCodeAt(0));
const claveAes = (privada, publica, usos) => crypto.subtle.deriveKey(
  { name: "ECDH", public: publica }, privada, { name: "AES-GCM", length: 256 }, false, usos
);

export async function cifrar(datos, publicaBase64) {
  const publica = await crypto.subtle.importKey("raw", deBase64(publicaBase64), CURVA, false, []);
  const efimera = await crypto.subtle.generateKey(CURVA, true, ["deriveKey"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clave = await claveAes(efimera.privateKey, publica, ["encrypt"]);
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, clave, new TextEncoder().encode(JSON.stringify(datos)));
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", efimera.publicKey));
  const todo = new Uint8Array(pub.length + iv.length + cifrado.byteLength);
  todo.set(pub, 0);
  todo.set(iv, pub.length);
  todo.set(new Uint8Array(cifrado), pub.length + iv.length);
  return `enc1:${aBase64(todo)}`;
}

/** Solo lo usa el admin, con su clave privada (JWK). */
export async function descifrar(texto, privadaJwk) {
  const todo = deBase64(texto.replace(/^enc1:/, ""));
  const privada = await crypto.subtle.importKey("jwk", privadaJwk, CURVA, false, ["deriveKey"]);
  const publica = await crypto.subtle.importKey("raw", todo.slice(0, 65), CURVA, false, []);
  const clave = await claveAes(privada, publica, ["decrypt"]);
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: todo.slice(65, 77) }, clave, todo.slice(77));
  return JSON.parse(new TextDecoder().decode(claro));
}
