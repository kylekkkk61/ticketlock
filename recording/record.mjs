// Drives the live app in three browser profiles and captures every frame for the demo video.
//   node record.mjs setup   sign the three accounts in; Alice's sign-in is captured as a clip
//   node record.mjs take    run buy -> transfer -> enter -> admit and capture it
//   node record.mjs scanshot   retake the 4-scan still with the entry code in focus
// Sign-in codes are read from files so a person or another tool can supply them:
// the script writes need-<name>, waits for ready-<name>, then waits for code-<name>.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TICKETLOCK_URL ?? "https://ticketlock.kylewu.me";
const PROFILES = path.join(HERE, ".profiles");
const OUT = path.join(HERE, "out");
const OTP_DIR = process.env.TICKETLOCK_OTP_DIR ?? "/tmp/ticketlock-otp";
const CAMERA_FILE = path.join(OUT, "camera.y4m");
// The three demo accounts' emails live in the root .env, not in git.
const ENV_FILE = path.join(HERE, "..", ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const requireEnv = (name) => process.env[name] ?? (console.error("Set " + name + " in .env"), process.exit(1));
const EMAILS = {
  organiser: requireEnv("TICKETLOCK_ORGANISER"),
  alice: requireEnv("TICKETLOCK_ALICE"),
  bob: requireEnv("TICKETLOCK_BOB"),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now() / 1000;

/** With TICKETLOCK_SHOTS=1, saves still images of key screens for the documentation diagrams. */
const SHOTS = process.env.TICKETLOCK_SHOTS ? path.join(OUT, "shots") : null;
async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), ...options });
}

// Shows where each click or tap lands. Injected into the recording browsers only.
const TAP_MARKER = () => {
  addEventListener(
    "pointerdown",
    (event) => {
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;left:" + (event.clientX - 22) + "px;top:" + (event.clientY - 22) + "px;width:44px;height:44px;" +
        "border-radius:50%;background:rgba(32,227,162,.5);border:2px solid rgba(14,21,18,.55);z-index:2147483647;" +
        "pointer-events:none;transition:transform .5s ease-out,opacity .5s ease-out";
      document.documentElement.appendChild(dot);
      requestAnimationFrame(() => {
        dot.style.transform = "scale(1.7)";
        dot.style.opacity = "0";
      });
      setTimeout(() => dot.remove(), 550);
    },
    true,
  );
};

async function open(name, kind, extraArgs = []) {
  const shape =
    kind === "phone"
      ? { viewport: { width: 393, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 };
  const context = await chromium.launchPersistentContext(path.join(PROFILES, name), {
    channel: "chrome",
    headless: true,
    args: ["--use-fake-ui-for-media-stream", ...extraArgs],
    permissions: ["camera"],
    locale: "en-GB",
    timezoneId: "Europe/London",
    ...shape,
  });
  await context.addInitScript(TAP_MARKER);
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(60_000);
  return { name, context, page };
}

/** Saves every screencast frame with its wall-clock time, so separate browsers stay in sync. */
async function capture(actor, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await actor.context.newCDPSession(actor.page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = String(frames.length).padStart(6, "0") + ".jpg";
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    // Acknowledging a little late caps the rate at about 30 frames a second.
    setTimeout(() => cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {}), 28);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").catch(() => {}) };
}

async function signedIn(page) {
  await page.goto(BASE + "/");
  const out = page.getByRole("button", { name: "Sign out" });
  const into = page.getByRole("button", { name: /^Sign in/ }).first();
  await out.or(into).first().waitFor();
  return out.isVisible();
}

async function waitForFile(file, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await sleep(500);
  }
  throw new Error("Timed out waiting for " + file);
}

/** Email sign-in. Returns the times the wait for the email started and ended. */
async function signIn(actor, { paced = false } = {}) {
  const { page, name } = actor;
  const pause = (ms) => (paced ? sleep(ms) : Promise.resolve());
  fs.mkdirSync(OTP_DIR, { recursive: true });
  for (const prefix of ["need-", "ready-", "code-"]) fs.rmSync(path.join(OTP_DIR, prefix + name), { force: true });
  fs.writeFileSync(path.join(OTP_DIR, "need-" + name), EMAILS[name]);
  await waitForFile(path.join(OTP_DIR, "ready-" + name), 120);

  await pause(1500);
  await page.getByRole("button", { name: /^Sign in/ }).first().click();
  const email = page.locator("#privy-dialog input").first();
  await email.waitFor();
  await pause(900);
  await email.pressSequentially(EMAILS[name], { delay: paced ? 38 : 0 });
  await pause(600);
  await email.press("Enter");
  await page.getByText("Enter confirmation code").waitFor();
  const waitFrom = now();
  const code = await waitForFile(path.join(OTP_DIR, "code-" + name), 240);
  const waitTo = now();
  await pause(900);
  await page.locator("#privy-dialog input").first().click();
  for (const digit of code) {
    await page.keyboard.type(digit);
    await pause(170);
  }
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 90_000 });
  return { waitFrom, waitTo };
}

