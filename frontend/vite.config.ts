import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "frontend",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        trafficAlert: resolve(__dirname, "traffic-alert.html"),
        liveRoadAlert: resolve(__dirname, "live-road-alert.html")
      }
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4176"
    }
  }
});
