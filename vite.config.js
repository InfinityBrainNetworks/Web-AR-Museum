import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS is required by mobile browsers to grant camera access to anything
// that isn't localhost, so the dev server serves itself over a self-signed
// cert. That lets you open the dev URL on a phone over your LAN and test
// the camera/AR flow before deploying anywhere.
export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
});
