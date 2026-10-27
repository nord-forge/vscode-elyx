import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "artifacts", "verification");
mkdirSync(output, { recursive: true });

const checks = [
  ["tests", ["bun", "run", "test"]],
  ["diagnostics", ["bun", "run", "test:diagnostics"]],
  ["package", ["bunx", "@vscode/vsce", "package"]],
  ["token-dumps", ["bun", "run", "test:tokens"]],
] as const;

for (const [name, args] of checks) {
  console.log(`$ ${args.join(" ")}`);
  const result = Bun.spawnSync([...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const log = Buffer.concat([result.stdout, result.stderr]).toString();
  writeFileSync(resolve(output, `${name}.log`), log);
  process.stdout.write(log);
  if (result.error || result.exitCode !== 0) {
    console.error(`Stopped at ${name}. See artifacts/verification/${name}.log.`);
    process.exit(result.exitCode || 1);
  }
}

console.log("All automated VS Code checks passed. Read the token dump for the visual scope review.");
