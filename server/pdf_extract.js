// Soft dependency on poppler's `pdftotext`. tryExtractPdfText(buf) returns
// the text layer on success, "" when pdftotext ran on a PDF with no text
// layer (scanned), null when extraction is unavailable (binary missing,
// spawn/exit error, timeout).

import { spawn } from "node:child_process";

const EXTRACT_TIMEOUT_MS = 10_000;

// undefined = not probed yet; string = pdftotext command name; null = absent.
let probedCommand;

async function probePdftotext() {
  if (probedCommand !== undefined) return probedCommand;
  probedCommand = await new Promise((resolve) => {
    const child = spawn("pdftotext", ["-v"], { stdio: ["ignore", "ignore", "ignore"] });
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code === 0 ? "pdftotext" : null));
  });
  return probedCommand;
}

export async function tryExtractPdfText(buf) {
  if (!buf || !buf.length) return null;
  const bin = await probePdftotext();
  if (!bin) return null;
  return new Promise((resolve) => {
    const child = spawn(bin, ["-enc", "UTF-8", "-", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), EXTRACT_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve(code === 0 ? out.trimEnd() : null);
    });
    child.stdin.on("error", () => finish(null));
    child.stdin.end(buf);
  });
}

export function _setProbedCommandForTesting(value) {
  probedCommand = value;
}
