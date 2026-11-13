// Builds the payload a host loads by URL or by path, and the npm package's contents: dist/index.js
// (the library), dist/serve.js (the Node end of a patched game's channel), dist/panel.js (a plain
// DOM renderer for mods' panels), dist/cli.js and the contract's modules (contract, resources,
// game-code, channel, ui, runtime/index), each with its .d.ts, and the two backends beside them,
// each with its licence and notice --
//
//   dist/gm8/  gm8-lib's gm8patch, from the checkout this package's Cargo.lock pins
//   dist/gms/  gms-lib's AOT .NET runtime, copied from the gms-lib submodule's own build
//
// esbuild rather than tsc: a host fetches these files at runtime and has nothing to resolve
// imports with, so the mod-protocol lowering they use is bundled in.
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const pkgRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const dist = path.join(pkgRoot, "dist");
// Wiped first: the .NET runtime's filenames are content-hashed, so copying over an old dist leaves
// a mixture of two builds that fails deep inside the runtime.
await rm(dist, { recursive: true, force: true });

const metadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
    cwd: pkgRoot,
  }).toString(),
);
const gm8patch = metadata.packages.find((p: { name: string }) => p.name === "gm8patch");
if (!gm8patch) throw new Error("build: gm8patch is not in this package's Cargo.lock");
// The checkout's root, so its own rust-toolchain.toml and Cargo.lock apply.
const checkout = path.resolve(path.dirname(gm8patch.manifest_path), "..");
// One target dir per checkout: cargo fingerprints a crate built from a path by its old dep-info,
// which a new checkout's files never touch, so a shared dir keeps serving the previous rev's build.
const targetDir = path.join(pkgRoot, "target", "gm8-lib", path.basename(checkout));
execFileSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "gm8patch",
    "--target-dir",
    targetDir,
  ],
  { cwd: checkout, stdio: "inherit" },
);
execFileSync(
  "wasm-bindgen",
  [
    "--target",
    "web",
    "--no-typescript",
    "--out-dir",
    path.join(dist, "gm8"),
    path.join(targetDir, "wasm32-unknown-unknown/release/gm8patch.wasm"),
  ],
  { stdio: "inherit" },
);

const gmsLib = path.join(pkgRoot, "gms-lib/dist");
await mkdir(path.join(dist, "gms"), { recursive: true });
await cp(gmsLib, path.join(dist, "gms"), { recursive: true });
for (const notice of ["LICENSE", "NOTICE"]) {
  await cp(path.join(checkout, notice), path.join(dist, "gm8", notice));
  await cp(path.join(pkgRoot, "gms-lib", notice), path.join(dist, "gms", notice));
}

// package.json's exports, plus the CLI.
const entries = [
  "index",
  "serve",
  "panel",
  "cli",
  "contract",
  "resources",
  "game-code",
  "channel",
  "ui",
  "runtime/index",
];
await build({
  entryPoints: entries.map((entry) => path.join(pkgRoot, `src/${entry}.ts`)),
  outdir: dist,
  bundle: true,
  // Split so the CLI imports index.js rather than carrying a second copy of the library.
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["node:*"],
});
await writeFile(path.join(dist, "package.json"), '{"type":"module"}\n');
execFileSync("tsc", ["-p", "tsconfig.build.json"], { cwd: pkgRoot, stdio: "inherit" });
console.log(`build: dist/{${entries}}.{js,d.ts}, dist/gm8/, dist/gms/`);
