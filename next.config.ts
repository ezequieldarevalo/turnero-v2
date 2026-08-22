import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  agentRules: false,

  // En desarrollo la app se sirve a través de un túnel (ngrok) para que
  // MercadoPago pueda alcanzar el webhook. Next bloquea por defecto los
  // recursos de desarrollo pedidos desde un origen distinto al host, y eso
  // rompe el hot-reload y la hidratación del cliente.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app", "*.trycloudflare.com"],
};

export default config;
