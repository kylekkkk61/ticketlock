// Turns captured takes (out/login, out/demo) into 1920x1080 MP4 files with captions.
//   node render.mjs            renders every take found, then joins them into one file
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const require = createRequire(import.meta.url);

const INK = "#0e1512", ACCENT = "#20e3a2", STAGE = "#eaefec", BODY = "#4d5a55", WHITE = "#ffffff";
const W = 1920, H = 1080, FPS = 30;
const DESK = { x: 64, y: 156, w: 1152, h: 720, bar: 38 }; // organiser page, captured at 1280x800
const PHONE = { x: 1372, y: 104, w: 393, h: 800 }; // phone page, shown 1:1

const CAPTIONS = {
  login: [
    { from: "signin", title: "Sign in with email", text: "No wallet app and no seed phrase. A one-time code arrives by email." },
    { from: "code", title: "The account gets its own wallet", text: "It is created automatically and stays inside TicketLock. The wait for the email is cut here." },
  ],
  demo: [
    { from: "buy", step: "1", title: "Buy", text: "Alice pays at a simulated £25 checkout. A real ticket is minted to her account on Base Sepolia." },
    { from: "transfer", step: "2", title: "Transfer", text: "Alice sends the ticket to Bob's email and confirms in the app. The platform pays the network fee." },
    { from: "received", step: "2", title: "The ticket is now in Bob's account", text: "Ownership is read from the contract, so the ticket simply appears for its new holder." },
    { from: "proof", step: "2", title: "Every step is a real transaction", text: "Each entry shows who authorised it, the relayer that paid for it, and its transaction hash." },
    { from: "enter", step: "3", title: "Enter", text: "Bob scans the door code and confirms. Nothing is used until staff accept the request." },
    { from: "admit", step: "3", title: "Staff match the code and admit", text: "Bob's and the organiser's signatures reach the contract in one transaction." },
    { from: "used", step: "3", title: "Used, once", text: "The ticket stays with Bob and is marked used at the time the network recorded." },
    { from: "again", step: "3", title: "A second attempt is refused", text: "The contract will not admit or move a ticket that has been used." },
  ],
};

// ── text as outlines, so no font needs to be installed ──────────────────────────────────────
const fonts = {};
function font(weight) {
  if (!fonts[weight]) {
    const buffer = fs.readFileSync(require.resolve("@fontsource/inter/files/inter-latin-" + weight + "-normal.woff"));
    fonts[weight] = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  }
  return fonts[weight];
}
function outline(value, { weight = 600, size, x, y, tracking = 0, fill = INK, anchor = "start" }) {
  const f = font(weight);
  const scale = size / f.unitsPerEm;
  const glyphs = [...value].map((char) => f.charToGlyph(char));
  const advance = (g, i) => {
    let kern = 0;
    try { if (glyphs[i + 1]) kern = f.getKerningValue(g, glyphs[i + 1]); } catch { kern = 0; }
    return (g.advanceWidth + kern) * scale + tracking * size;
  };
  const width = glyphs.reduce((sum, g, i) => sum + advance(g, i), 0) - tracking * size;
  let cursor = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  let d = "";
  glyphs.forEach((g, i) => { d += g.getPath(cursor, y, size).toPathData(2); cursor += advance(g, i); });
  return { svg: '<path fill="' + fill + '" d="' + d + '"/>', width };
}
function wrap(value, options, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of value.split(" ")) {
    const next = line ? line + " " + word : word;
    if (line && outline(next, options).width > maxWidth) (lines.push(line), (line = word));
    else line = next;
  }
  return [...lines, line];
}
const png = (body, file) => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' + body + "</svg>")).png().toFile(file);
const rounded = (x, y, w, h, r) => "M" + (x + r) + " " + y + "h" + (w - 2 * r) + "a" + r + " " + r + " 0 0 1 " + r + " " + r + "v" + (h - 2 * r) + "a" + r + " " + r + " 0 0 1 -" + r + " " + r + "h-" + (w - 2 * r) + "a" + r + " " + r + " 0 0 1 -" + r + " -" + r + "v-" + (h - 2 * r) + "a" + r + " " + r + " 0 0 1 " + r + " -" + r + "z";
const MARK = '<rect width="48" height="48" rx="11" fill="' + ACCENT + '"/><path fill="' + INK + '" d="M12 14h24a3 3 0 0 1 3 3v3.5a3.5 3.5 0 0 0 0 7V31a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3v-3.5a3.5 3.5 0 0 0 0-7V17a3 3 0 0 1 3-3z"/><g fill="' + ACCENT + '"><circle cx="24" cy="22.2" r="3.3"/><path d="M22.3 24h3.4l1.1 6h-5.6z"/></g>';

