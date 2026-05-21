// Reel routes: stitch-on-demand download + the smooth-playback master
// (manifest + byte-range MP4 served out of the LRU cache built by
// lib/reel_cache.js).

import fs from "node:fs";
import fsp from "node:fs/promises";

import {
  stitchReel,
  computeReelBuildId,
  computeReelManifest,
} from "../reel_stitch.js";
import {
  ensureReelMaster,
  kickReelPrebuild,
  reelCachePath,
} from "../lib/reel_cache.js";
import { projectDir } from "../lib/paths.js";

export function registerReelRoutes({ app, projects }) {
  // GET /projects/:id/reel.mp4 — stitch every video_result with a numeric
  // shot_id (ordered by shot_id) and stream the concatenated MP4 back as a
  // download. Re-runs ffmpeg on every request; the fast path is concat-copy
  // so a handful of clips stitches in a couple seconds.
  app.get("/projects/:id/reel.mp4", async (req, res) => {
    const id = req.params.id;
    const p = projects.get(id);
    if (!p) return res.status(404).json({ error: "not found" });
    const state = p.canvasState;
    if (!state || typeof state !== "object") {
      return res.status(400).json({ error: "no canvas state" });
    }
    let cleanup = null;
    try {
      const result = await stitchReel(state, projectDir(id), id);
      cleanup = result.cleanup;
      const safeTitle = (p.meta?.title || "reel")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "reel";
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", String(result.size));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeTitle}.mp4"`,
      );
      // Content-Disposition isn't in the CORS "safelist" — without an
      // explicit Expose-Headers, the browser fetch() can't read it back
      // and our blob-URL download falls back to the generic filename.
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      const stream = fs.createReadStream(result.path);
      const finalize = () => {
        if (cleanup) { cleanup(); cleanup = null; }
      };
      stream.on("close", finalize);
      stream.on("error", (e) => {
        console.warn(`[viewer] reel stream ${id} failed:`, e.message);
        finalize();
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      res.on("close", finalize);
      stream.pipe(res);
    } catch (e) {
      if (cleanup) await cleanup();
      if (e.code === "NO_SHOTS") {
        return res.status(400).json({ error: "no shots on the reel to stitch" });
      }
      console.warn(`[viewer] GET /projects/${id}/reel.mp4 failed:`, e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /projects/:id/reel/manifest — describes the master that goes
  // with the current canvas state. Cheap (no ffmpeg) — the player polls
  // this on tab open and on every canvas-state push to learn the
  // build_id it should be requesting.
  app.get("/projects/:id/reel/manifest", async (req, res) => {
    const id = req.params.id;
    const p = projects.get(id);
    if (!p) return res.status(404).json({ error: "not found" });
    const manifest = computeReelManifest(p.canvasState);
    if (!manifest.build_id) return res.json({ ...manifest, ready: false });
    let ready = false;
    try {
      await fsp.access(reelCachePath(id, manifest.build_id));
      ready = true;
    } catch { /* still building or never built */ }
    // Side-effect: if we haven't started a build for this composition,
    // kick one off so the next manifest poll sees ready=true.
    if (!ready) kickReelPrebuild({ projects, id });
    res.json({ ...manifest, ready });
  });

  // GET /projects/:id/reel/preview.mp4?build=<id> — streams the cached
  // master with byte-range support so the <video> element can seek.
  // When ?build= is missing or stale, returns 409 so the client knows
  // to refetch the manifest and try again with the new build_id.
  app.get("/projects/:id/reel/preview.mp4", async (req, res) => {
    const id = req.params.id;
    const p = projects.get(id);
    if (!p) return res.status(404).json({ error: "not found" });
    const requestedBuild = typeof req.query.build === "string" ? req.query.build : null;
    const currentBuild = computeReelBuildId(p.canvasState);
    if (!currentBuild) return res.status(400).json({ error: "no shots on reel" });
    if (requestedBuild && requestedBuild !== currentBuild) {
      return res.status(409).json({ error: "build_id stale", current_build: currentBuild });
    }
    const buildId = requestedBuild || currentBuild;
    let cachePath;
    try {
      cachePath = await ensureReelMaster({ projects, id, buildId });
    } catch (e) {
      if (e.code === "FFMPEG_MISSING") {
        return res.status(503).json({ error: "ffmpeg not installed", klass: "ffmpeg_missing" });
      }
      if (e.code === "NO_SHOTS") {
        return res.status(400).json({ error: "no shots on reel" });
      }
      console.warn(`[viewer] reel preview ${id} build failed: ${e.message}`);
      return res.status(500).json({ error: e.message });
    }

    // Byte-range serving so <video> can seek without re-downloading.
    let info;
    try {
      info = await fsp.stat(cachePath);
    } catch (e) {
      return res.status(500).json({ error: "cache file vanished" });
    }
    const total = info.size;
    const range = req.headers.range;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (!range) {
      res.setHeader("Content-Length", String(total));
      fs.createReadStream(cachePath).pipe(res);
      return;
    }
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) {
      res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).end();
    }
    const start = parseInt(m[1], 10);
    const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    if (start > end || start >= total) {
      res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(end - start + 1));
    fs.createReadStream(cachePath, { start, end }).pipe(res);
  });
}
