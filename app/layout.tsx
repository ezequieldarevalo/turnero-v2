import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reserva de turno",
  description: "Turnos para revisión técnica vehicular",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
