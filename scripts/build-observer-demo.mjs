import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
// The review artifact intentionally has no Supabase configuration or credentials.
const destination = resolve(process.argv[2] ?? "work/msd-observer-demo.html");
const bundle = await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  outfile: "observer-demo.js",
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".png": "dataurl",
    ".svg": "dataurl",
  },
});
const js = bundle.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replaceAll("</script", "<\\/script");
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
await mkdir(dirname(destination), { recursive: true });
await writeFile(
  destination,
  `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="Interactive MSD Observer design preview. Simulated data only; cloud access disabled."><title>MSD Observer · Simulated design preview</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
);
console.log(`Built standalone simulated preview: ${destination}`);