/** Everything drawn above the captured pages: device frames, titles and the fixed notes. */
async function buildOverlay(file) {
  const p = PHONE, d = DESK, bezel = 13;
  const deskOuter = rounded(d.x - 2, d.y - d.bar, d.w + 4, d.h + d.bar + 2, 14);
  const phoneOuter = rounded(p.x - bezel, p.y - bezel, p.w + 2 * bezel, p.h + 2 * bezel, 50);
  const body =
    // hide the square corners of the captures behind stage colour
    '<path fill="' + STAGE + '" fill-rule="evenodd" d="M' + (d.x - 12) + " " + (d.y - d.bar - 10) + "h" + (d.w + 24) + "v" + (d.h + d.bar + 22) + "h-" + (d.w + 24) + "z" + deskOuter + '"/>' +
    '<path fill="' + STAGE + '" fill-rule="evenodd" d="M' + (p.x - 24) + " " + (p.y - 24) + "h" + (p.w + 48) + "v" + (p.h + 48) + "h-" + (p.w + 48) + "z" + phoneOuter + '"/>' +
    // laptop window frame and phone bezel, each with a hole for the page
    '<path fill="' + INK + '" fill-rule="evenodd" d="' + deskOuter + rounded(d.x, d.y, d.w, d.h, 6) + '"/>' +
    '<path fill="' + INK + '" fill-rule="evenodd" d="' + phoneOuter + rounded(p.x, p.y, p.w, p.h, 38) + '"/>' +
    '<circle cx="' + (d.x + 20) + '" cy="' + (d.y - d.bar / 2) + '" r="5.5" fill="#3a4741"/><circle cx="' + (d.x + 40) + '" cy="' + (d.y - d.bar / 2) + '" r="5.5" fill="#3a4741"/>' +
    outline("Organiser's laptop", { weight: 600, size: 16, x: d.x + d.w / 2, y: d.y - d.bar / 2 + 5.5, fill: "#b9c6c0", anchor: "middle" }).svg +
    '<g transform="translate(64 44)">' + MARK + "</g>" +
    outline("TicketLock", { weight: 800, size: 30, x: 126, y: 79, tracking: -0.025 }).svg +
    outline("LIVE APP ON BASE SEPOLIA TESTNET", { weight: 600, size: 15, x: d.x + d.w, y: 74, tracking: 0.08, fill: BODY, anchor: "end" }).svg +
    outline("Screen recording of the live app. Every transaction shown is real.", { weight: 600, size: 15, x: p.x + p.w / 2, y: 1014, fill: BODY, anchor: "middle" }).svg +
    outline("The phone view and its camera image are simulated.", { weight: 600, size: 15, x: p.x + p.w / 2, y: 1036, fill: BODY, anchor: "middle" }).svg;
  await png(body, file);
}

async function buildPhoneLabel(label, file) {
  const text = outline(label + "'s phone", { weight: 700, size: 18, x: PHONE.x + PHONE.w / 2, y: 962, fill: INK, anchor: "middle" });
  const w = text.width + 40;
  await png('<rect x="' + (PHONE.x + PHONE.w / 2 - w / 2) + '" y="938" width="' + w + '" height="36" rx="18" fill="' + WHITE + '"/>' + text.svg, file);
}

async function buildCaption(caption, file) {
  let x = DESK.x;
  let body = "";
  if (caption.step) {
    body += '<circle cx="' + (x + 22) + '" cy="938" r="22" fill="' + INK + '"/>' + outline(caption.step, { weight: 800, size: 22, x: x + 22, y: 946, fill: WHITE, anchor: "middle" }).svg;
    x += 62;
  }
  body += outline(caption.title, { weight: 800, size: 38, x, y: 951, tracking: -0.02 }).svg;
  const style = { weight: 400, size: 23, fill: BODY };
  wrap(caption.text, { ...style, x: 0, y: 0 }, DESK.w - 20).forEach((line, i) => {
    body += outline(line, { ...style, x: DESK.x, y: 1000 + i * 32 }).svg;
  });
  await png(body, file);
}

// ── timeline ────────────────────────────────────────────────────────────────────────────────
function timeMapper(take) {
  const cuts = [...take.cuts].sort((a, b) => a.from - b.from);
  return (t) => {
    let shift = 0;
    for (const cut of cuts) {
      if (t >= cut.to) shift += cut.to - cut.from;
      else if (t > cut.from) return { t: cut.from - take.t0 - shift, cut: true };
    }
    return { t: t - take.t0 - shift, cut: false };
  };
}

/** One constant-rate clip per captured page, aligned to the take's clock. */
function buildTrack(dir, name, frames, map, duration) {
  const kept = [];
  for (const frame of frames) {
    const at = Math.max(0, map(frame.t).t);
    if (at > duration) break;
    // Several frames landing on one instant (before the start, or inside a cut) collapse to the last.
    if (kept.length && at - kept[kept.length - 1].at < 1e-4) kept[kept.length - 1] = { at, file: frame.file };
    else kept.push({ at, file: frame.file });
  }
  if (!kept.length) throw new Error("No frames for " + name);
  kept[0].at = 0;
  // Resample to a fixed rate here: each output frame is the latest capture at that instant.
  // (ffmpeg's concat durations stretch runs of very short frames and the clip drifts late.)
  const chunks = [];
  let index = 0;
  let current = null;
  for (let n = 0; n < Math.ceil(duration * FPS); n++) {
    while (index + 1 < kept.length && kept[index + 1].at <= n / FPS) index++;
    if (!current || current.index !== index) current = { index, bytes: fs.readFileSync(path.join(dir, name, kept[index].file)) };
    chunks.push(current.bytes);
  }
  const clip = path.join(dir, name + ".mp4");
  // H.264 needs even dimensions; the phone capture is 393 wide, and the bezel hides the padding.
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "fast", "-crf", "10", "-pix_fmt", "yuv420p", clip], { input: Buffer.concat(chunks) });
  if (result.status !== 0) throw new Error("ffmpeg failed for " + name + ": " + result.stderr.toString().slice(0, 400));
  return clip;
}

