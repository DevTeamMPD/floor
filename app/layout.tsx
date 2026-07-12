import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MPD Workspace — เอกสาร & งานบริการ",
  description: "ระบบติดตามงานติดตั้งและประเมินผล",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
