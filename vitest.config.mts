import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    // `server-only` throws outside a React Server build; tests run server modules directly.
    "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "unit", // npm test
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.db.test.ts", "node_modules/**"],
          environment: "node",
        },
      },
      {
        resolve,
        test: {
          // npm run test:db. Needs the local database: npm run db:start, then npm run db:reset.
          name: "db",
          include: ["src/**/*.db.test.ts"],
          environment: "node",
          setupFiles: ["./src/test/db-env.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
