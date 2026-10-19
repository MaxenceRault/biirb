// Worker de la carte (MapLibre) servi par le site lui-même (CSP 'self') : copié depuis node_modules avant dev et build,
// toujours à la version installée. Le worker importe maplibre-gl-shared.mjs par un chemin relatif : les deux sont copiés.
import { copyFileSync, mkdirSync } from "node:fs";

const source = "node_modules/maplibre-gl/dist";
const target = "public/maplibre";
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(target, { recursive: true });
files.forEach((file, index) => {
  copyFileSync(`${source}/${file}`, `${target}/${file}`);
  console.log(`[${index + 1}/${files.length}] ${target}/${file}`);
});
