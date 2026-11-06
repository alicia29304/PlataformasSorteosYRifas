// Enlace con carteras desde un navegador normal. Pesa mucho: se carga solo al conectar.

import { EthereumProvider } from "@walletconnect/ethereum-provider";
import QRCode from "qrcode";

export const imagenQr = (uri) => QRCode.toDataURL(uri, { margin: 2, width: 280 });

/** Firmar con personal_sign no usa ninguna red ni gasta gas: la cadena es un requisito del protocolo. */
export async function conectarWalletConnect(alRecibirUri) {
  if (!__WC_PROJECT_ID__) throw new Error("WalletConnect no esta configurado");
  const proveedor = await EthereumProvider.init({
    projectId: __WC_PROJECT_ID__,
    showQrModal: false,
    optionalChains: [1],
    optionalMethods: ["personal_sign"],
    optionalEvents: ["accountsChanged", "disconnect"],
    metadata: {
      name: "Sorteos y Rifas",
      description: "Registro de pagos firmado con cartera",
      url: location.origin,
      icons: [],
    },
  });
  proveedor.on("display_uri", alRecibirUri);
  if (!proveedor.session) await proveedor.connect();
  return proveedor;
}