function saveTake(dir, take) {
  fs.writeFileSync(path.join(dir, "take.json"), JSON.stringify(take, null, 1));
  console.log("Saved", path.relative(HERE, dir), "(" + Object.entries(take.tracks).map(([k, v]) => k + " " + v.length + " frames").join(", ") + ")");
}

async function setup() {
  const organiser = await open("organiser", "desktop");
  const bob = await open("bob", "phone");
  const alice = await open("alice", "phone");
  try {
    for (const actor of [organiser, bob]) {
      if (await signedIn(actor.page)) console.log(actor.name, "already signed in");
      else (await signIn(actor), console.log(actor.name, "signed in"));
    }
    if (await signedIn(alice.page)) {
      // The clip needs to start signed out.
      await alice.page.getByRole("button", { name: "Sign out" }).click();
      await alice.page.getByRole("button", { name: /^Sign in/ }).first().waitFor();
    }
    await organiser.page.goto(BASE + "/organiser");
    await organiser.page.getByText("Waiting at the door").waitFor();
    await alice.page.goto(BASE + "/");
    await alice.page.getByRole("button", { name: "Sign in to buy" }).waitFor();

    const dir = path.join(OUT, "login");
    fs.rmSync(dir, { recursive: true, force: true });
    const tracks = { organiser: await capture(organiser, path.join(dir, "organiser")), alice: await capture(alice, path.join(dir, "alice")) };
    const t0 = now();
    const marks = [{ name: "signin", t: t0 }];
    const wait = await signIn(alice, { paced: true });
    marks.push({ name: "code", t: wait.waitTo });
    await alice.page.getByRole("button", { name: /Simulate payment/ }).waitFor();
    marks.push({ name: "ready", t: now() });
    await sleep(2600);
    const tEnd = now();
    for (const track of Object.values(tracks)) await track.stop();
    // Keep a beat of the code screen, then cut the wait for the email.
    const cuts = wait.waitTo - wait.waitFrom > 2.4 ? [{ from: wait.waitFrom + 1.6, to: wait.waitTo - 0.4 }] : [];
    saveTake(dir, { t0, tEnd, marks, cuts, phone: [{ from: t0, track: "alice", label: "Alice" }], tracks: { organiser: tracks.organiser.frames, alice: tracks.alice.frames } });
  } finally {
    for (const actor of [organiser, bob, alice]) await actor.context.close();
  }
}

