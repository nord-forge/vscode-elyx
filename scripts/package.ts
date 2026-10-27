import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = await Bun.file(resolve(root, "package.json")).json();
const vsce = resolve(root, "node_modules", "@vscode", "vsce", "vsce");

if (!existsSync(vsce)) {
  console.error("Local @vscode/vsce is missing. Run bun install first.");
  process.exit(1);
}

// The extension details page only loads https images, so the screenshots in
// images/ are served from the main branch on GitHub. Push screenshot changes
// before publishing.
const imageBase = "https://raw.githubusercontent.com/nord-forge/vscode-elyx/main/images";
const readme = readFileSync(resolve(root, "README.md"), "utf8").replace(
  /src="images\/([\w-]+\.png)"/g,
  (_, name) => `src="${imageBase}/${name}"`,
);
// vsce resolves --readme-path against the project root.
const staging = resolve(root, ".package");
const readmePath = ".package/README.md";
mkdirSync(staging, { recursive: true });
writeFileSync(resolve(root, readmePath), readme);

const output = `${manifest.name}-${manifest.version}.vsix`;
const result = Bun.spawnSync(
  ["node", vsce, "package", "--no-dependencies", "--no-rewrite-relative-links", "--readme-path", readmePath, "--out", output],
  { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
rmSync(staging, { recursive: true, force: true });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.exitCode);
