import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MPD FloorNow",
    short_name: "FloorNow",
    description: "ระบบจัดการงานติดตั้งพื้นและแจ้งเตือนพนักงาน",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    lang: "th",
  };
}
