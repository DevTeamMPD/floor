import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
  // route handler ใช้ path alias "@/..." เหมือนที่ Next ตั้งไว้ใน tsconfig
  // ถ้าไม่ประกาศตรงนี้ เทสของ route จะ import ไม่ติด
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
