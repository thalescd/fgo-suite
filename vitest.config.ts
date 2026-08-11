import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Config separada do vite.config.ts de propósito.
 *
 * O vite.config.ts usa `root: "src/ui"` porque o app mora lá — mas o vitest
 * herdaria esse root e só enxergaria os testes de UI, deixando os de `core/`
 * silenciosamente de fora. Aqui o root é o repositório.
 *
 * Os testes leem `public/data/`, então os caminhos são relativos à raiz.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    root: ".",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
