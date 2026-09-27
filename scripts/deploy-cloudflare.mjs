import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = path.join(repositoryRoot, "apps", "web", "wrangler.jsonc");
const originalConfig = await readFile(wranglerConfig, "utf8");

function run(command, args, cwd = repositoryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

try {
  await run("node", ["scripts/build-cloudflare-linux.mjs"]);
  await run("pnpm", ["--filter", "@vertex/web", "exec", "wrangler", "deploy", "--keep-vars"]);
} finally {
  const deployedConfig = await readFile(wranglerConfig, "utf8");
  if (deployedConfig !== originalConfig) {
    await writeFile(wranglerConfig, originalConfig, "utf8");
    console.warn("Restored wrangler.jsonc after deployment changed the local configuration.");
  }
}