/** A short camera clip: out of focus on the organiser's screen, then closing in on the entry code. */
async function buildCameraClip(organiserPage) {
  const shot = await organiserPage.screenshot({ fullPage: true });
  const qr = await organiserPage.locator('img[alt="Entry QR code for this event"]').boundingBox();
  const scale = 1.5; // the organiser page's device scale factor
  const meta = await sharp(shot).metadata();
  const W = 640, H = 480, FPS = 15, SECONDS = 6;
  const centre = { x: (qr.x + qr.width / 2) * scale, y: (qr.y + qr.height / 2) * scale };
  const wide = { w: Math.min(meta.width, (800 * scale * W) / H) };
  const near = { w: qr.width * scale * 2.1 };
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const ffmpeg = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", W + "x" + H, "-r", String(FPS), "-i", "-", "-pix_fmt", "yuv420p", CAMERA_FILE];
  const frames = [];
  for (let i = 0; i < FPS * SECONDS; i++) {
    const t = i / FPS;
    const k = ease((t - 1.5) / 1.3); // hold wide and blurred, then move in
    const w = wide.w + (near.w - wide.w) * k;
    const h = (w * H) / W;
    const sway = { x: Math.sin(t * 2.1) * 6 * scale, y: Math.cos(t * 1.7) * 5 * scale };
    const cx = meta.width / 2 + (centre.x - meta.width / 2) * k + sway.x;
    const startY = (800 * scale) / 2;
    const cy = startY + (centre.y - startY) * k + sway.y;
    const left = Math.round(Math.min(Math.max(0, cx - w / 2), meta.width - w));
    const top = Math.round(Math.min(Math.max(0, cy - h / 2), meta.height - h));
    let frame = sharp(shot).extract({ left, top, width: Math.floor(w), height: Math.floor(h) }).resize(W, H);
    const blur = 7 * (1 - k);
    if (blur > 0.4) frame = frame.blur(blur);
    frames.push(await frame.removeAlpha().raw().toBuffer());
  }
  execFileSync("ffmpeg", ffmpeg, { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
}

async function take() {
  fs.mkdirSync(OUT, { recursive: true });
  const organiser = await open("organiser", "desktop");
  let bob;
  let alice;
  try {
    if (!(await signedIn(organiser.page))) throw new Error("Run setup first: the organiser is not signed in.");
    await organiser.page.goto(BASE + "/organiser");
    await organiser.page.getByText("Waiting at the door").waitFor();
    await organiser.page.locator('img[alt="Entry QR code for this event"]').waitFor();
    await sleep(800);
    await buildCameraClip(organiser.page);

    alice = await open("alice", "phone");
    bob = await open("bob", "phone", ["--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + CAMERA_FILE]);
    for (const actor of [alice, bob]) {
      if (!(await signedIn(actor.page))) throw new Error("Run setup first: " + actor.name + " is not signed in.");
    }
    await alice.page.getByRole("button", { name: /Simulate payment/ }).waitFor();
    await bob.page.goto(BASE + "/tickets");
    await bob.page.getByRole("heading", { name: "My tickets" }).waitFor();

    const dir = path.join(OUT, "demo");
    fs.rmSync(dir, { recursive: true, force: true });
    const tracks = {};
    for (const actor of [organiser, alice, bob]) tracks[actor.name] = await capture(actor, path.join(dir, actor.name));
    const t0 = now();
    const marks = [];
    const mark = (name) => marks.push({ name, t: now() });
    const phone = [{ from: t0, track: "alice", label: "Alice" }];
    const a = alice.page;
    const b = bob.page;
    const o = organiser.page;

    mark("buy");
    await sleep(2200);
    await a.getByRole("button", { name: /Simulate payment/ }).click();
    await a.getByText("Your ticket is in your account.").waitFor();
    await shot(a, "1-bought");
    await sleep(2600);
    await a.getByRole("link", { name: "View my tickets" }).click();
    await a.getByRole("button", { name: "Transfer ticket" }).first().waitFor();
    await shot(a, "2-ticket");
    await sleep(2200);

    mark("transfer");
    await a.getByRole("button", { name: "Transfer ticket" }).first().click();
    const recipient = a.getByLabel("Recipient email");
    await recipient.waitFor();
    await sleep(700);
    await recipient.pressSequentially(EMAILS.bob, { delay: 34 });
    await sleep(600);
    await a.getByRole("button", { name: "Continue" }).click();
    await a.getByRole("button", { name: "Confirm transfer" }).waitFor();
    await sleep(2400);
    await a.getByRole("button", { name: "Confirm transfer" }).click();
    await a.getByText(/now belongs to/).waitFor();
    await sleep(2800);
    await a.getByRole("button", { name: "Done" }).click();
    await sleep(1500);

    mark("received");
    await b.reload();
    await b.getByRole("link", { name: "Enter event" }).first().waitFor();
    phone.push({ from: now(), track: "bob", label: "Bob" });
    await shot(b, "3-received");
    await sleep(4600);

    mark("proof");
    await b.locator("summary").first().click();
    await b.getByText("History").first().waitFor();
    await sleep(1200);
    for (let i = 0; i < 9; i++) (await b.mouse.wheel(0, 70), await sleep(140));
    await sleep(3200);
    await b.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1300);

    mark("enter");
    await b.getByRole("link", { name: "Enter event" }).first().click();
    await sleep(1700);
    await shot(b, "4-scan");
    await b.waitForURL(/\/admit\?/, { timeout: 20_000 });
    await b.getByRole("button", { name: "Confirm entry" }).waitFor();
    await sleep(2000);
    await b.getByRole("button", { name: "Confirm entry" }).click();
    await b.getByText("Show this code to staff").waitFor();
    await o.getByRole("button", { name: "Admit" }).waitFor();
    await shot(b, "5-waiting");
    await shot(o, "5-organiser-request", { clip: { x: 500, y: 236, width: 440, height: 330 } });
    mark("admit");
    await sleep(3600);
    await o.getByRole("button", { name: "Admit" }).click();
    await o.getByText("Admitted").first().waitFor();
    await b.getByText("You're in. Enjoy the show.").waitFor();
    await shot(b, "6-used");
    mark("used");
    await sleep(5400);

    mark("again");
    await b.goto(BASE + "/enter");
    await b.waitForURL(/\/admit\?/, { timeout: 20_000 });
    await b.getByText("No available ticket for this event").waitFor();
    await sleep(4600);

    const tEnd = now();
    for (const track of Object.values(tracks)) await track.stop();
    const txLinks = await o.locator('a[href*="/tx/"]').evaluateAll((links) => links.map((link) => link.href));
    saveTake(dir, { t0, tEnd, marks, cuts: [], phone, checkInTx: txLinks[0] ?? null, tracks: Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, v.frames])) });
  } finally {
    for (const actor of [organiser, alice, bob]) if (actor) await actor.context.close();
  }
}

