import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  // public/ fica na raiz do repo: é onde `data:build` grava os artefatos.
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