async function renderTake(name) {
  const dir = path.join(OUT, name);
  const take = JSON.parse(fs.readFileSync(path.join(dir, "take.json"), "utf8"));
  const map = timeMapper(take);
  const duration = map(take.tEnd).t;
  const at = (markName) => map(take.marks.find((m) => m.name === markName).t).t;
  const art = path.join(dir, "art");
  fs.mkdirSync(art, { recursive: true });

  const inputs = [];
  const add = (...args) => (inputs.push(args), inputs.length - 1);
  const image = (file) => add("-loop", "1", "-framerate", String(FPS), "-i", file);
  const steps = [];
  let last = "[bg]";
  const overlay = (index, x, y, window) => {
    const out = "[v" + steps.length + "]";
    steps.push(last + "[" + index + ":v]overlay=" + x + ":" + y + (window ? ":enable='between(t," + window[0].toFixed(3) + "," + window[1].toFixed(3) + ")'" : "") + out);
    last = out;
  };

  add("-f", "lavfi", "-i", "color=c=" + STAGE.replace("#", "0x") + ":s=" + W + "x" + H + ":r=" + FPS);
  steps.push("[0:v]format=yuv420p[bg]");
  const organiser = add("-i", buildTrack(dir, "organiser", take.tracks.organiser, map, duration));
  steps.push("[" + organiser + ":v]scale=" + DESK.w + ":" + DESK.h + ":flags=lanczos[desk]");
  steps.push(last + "[desk]overlay=" + DESK.x + ":" + DESK.y + "[d0]");
  last = "[d0]";

  const phones = take.phone.map((entry, i) => ({ ...entry, start: i === 0 ? 0 : map(entry.from).t, end: i + 1 < take.phone.length ? map(take.phone[i + 1].from).t : duration }));
  for (const entry of phones) {
    const clip = add("-i", buildTrack(dir, entry.track, take.tracks[entry.track], map, duration));
    overlay(clip, PHONE.x, PHONE.y, [entry.start, entry.end]);
  }
  await buildOverlay(path.join(art, "overlay.png"));
  overlay(image(path.join(art, "overlay.png")), 0, 0);
  for (const entry of phones) {
    const file = path.join(art, "label-" + entry.track + ".png");
    await buildPhoneLabel(entry.label, file);
    overlay(image(file), 0, 0, [entry.start, entry.end]);
  }
  const captions = CAPTIONS[name].map((caption, i, all) => ({ ...caption, start: i === 0 ? 0 : at(caption.from), end: i + 1 < all.length ? at(all[i + 1].from) : duration }));
  for (const [i, caption] of captions.entries()) {
    const file = path.join(art, "caption-" + i + ".png");
    await buildCaption(caption, file);
    overlay(image(file), 0, 0, [caption.start, caption.end]);
  }

  const file = path.join(OUT, "ticketlock-" + name + ".mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flat(), "-filter_complex", steps.join(";"), "-map", last, "-t", duration.toFixed(3),
    "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
  return { name, file, duration, captions, checkInTx: take.checkInTx ?? null };
}

const stamp = (seconds) => Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
const rendered = [];
for (const name of ["login", "demo"]) {
  if (fs.existsSync(path.join(OUT, name, "take.json"))) rendered.push(await renderTake(name));
}
if (!rendered.length) throw new Error("Nothing to render. Run record.mjs first.");

const notes = [];
let offset = 0;
for (const clip of rendered) {
  notes.push(path.basename(clip.file) + "  " + stamp(clip.duration) + "  (in the joined file: " + stamp(offset) + " to " + stamp(offset + clip.duration) + ")");
  for (const caption of clip.captions) notes.push("  " + stamp(offset + caption.start) + "  " + caption.title);
  if (clip.checkInTx) notes.push("  check-in transaction: " + clip.checkInTx);
  offset += clip.duration;
}
if (rendered.length > 1) {
  const list = path.join(OUT, "join.ffconcat");
  fs.writeFileSync(list, "ffconcat version 1.0\n" + rendered.map((clip) => "file '" + path.basename(clip.file) + "'").join("\n") + "\n");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", path.join(OUT, "ticketlock-full.mp4")]);
  notes.unshift("ticketlock-full.mp4  " + stamp(offset) + "  (login clip followed by the demo)", "");
}
fs.writeFileSync(path.join(OUT, "segments.txt"), notes.join("\n") + "\n");
console.log(notes.join("\n"));
