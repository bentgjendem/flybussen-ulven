import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flybussen — Ulven Torg ↔ Oslo Lufthavn",
  description: "Avgangstavle for Flybussen mellom Ulven Torg og Oslo Lufthavn (Gardermoen)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
