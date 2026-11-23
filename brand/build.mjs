// Builds the TicketLock brand assets into brand/ and web/public/brand/.
// Text is converted to outlines (Inter) so the SVGs render the same everywhere.
// Run from a directory where opentype.js, @fontsource/inter and sharp are installed:
//   node /path/to/brand/build.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const opentype = require("opentype.js");
const sharp = require("sharp");

const INK = "#0e1512";
const ACCENT = "#20e3a2";
const WHITE = "#ffffff";
const MUTED = "#8fa39a";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDirs = [here, path.join(here, "../web/public/brand")];
outDirs.forEach((dir) => mkdirSync(dir, { recursive: true }));

const fontFile = (weight) => require.resolve("@fontsource/inter/files/inter-latin-" + weight + "-normal.woff");
const load = (weight) => {
  const buffer = readFileSync(fontFile(weight));
  return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
};
const fonts = { 300: load(300), 600: load(600), 800: load(800) };

/** Outlined text. Returns path data and the advance width. */
function text(value, { weight = 800, size, x = 0, y = 0, tracking = 0 }) {
  const font = fonts[weight];
  const scale = size / font.unitsPerEm;
  // Glyphs are placed one by one: opentype.js cannot run Inter's contextual substitutions.
  const glyphs = [...value].map((char) => font.charToGlyph(char));
  let cursor = x;
  let d = "";
  glyphs.forEach((glyph, index) => {
    d += glyph.getPath(cursor, y, size).toPathData(2);
    let kerning = 0;
    try {
      if (glyphs[index + 1]) kerning = font.getKerningValue(glyph, glyphs[index + 1]);
    } catch {
      kerning = 0;
    }
    cursor += (glyph.advanceWidth + kerning) * scale + tracking * size;
  });
  return { d, width: cursor - x - tracking * size };
}

// The mark: a ticket with a keyhole, on a rounded accent tile. Drawn on a 48 unit grid.
const TICKET =
  "M12 14h24a3 3 0 0 1 3 3v3.5a3.5 3.5 0 0 0 0 7V31a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3v-3.5a3.5 3.5 0 0 0 0-7V17a3 3 0 0 1 3-3z";
const KEYHOLE = '<circle cx="24" cy="22.2" r="3.3"/><path d="M22.3 24h3.4l1.1 6h-5.6z"/>';
const mark = ({ tile = ACCENT, ticket = INK, key = ACCENT, radius = 11 } = {}) =>
  '<rect width="48" height="48" rx="' + radius + '" fill="' + tile + '"/>' +
  '<path fill="' + ticket + '" d="' + TICKET + '"/>' +
  '<g fill="' + key + '">' + KEYHOLE + "</g>";

const svg = (width, height, body, viewBox = "0 0 " + width + " " + height) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="' + viewBox +
  '" role="img" aria-label="TicketLock">' + body + "</svg>\n";

const files = {};

files["ticketlock-mark.svg"] = svg(48, 48, mark());
files["ticketlock-mark-ink.svg"] = svg(48, 48, mark({ tile: INK, ticket: ACCENT, key: INK }));

function wordmark(textColor) {
  const word = text("TicketLock", { size: 30, x: 62, y: 35, tracking: -0.025 });
  const width = Math.ceil(62 + word.width);
  return svg(width, 48, mark() + '<path fill="' + textColor + '" d="' + word.d + '"/>');
}
files["ticketlock-wordmark.svg"] = wordmark(INK);
files["ticketlock-wordmark-light.svg"] = wordmark(WHITE);

// App icon: full-bleed ink square with the accent tile, safe for platform masks.
files["ticketlock-icon.svg"] = svg(
  512,
  512,
  '<rect width="512" height="512" fill="' + INK + '"/><g transform="translate(96 96) scale(6.6667)">' + mark() + "</g>",
);

// Social preview card.
{
  const title = text("TICKETLOCK", { size: 132, x: 80, y: 372, tracking: -0.03 });
  const line = text("Tickets you own, transfer and use once.", { weight: 300, size: 44, x: 80, y: 452 });
  const tag = text("PRESENTATION DEMO · BASE SEPOLIA", { weight: 600, size: 22, x: 80, y: 548, tracking: 0.08 });
  files["ticketlock-og.svg"] = svg(
    1200,
    630,
    '<rect width="1200" height="630" fill="' + INK + '"/>' +
      '<g transform="translate(80 80) scale(2.3333)">' + mark() + "</g>" +
      '<path fill="' + WHITE + '" d="' + title.d + '"/>' +
      '<path fill="' + WHITE + '" fill-opacity="0.82" d="' + line.d + '"/>' +
      '<path fill="' + ACCENT + '" d="' + tag.d + '"/>' +
      '<circle cx="1200" cy="315" r="46" fill="' + WHITE + '" fill-opacity="0.06"/>' +
      '<path stroke="' + MUTED + '" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="8 10" d="M1040 60v510"/>',
  );
}

const pngs = [
  ["ticketlock-icon.svg", "ticketlock-icon-512.png", 512],
  ["ticketlock-icon.svg", "ticketlock-icon-192.png", 192],
  ["ticketlock-icon.svg", "ticketlock-icon-180.png", 180],
  ["ticketlock-mark.svg", "ticketlock-mark-512.png", 512],
  ["ticketlock-wordmark.svg", "ticketlock-wordmark.png", 1200],
  ["ticketlock-wordmark-light.svg", "ticketlock-wordmark-light.png", 1200],
  ["ticketlock-og.svg", "ticketlock-og.png", 1200],
];

for (const dir of outDirs) {
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  for (const [source, target, width] of pngs) {
    await sharp(Buffer.from(files[source]), { density: 600 }).resize({ width }).png().toFile(path.join(dir, target));
  }
}
console.log("Wrote", Object.keys(files).length, "SVG and", pngs.length, "PNG assets to", outDirs.join(" and "));
