// Builders for the {type, data} half of an addNode payload, used by
// the /upload route. URL/local_path are filled by the mutator after
// the tmp_path rename; non-media kinds become inline notes with no
// file backing.

import crypto from "node:crypto";
import path from "node:path";

import { textPreview } from "../upload_classify.js";

// Used by routes/uploads.js to derive the tmp-file extension before
// staging into assets/.tmp/. The other three sanitizers below are
// internal to buildUploadedNodePayload.
export function sanitizeBasename(name) {
  const base = path.basename(String(name || "")).replace(/\\/g, "");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 96);
  return cleaned || "file";
}

// Like sanitizeBasename but preserves Unicode — for the node's display
// fields (source_filename, label). On-disk paths still use sanitizeBasename.
function displayBasename(name) {
  const base = path.basename(String(name || "")).replace(/\\/g, "");
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 256);
  return cleaned || "file";
}

function shortLabel(name, cap = 30) {
  const s = String(name || "").trim();
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1) + "…";
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Builds the {type, data} half of an addNode payload. URL/local_path are
// filled by the mutator after the tmp_path rename; non-media kinds become
// inline notes with no file backing. `pdfText` is the pdf_extract.js result.
export function buildUploadedNodePayload({ kind, textual, buf, mime, originalName, dims, pdfText }) {
  const filename = displayBasename(originalName);
  const attachmentId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();
  if (kind === "image") {
    const aspect =
      dims && dims.width > 0 && dims.height > 0
        ? `${dims.width}:${dims.height}`
        : undefined;
    return {
      type: "image_result",
      data: {
        subtype: "reference",
        label: shortLabel(filename),
        source_filename: filename,
        attachment_id: attachmentId,
        metadata: {
          source: "user_upload",
          task_type: "upload",
          content_type: mime,
          size_bytes: buf.length,
          ...(aspect ? { aspect_ratio: aspect } : {}),
          generated_at: generatedAt,
        },
      },
    };
  }
  if (kind === "video") {
    return {
      type: "video_result",
      data: {
        label: shortLabel(filename),
        duration: 0,
        aspect: "16:9",
        shot_id: null,
        source_filename: filename,
        attachment_id: attachmentId,
        metadata: {
          source: "user_upload",
          task_type: "upload",
          content_type: mime,
          size_bytes: buf.length,
          generated_at: generatedAt,
        },
      },
    };
  }
  if (kind === "audio") {
    return {
      type: "audio_result",
      data: {
        subtype: "upload",
        label: shortLabel(filename),
        metadata: {
          source: "user_upload",
          task_type: "upload",
          content_type: mime,
          size_bytes: buf.length,
          source_filename: filename,
          attachment_id: attachmentId,
          generated_at: generatedAt,
        },
      },
    };
  }
  const TEXT_INLINE_LIMIT = 2 * 1024 * 1024;
  const pdfExtracted = typeof pdfText === "string";
  const pdfHasText = pdfExtracted && pdfText.length > 0;
  let body;
  if (textual) {
    body = buf.length <= TEXT_INLINE_LIMIT ? buf.toString("utf8") : textPreview(buf);
  } else if (pdfHasText) {
    body = pdfText.length <= TEXT_INLINE_LIMIT
      ? pdfText
      : textPreview(Buffer.from(pdfText, "utf8"));
  } else if (pdfExtracted) {
    body = `[${filename}] — scanned PDF, no text layer detected. Run OCR (tesseract) to extract.`;
  } else {
    body = `[${filename}] uploaded (${formatBytes(buf.length)}, ${mime})`;
  }
  return {
    type: "note",
    data: {
      label: shortLabel(filename),
      body,
      source_filename: filename,
      attachment_id: attachmentId,
      metadata: {
        source: "user_upload",
        task_type: "upload",
        content_type: mime,
        size_bytes: buf.length,
        ...(pdfExtracted ? { extracted_via: "pdftotext" } : {}),
        ...(pdfExtracted && !pdfHasText ? { extracted_status: "no_text_layer" } : {}),
        timestamp: generatedAt,
      },
    },
  };
}