/** Uses up any unused tickets Bob still holds, so a take starts from a clean wallet. Not captured. */
async function tidy() {
  const organiser = await open("organiser", "desktop");
  const bob = await open("bob", "phone");
  try {
    await organiser.page.goto(BASE + "/organiser");
    await organiser.page.getByText("Waiting at the door").waitFor();
    for (let used = 0; ; used++) {
      await bob.page.goto(BASE + "/admit?eventId=1");
      const confirm = bob.page.getByRole("button", { name: "Confirm entry" });
      const none = bob.page.getByText("No available ticket for this event");
      await confirm.or(none).first().waitFor();
      if (await none.isVisible()) return console.log("Bob has no unused tickets left (" + used + " admitted).");
      await confirm.click();
      await bob.page.getByText("Show this code to staff").waitFor();
      await organiser.page.getByRole("button", { name: "Admit" }).first().click();
      await bob.page.getByText("You're in. Enjoy the show.").waitFor();
    }
  } finally {
    for (const actor of [organiser, bob]) await actor.context.close();
  }
}

/**
 * Retakes the 4-scan still with the organiser's entry code in focus. The live page moves on the
 * moment it reads a code, so the focused camera view is laid over the viewfinder instead, under
 * the scanner's own frame marks. Sends no transaction.
 */
async function scanShot() {
  const organiser = await open("organiser", "desktop");
  let bob;
  try {
    await organiser.page.goto(BASE + "/organiser");
    const code = organiser.page.locator('img[alt="Entry QR code for this event"]');
    await code.waitFor();
    await sleep(800);
    // The camera view is the organiser's entry-code card on its own dark colour, centred on the code.
    const card = code.locator("xpath=../..");
    const qr = await code.boundingBox();
    const box = await card.boundingBox();
    const scale = 1.5; // the organiser page's device scale factor
    const side = Math.round(qr.width * scale * 1.8);
    const trim = 20; // device pixels: drops the card's rounded corners so it blends into the backdrop
    const shot = sharp(await card.screenshot());
    const meta = await shot.metadata();
    const padded = await shot
      .extract({ left: trim, top: trim, width: meta.width - 2 * trim, height: meta.height - 2 * trim })
      .extend({ top: side, bottom: side, left: side, right: side, background: "#0e1512" })
      .png()
      .toBuffer();
    const centre = (start, size, origin) => Math.round((start - origin + size / 2) * scale - trim + side / 2);
    const view = await sharp(padded)
      .extract({ left: centre(qr.x, qr.width, box.x), top: centre(qr.y, qr.height, box.y), width: side, height: side })
      .png()
      .toBuffer();

    // Chrome's test pattern stands in for the camera. It holds no code, so the page stays put.
    bob = await open("bob", "phone", ["--use-fake-device-for-media-stream"]);
    await bob.page.goto(BASE + "/enter");
    await bob.page.locator(".scan-region-highlight").waitFor();
    await sleep(800);
    await bob.page.evaluate((src) => {
      const still = new Image();
      still.src = src;
      still.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
      document.querySelector("video").after(still);
      return still.decode();
    }, "data:image/png;base64," + view.toString("base64"));
    const file = path.join(OUT, "shots", "4-scan.png");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await bob.page.screenshot({ path: file });
    console.log("wrote", file);
  } finally {
    for (const actor of [organiser, bob]) if (actor) await actor.context.close();
  }
}

const mode = process.argv[2];
if (mode === "setup") await setup();
else if (mode === "take") await take();
else if (mode === "tidy") await tidy();
else if (mode === "scanshot") await scanShot();
else (console.error("Usage: node record.mjs <setup|take|tidy|scanshot>"), process.exit(1));
