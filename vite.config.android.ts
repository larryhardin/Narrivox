import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Static shell for the Android WebView. The live preview and Vercel deploy
 * keep using vite.config.ts (SSR + Nitro). This config only emits a client
 * bundle Capacitor can ship inside the APK.
 */
export default defineConfig({
  base: "/",
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          enabled: true,
          outputPath: "dist-android",
          crawlLinks: false,
        },
      },
    }),
    viteReact(),
  ],
});
