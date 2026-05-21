// Classify an upload's MIME type into a canvas-node kind. Centralized so
// adding a new format (e.g. `.fountain`, `.srt`) is a one-line change.
//
// kind === 'image' → image_result with subtype: 'reference'
// kind === 'video' → video_result
// kind === 'audio' → audio_result with subtype: 'upload'
// kind === 'note'  → note (text body for text/*, filename body otherwise)

const TEXT_MIME = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/x-fountain",
  "application/x-subrip",
]);

export function classifyAttachment(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return { kind: "image", textual: false };
  if (m.startsWith("video/")) return { kind: "video", textual: false };
  if (m.startsWith("audio/")) return { kind: "audio", textual: false };
  if (m.startsWith("text/") || TEXT_MIME.has(m)) {
    return { kind: "note", textual: true };
  }
  return { kind: "note", textual: false };
}

// Extract a short, human-readable preview from a text buffer: first 6
// lines or first 400 chars, whichever comes first. Returns the raw
// preview string — the caller decides how to compose the note body.
export function textPreview(buf, charCap = 400, lineCap = 6) {
  const decoded = buf.toString("utf8");
  const byLine = decoded.split("\n", lineCap + 1).slice(0, lineCap).join("\n");
  if (byLine.length <= charCap) return byLine;
  return byLine.slice(0, charCap) + "…";
}
