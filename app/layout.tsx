import type { Metadata } from "next";
import "./globals.css";
import { getCurrentStaff } from "@/lib/staff-server";
import ErrorPopupHost from "@/components/ui/error-popup";

export const metadata: Metadata = {
  title: "LENDI Engineering",
  description: "Your Trusted Partner in Technical Solutions.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "LENDI Engineering", statusBarStyle: "default" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Mounted once for the whole site (staff app and the public token pages
  // alike -- work/[token], eval, share/queue, login, ...) so every
  // notifyError(...) call anywhere shows the same popup. getCurrentStaff()
  // is React-cache()'d, so on staff routes that already call it (see
  // app/(admin)/layout.tsx) this is free -- on public pages with no staff
  // session it just resolves to null, i.e. isAdmin=false, same as an
  // anonymous/technician-PIN visitor should see.
  const staff = await getCurrentStaff();
  return (
    <html lang="th">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <ErrorPopupHost isAdmin={staff?.role === "admin"} />
      </body>
    </html>
  );
}
