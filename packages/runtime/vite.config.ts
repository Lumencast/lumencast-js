import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    dts({
      entryRoot: "src",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/dev-entry.tsx"],
      outDir: "dist",
      rollupTypes: true,
      tsconfigPath: "./tsconfig.json",
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Lumencast",
      formats: ["es"],
      fileName: () => "lumencast.js",
      cssFileName: "lumencast",
    },
    rollupOptions: {
      external: [
        /^react($|\/)/,
        /^react-dom($|\/)/,
        /^@preact\/signals(-react)?($|\/)/,
        /^framer-motion($|\/)/,
        /^motion($|\/)/,
        /^motion-dom($|\/)/,
        /^motion-utils($|\/)/,
        /^@lumencast\/protocol($|\/)/,
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
    sourcemap: true,
    target: "es2022",
    emptyOutDir: true,
  },
});
