import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import nodeApiPlugin, { pythonApiPattern } from "./server/viteApi.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), [
    "FIREBASE_WEB_API_KEY", "VITE_FIREBASE_API_KEY", "GROQ_", "TRIAGE_SESSION_SECRET",
    "PYTHON_API_ORIGIN", "FIREBASE_AUTH_EMULATOR_HOST",
  ]);
  for (const [name, value] of Object.entries(env)) {
    if (value && !process.env[name]) process.env[name] = value;
  }

  const proxy = {
    [pythonApiPattern.source]: {
      target: process.env.PYTHON_API_ORIGIN || "http://127.0.0.1:8000",
      changeOrigin: true,
      configure: proxyServer => {
        proxyServer.on("error", (_error, _request, response) => {
          if (response && !response.headersSent && typeof response.writeHead === "function") {
            response.writeHead(503, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ detail: "The medical API is temporarily unavailable." }));
          }
        });
      },
    },
  };

  return {
    plugins: [react(), nodeApiPlugin()],
    server: { proxy },
    preview: { proxy },
    build: { outDir: "dist", sourcemap: false },
  };
});
