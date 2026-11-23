// Renders every diagram in src/ to a 3840x2160 PNG and an SVG, ready for slides.
//   node build.mjs [name ...]
// Needs Google Chrome (set CHROME to its path if it is not in the default macOS location)
// and pdftocairo from Poppler for the SVG step.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as icons from "simple-icons";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const TMP = path.join(HERE, ".build");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const require = createRequire(import.meta.url);
const bySlug = new Map(Object.values(icons).filter((icon) => icon?.slug).map((icon) => [icon.slug, icon]));

const fontFace = [400, 600, 800]
  .map((weight) => {
    const file = require.resolve("@fontsource/inter/files/inter-latin-" + weight + "-normal.woff");
    return '@font-face{font-family:Inter;font-weight:' + weight + ';src:url("' + pathToFileURL(file) + '") format("woff")}';
  })
  .join("");

// Marks that Simple Icons does not carry, taken from each project's own brand files.
// viewBox crops Privy's lockup to the symbol and wordmark.
const LOGOS = {
  privy: { file: "privy.svg", viewBox: "0 0 105 24", ratio: 105 / 24 },
  base: { file: "base.svg", viewBox: "0 0 1280 1280", ratio: 1 },
  ticketlock: { file: "ticketlock.svg", viewBox: "0 0 48 48", ratio: 1 },
};

function expand(html) {
  return html
    .replace(/\{\{icon:([a-z0-9]+):(\d+):(#[0-9a-fA-F]+)\}\}/g, (_, slug, size, fill) => {
      const icon = bySlug.get(slug);
      if (!icon) throw new Error("No Simple Icons entry for " + slug);
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + fill + '"><path d="' + icon.path + '"/></svg>';
    })
    .replace(/\{\{logo:([a-z]+):(\d+):(#[0-9a-fA-F]+)\}\}/g, (_, name, height, fill) => {
      const logo = LOGOS[name];
      const inner = fs.readFileSync(path.join(SRC, "logos", logo.file), "utf8").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
      const painted = name === "ticketlock" ? inner : inner.replace(/fill="(?!none)[^"]*"/g, "").replace(/style="[^"]*"/g, "");
      return '<svg height="' + height + '" width="' + Math.round(height * logo.ratio) + '" viewBox="' + logo.viewBox + '" fill="' + fill + '" style="flex:none;overflow:hidden">' + painted + "</svg>";
    })
    .replace(/\{\{shot:([a-z0-9-]+)\}\}/g, (_, name) => pathToFileURL(path.join(SRC, "shots", name + ".png")).href);
}

const wanted = process.argv.slice(2);
const names = fs.readdirSync(SRC).filter((file) => file.endsWith(".html")).map((file) => file.replace(/\.html$/, "")).filter((name) => !wanted.length || wanted.includes(name));
fs.mkdirSync(TMP, { recursive: true });
const style = fs.readFileSync(path.join(SRC, "style.css"), "utf8");
const chrome = (...args) => execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=" + path.join(TMP, "profile"), ...args], { stdio: "ignore" });

for (const name of names) {
  const page = path.join(TMP, name + ".html");
  fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><style>' + fontFace + style + "</style></head><body>" + expand(fs.readFileSync(path.join(SRC, name + ".html"), "utf8")) + "</body></html>");
  const url = pathToFileURL(page).href;
  chrome("--window-size=1920,1080", "--force-device-scale-factor=2", "--screenshot=" + path.join(HERE, name + ".png"), url);
  const pdf = path.join(TMP, name + ".pdf");
  chrome("--no-pdf-header-footer", "--print-to-pdf=" + pdf, url);
  execFileSync("pdftocairo", ["-svg", "-f", "1", "-l", "1", pdf, path.join(HERE, name + ".svg")]);
  console.log("built", name);
}
