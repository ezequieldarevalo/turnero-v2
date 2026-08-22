import type { NextConfig } from "next";

const config: NextConfig = {
  // Sin `output: "standalone"`: el servicio arranca con `next start`, que usa el
  // empaquetado normal. Tenerlo puesto hacía compilar las dos salidas y dejaba
  // un aviso en cada deploy avisando que el comando de arranque no correspondía.
  // El empaquetado liviano ahorraría algo de memoria, pero no hace falta: medido
  // sobre los datos reales de las tres plantas, el servidor se estabiliza en
  // 186 MB de los 512 del plan.
  agentRules: false,

  // En desarrollo la app se sirve a través de un túnel (ngrok) para que
  // MercadoPago pueda alcanzar el webhook. Next bloquea por defecto los
  // recursos de desarrollo pedidos desde un origen distinto al host, y eso
  // rompe el hot-reload y la hidratación del cliente.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app", "*.trycloudflare.com"],
};

export default config;
