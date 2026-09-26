import { spawn } from "node:child_process";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const authEnvironment = path.join(repositoryRoot, "apps", "web", ".env.local");
const artifactDirectory = await mkdtemp(
  path.join(tmpdir(), "vertex-opennext-"),
);
const generatedDirectory = path.join(
  repositoryRoot,
  "apps",
  "web",
  ".open-next",
);

await access(authEnvironment);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

try {
  await run("docker", [
    "build",
    "--file",
    "Dockerfile.cloudflare-build",
    "--secret",
    `id=web_env,src=${authEnvironment}`,
    "--target",
    "artifact",
    "--output",
    `type=local,dest=${artifactDirectory}`,
    ".",
  ]);
  await rm(generatedDirectory, { recursive: true, force: true });
  await cp(artifactDirectory, generatedDirectory, { recursive: true });
  console.log("Linux OpenNext artifact is ready for Cloudflare deployment.");
} finally {
  await rm(artifactDirectory, { recursive: true, force: true });
}
