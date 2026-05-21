// Unit tests for pdf_extract. Real-pdftotext round-trip is skipped when
// poppler isn't installed on the test box (matching the soft-dep contract).

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import {
  tryExtractPdfText,
  _setProbedCommandForTesting,
} from "../pdf_extract.js";

const resetProbe = () => _setProbedCommandForTesting(undefined);

// Minimal valid PDF carrying a single text-showing operator. Constructed
// inline so the suite stays self-contained — no fixture file on disk.
function makeMinimalPdf(text) {
  const enc = (s) => Buffer.from(s, "latin1");
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const contentStream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  const header = enc("%PDF-1.4\n%\xff\xff\xff\xff\n");
  const parts = [header];
  let cursor = header.length;
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor);
    const body = enc(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
    parts.push(body);
    cursor += body.length;
  }
  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(enc(xref + trailer));
  return Buffer.concat(parts);
}

function hasPdftotext() {
  return new Promise((resolve) => {
    const child = spawn("pdftotext", ["-v"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

test("tryExtractPdfText: empty buffer returns null without spawning", async () => {
  resetProbe();
  assert.equal(await tryExtractPdfText(Buffer.alloc(0)), null);
  assert.equal(await tryExtractPdfText(null), null);
});

test("tryExtractPdfText: returns null when pdftotext is unavailable", async () => {
  _setProbedCommandForTesting(null);
  try {
    const pdf = makeMinimalPdf("Hello");
    assert.equal(await tryExtractPdfText(pdf), null);
  } finally {
    resetProbe();
  }
});

test("tryExtractPdfText: garbage bytes yield null (non-zero pdftotext exit)", async (t) => {
  if (!(await hasPdftotext())) {
    t.skip("pdftotext not installed");
    return;
  }
  resetProbe();
  const junk = Buffer.from("not a pdf, just some random ascii".repeat(20));
  assert.equal(await tryExtractPdfText(junk), null);
});

test("tryExtractPdfText: minimal real PDF round-trips to its text layer", async (t) => {
  if (!(await hasPdftotext())) {
    t.skip("pdftotext not installed");
    return;
  }
  resetProbe();
  const pdf = makeMinimalPdf("Hello PAI Pro");
  const text = await tryExtractPdfText(pdf);
  assert.ok(text, "expected non-null text");
  assert.ok(
    text.includes("Hello PAI Pro"),
    `expected extracted text to contain marker, got: ${JSON.stringify(text)}`,
  );
});
