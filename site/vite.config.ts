import { siteShell } from "@mark1russell7/site-pages/vite";
import { defineConfig } from "vite";

// The site has one page: the live lab. The deploy adds `status/` and `releases/`.
export default defineConfig({
  plugins: [siteShell({ themeKey: "otel-ts-theme" })],
  // The page and the package must use one copy of the API, so that they share the active span.
  resolve: { dedupe: ["@opentelemetry/api", "@opentelemetry/api-logs"] },
});
