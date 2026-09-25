import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const pnpmCli = fileURLToPath(new URL("../node_modules/pnpm/bin/pnpm.cjs", import.meta.url));
if (!existsSync(pnpmCli)) {
  console.error("Local pnpm is unavailable. Run `corepack pnpm install` from the repository root.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [pnpmCli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
