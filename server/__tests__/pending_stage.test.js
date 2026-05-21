// End-to-end tests for the --stage draft gate.
//
// Each generate_*.js CLI grew one flag: --stage. When set, the CLI writes
// a captured-argv `.pending/<jobId>.json` draft with a price snapshot
// and exits 0 without contacting the provider.
//
// We spawn the CLI as a subprocess with cwd set to a tmp dir so the
// sidecar lands under a controlled tree, independent of the user's real
// .active_project. No API keys are needed — the --stage branch exits
// before any provider client is invoked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPTS_DIR = join(__dirname, "..", "scripts");

function runCli({ script, args, cwd }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(
      process.execPath,
      [join(SCRIPTS_DIR, script), ...args],
      { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function setupCwd() {
  const dir = await mkdtemp(join(tmpdir(), "pending-stage-"));
  await mkdir(join(dir, ".pending"), { recursive: true });
  return dir;
}

// CLIs emit one `{...}` line on stdout; take the last one in case dotenv
// or a provider client surfaces a warning.
function parseReply(stdout) {
  const lines = stdout.trim().split("\n").filter((l) => l.trim().startsWith("{"));
  return JSON.parse(lines[lines.length - 1]);
}

async function readSidecar(cwd, jobId) {
  return JSON.parse(await readFile(join(cwd, ".pending", `${jobId}.json`), "utf8"));
}

test("generate_image.js --stage writes a draft sidecar and exits 0", async (t) => {
  const cwd = await setupCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const { code, stdout, stderr } = await runCli({
    script: "generate_image.js",
    args: [
      "--stage",
      "--prompt", "a test cat",
      "--aspect-ratio", "1:1",
      "--image-size", "1K",
    ],
    cwd,
  });

  assert.strictEqual(code, 0, `expected exit 0; stderr:\n${stderr}`);

  const reply = parseReply(stdout);
  assert.strictEqual(reply.ok, true);
  assert.strictEqual(reply.stage, "draft");
  assert.match(reply.job_id, /^pending_/);
  assert.ok(reply.cost_usd > 0);

  const sidecar = await readSidecar(cwd, reply.job_id);
  assert.strictEqual(sidecar.stage, "draft");
  assert.strictEqual(sidecar.kind, "image");
  assert.strictEqual(sidecar.prompt, "a test cat");
  assert.strictEqual(sidecar.script, "generate_image.js");
  assert.ok(Array.isArray(sidecar.argv));
  // --stage was stripped from the captured argv; user flags survived.
  assert.ok(!sidecar.argv.includes("--stage"));
  assert.ok(sidecar.argv.includes("--prompt"));
  assert.ok(sidecar.argv.includes("a test cat"));
});

test("generate_video.js --stage writes a draft sidecar and exits 0", async (t) => {
  const cwd = await setupCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const { code, stdout, stderr } = await runCli({
    script: "generate_video.js",
    args: [
      "--stage",
      "--prompt", "wide-angle desert at golden hour",
      "--duration", "10",
      "--resolution", "1080p",
    ],
    cwd,
  });

  assert.strictEqual(code, 0, `expected exit 0; stderr:\n${stderr}`);
  const reply = parseReply(stdout);
  assert.strictEqual(reply.stage, "draft");
  assert.ok(reply.cost_usd > 0);

  const sidecar = await readSidecar(cwd, reply.job_id);
  assert.strictEqual(sidecar.kind, "video");
  assert.strictEqual(sidecar.script, "generate_video.js");
  assert.strictEqual(sidecar.resolution, "1080p");
  assert.strictEqual(sidecar.duration, 10);
});

test("generate_voice.js --stage writes a draft sidecar and exits 0", async (t) => {
  const cwd = await setupCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const { code, stdout, stderr } = await runCli({
    script: "generate_voice.js",
    args: [
      "--stage",
      "--text", "I've been working this beat for twenty years.",
      "--prompt", "Mid-50s man, gravelly baritone, measured pace.",
    ],
    cwd,
  });

  assert.strictEqual(code, 0, `expected exit 0; stderr:\n${stderr}`);
  const reply = parseReply(stdout);
  assert.strictEqual(reply.stage, "draft");

  const sidecar = await readSidecar(cwd, reply.job_id);
  assert.strictEqual(sidecar.kind, "audio");
  assert.strictEqual(sidecar.script, "generate_voice.js");
  assert.strictEqual(sidecar.text, "I've been working this beat for twenty years.");
});

test("generate_image.js --stage without --prompt fails bad_args", async (t) => {
  const cwd = await setupCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const { code, stdout } = await runCli({
    script: "generate_image.js",
    args: ["--stage", "--aspect-ratio", "1:1"],
    cwd,
  });
  assert.strictEqual(code, 2);
  const reply = parseReply(stdout);
  assert.strictEqual(reply.ok, false);
  assert.strictEqual(reply.klass, "bad_args");
});

// --- isBypassEnabled ----------------------------------------------------

import { isBypassEnabled } from "../scripts/_pending.js";
import { writeFile } from "node:fs/promises";

test("isBypassEnabled true when meta.json has dangerously_skip_draft_gate=true", async (t) => {
  const cwd = await setupCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    join(cwd, "meta.json"),
    JSON.stringify({ id: "x", title: "x", dangerously_skip_draft_gate: true }),
  );
  assert.strictEqual(await isBypassEnabled(cwd), true);
});

test("isBypassEnabled false when flag missing, false, or meta absent", async (t) => {
  const cwd = await setupCwd();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // No meta.json at all → false.
  assert.strictEqual(await isBypassEnabled(cwd), false);
  // meta.json without the flag → false.
  await writeFile(join(cwd, "meta.json"), JSON.stringify({ id: "x", title: "x" }));
  assert.strictEqual(await isBypassEnabled(cwd), false);
  // Flag explicitly false → false.
  await writeFile(
    join(cwd, "meta.json"),
    JSON.stringify({ id: "x", title: "x", dangerously_skip_draft_gate: false }),
  );
  assert.strictEqual(await isBypassEnabled(cwd), false);
});
