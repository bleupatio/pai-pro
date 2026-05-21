#!/usr/bin/env node
// CLI wrapper for video generation via PAI raw passthrough
// (model id: jm-video-generation). Synchronous from the caller's POV —
// typical wall-clock is 2-4 min, so plan accordingly.
//
// Refs: PAI's `jm-assets` endpoint fetches every reference URL
// server-side for moderation and requires a publicly-fetchable URL.
// If a ref resolves to a local viewer URL (i.e., mirrored on disk),
// buildProviderRefs rewrites the host to the cloudflared tunnel origin
// via .tunnel_url. If `.tunnel_url` is missing the call fails with
// bad_args. Pass a public --reference-image-url /
// --reference-audio-url / --reference-video-url to bypass entirely.

import path from "node:path";
import fs from "node:fs/promises";
import { parseArgs, emitSuccess, emitFailure, classify, isoNow, truncateLabel } from "./_cli.js";
import { submitVideo, pollVideo, downloadVideo } from "../pai_video_client.js";
import { getDefault, getCost } from "../model_registry.js";
import { uploadReferences } from "../pai_assets_client.js";
import { kickPreupload } from "./_preupload_hook.js";
import {
  writeBytesToTmp,
  viewerUrlForLocalPath,
  buildProviderRefs,
  readActiveProject,
  readNodeType,
} from "../local_mirror.js";
import { postNodeAddBatch } from "./_mutate_helper.js";
import { buildReferences, isBypassEnabled, newJobId, writePending, removePending, removePendingSync } from "./_pending.js";
import { VIDEO_LIMITS } from "./_limits.js";

const rawArgv = process.argv.slice(2);

const args = parseArgs({
  prompt:                  { type: "string", short: "p" },
  duration:                { type: "string", default: "15" },
  "aspect-ratio":          { type: "string", default: "16:9" },
  resolution:              { type: "string", default: "1080p" },
  // Audio defaults ON (generate_audio: true). Pass --no-audio ONLY when
  // the user has explicitly asked for a silent clip. Trailer framing,
  // "I'll add SFX in post", or detail-SFX skepticism are NOT triggers —
  // audio is the baseline. See video-compose/SKILL.md § "Hard defaults".
  "no-audio":              { type: "boolean", default: false },
  "reference-image-url":   { type: "string", multiple: true, default: [] },
  "reference-audio-url":   { type: "string", multiple: true, default: [] },
  "reference-video-url":   { type: "string", multiple: true, default: [] },
  // canvas-mutate integration
  label:                   { type: "string" },
  "ref-source-id":         { type: "string", multiple: true, default: [] },
  "source-node-id":        { type: "string" }, // authorship edge — see CLAUDE.md
  // Canvas audio_result refs — resolved to local_path, uploaded via the tunnel.
  "ref-audio-source-id":   { type: "string", multiple: true, default: [] },
  "shot-id":               { type: "string" },
  "project-id":            { type: "string" },
  "request-id":            { type: "string" },
  "no-canvas-write":       { type: "boolean" },
  // Draft gate — see CLAUDE.md § "Draft gate".
  stage:                   { type: "boolean" },
  "existing-job-id":       { type: "string" },
});

const refImages = args["reference-image-url"] || [];
const refAudios = args["reference-audio-url"] || [];
const refVideos = args["reference-video-url"] || [];
const audSrcIds = Array.isArray(args["ref-audio-source-id"]) ? args["ref-audio-source-id"] : [];
const refSourcesArg = Array.isArray(args["ref-source-id"]) ? args["ref-source-id"] : [];

// Sent values surfaced in {limits, sent} failure JSON. Counts are explicit
// URL refs only; --ref-source-id items list separately.
function buildSent() {
  return {
    image_refs: refImages.length,
    audio_refs: refAudios.length + audSrcIds.length,
    video_refs: refVideos.length,
    image_urls: refImages,
    audio_urls: refAudios,
    video_urls: refVideos,
    ref_source_ids: refSourcesArg,
    audio_source_ids: audSrcIds,
    source_node_id: args["source-node-id"] || null,
    duration: Number(args.duration) || 15,
    aspect_ratio: args["aspect-ratio"],
    resolution: args.resolution,
    generate_audio: !args["no-audio"],
  };
}

function fail(klass, message, extra = {}) {
  emitFailure(klass, message, { limits: VIDEO_LIMITS, sent: buildSent(), ...extra });
}

if (!args.prompt) {
  fail("bad_args", "missing --prompt");
  process.exit(2);
}

// Fast-fail count violations — same {limits, sent} shape as deeper provider failures.
const overCaps = [];
if (refImages.length > VIDEO_LIMITS.max_image_refs) overCaps.push(`image_refs ${refImages.length} > ${VIDEO_LIMITS.max_image_refs}`);
if ((refAudios.length + audSrcIds.length) > VIDEO_LIMITS.max_audio_refs) overCaps.push(`audio_refs ${refAudios.length + audSrcIds.length} > ${VIDEO_LIMITS.max_audio_refs}`);
if (refVideos.length > VIDEO_LIMITS.max_video_refs) overCaps.push(`video_refs ${refVideos.length} > ${VIDEO_LIMITS.max_video_refs}`);
if (overCaps.length) {
  fail("bad_args", `reference cap exceeded: ${overCaps.join("; ")}`);
  process.exit(2);
}

const jobId = args["existing-job-id"] || newJobId();
const durationPlanned = Number(args.duration) || 15;
const plannedModel = getDefault("video").id;

// Asset preupload through PAI's jm-assets costs ~$0.01 per ref. Add to
// the staged cost so the agent's preview reflects the true freeze. Count
// includes URL refs and source-id refs across all three kinds, deduped —
// a ref passed both as a --reference-*-url and via --ref-source-id
// resolves to one upload, not two.
function countUniqueRefs() {
  const urls = new Set([
    ...refImages,
    ...refAudios,
    ...refVideos,
  ]);
  const sids = new Set([...refSourcesArg, ...audSrcIds]);
  return urls.size + sids.size;
}

if (args.stage && !(await isBypassEnabled())) {
  const videoCost = getCost(plannedModel, {
    resolution: args.resolution,
    duration: durationPlanned,
  });
  const refCount = countUniqueRefs();
  const assetCost = refCount * (getCost("jm-assets") ?? 0.01);
  const costUsd = +(Number(videoCost ?? 0) + assetCost).toFixed(3);
  await writePending({
    jobId,
    kind: "video",
    stage: "draft",
    prompt: args.prompt,
    aspectRatio: args["aspect-ratio"],
    references: buildReferences({ images: refImages, videos: refVideos, audios: refAudios }),
    // refSourcesArg is the agent's --ref-source-id list (image + video
    // refs by canvas node id); audSrcIds is --ref-audio-source-id.
    // Capturing both lets the projection draw dashed edges for audio
    // refs that arrive as source-ids (otherwise URL matching in
    // projection misses them, since the URL is only resolved at fire).
    referenceSourceIds: [...refSourcesArg, ...audSrcIds],
    model: plannedModel,
    resolution: args.resolution,
    duration: durationPlanned,
    costUsd,
    script: "generate_video.js",
    argv: rawArgv.filter((a) => a !== "--stage"),
  });
  emitSuccess({ stage: "draft", job_id: jobId, model: plannedModel, cost_usd: costUsd });
  process.exit(0);
}

const cleanup = () => removePendingSync(jobId);
process.on("SIGINT",  () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

await writePending({
  jobId,
  kind: "video",
  prompt: args.prompt,
  aspectRatio: args["aspect-ratio"],
  references: buildReferences({ images: refImages, videos: refVideos, audios: refAudios }),
  model: plannedModel,
  resolution: args.resolution,
  duration: durationPlanned,
});

let exitCode = 0;
try {
  const durationInt = durationPlanned;
  const projectId = args["project-id"] || (await readActiveProject());

  // PAI's `jm-assets` endpoint fetches the URL server-side → must be
  // public. Partition --ref-source-id list into image / video buckets by
  // node type. Audio refs come from --ref-audio-source-id (explicit) plus
  // --reference-audio-url. Unknown ids in --ref-source-id are dropped
  // here; postNodeAddBatch still emits derived edges for every ref id
  // (image, video, and audio).
  const imgSrcIds = [];
  const vidSrcIds = [];
  for (const sid of refSourcesArg) {
    const t = await readNodeType({ nodeId: sid, projectId });
    if (t === "image_result") imgSrcIds.push(sid);
    else if (t === "video_result") vidSrcIds.push(sid);
  }

  const resolvedImages = await buildProviderRefs({ urls: refImages, sourceIds: imgSrcIds, projectId });
  const resolvedAudios = await buildProviderRefs({ urls: refAudios, sourceIds: audSrcIds, projectId });
  const resolvedVideos = await buildProviderRefs({ urls: refVideos, sourceIds: vidSrcIds, projectId });

  let assetIds = { images: [], audios: [], videos: [] };
  if (resolvedImages.length || resolvedAudios.length || resolvedVideos.length) {
    try {
      assetIds = await uploadReferences({
        images: resolvedImages,
        audios: resolvedAudios,
        videos: resolvedVideos,
      });
    } catch (e) {
      fail("asset_rejected", e.message, {
        failed_url: e.failedUrl || null,
        kind: e.kind || null,
      });
      exitCode = 1;
      throw e;
    }
  }

  const { taskId } = await submitVideo({
    prompt: args.prompt,
    duration: durationInt,
    aspectRatio: args["aspect-ratio"],
    resolution: args.resolution,
    generateAudio: !args["no-audio"],
    imageAssetIds: assetIds.images,
    audioAssetIds: assetIds.audios,
    videoAssetIds: assetIds.videos,
  });

  const { videoUrl, durationSeconds } = await pollVideo(taskId);
  const mp4Bytes = await downloadVideo(videoUrl);
  const staged = await writeBytesToTmp({
    bytes: mp4Bytes,
    mimeType: "video/mp4",
    projectId,
  });
  const tmpAbsPath = staged.absolute_path;
  const ext = path.extname(tmpAbsPath);

  const generatedAt = isoNow();
  const shotIdRaw = args["shot-id"];
  const shotId = shotIdRaw === undefined ? null : Number(shotIdRaw);
  const data = {
    label: args.label || truncateLabel(args.prompt),
    prompt: args.prompt,
    duration: durationInt,
    aspect: args["aspect-ratio"],
    shot_id: Number.isFinite(shotId) ? shotId : null,
    metadata: {
      source: "pai",
      task_type: "video_generation",
      model: plannedModel,
      duration: durationInt,
      aspect_ratio: args["aspect-ratio"],
      resolution: args.resolution,
      generate_audio: !args["no-audio"],
      generated_at: generatedAt,
      // PAI's signed GCS URL (~24h TTL). Surfaced for future re-download
      // paths; the canvas URL itself is always derived from local_path.
      provider_output_url: videoUrl,
      ...(refImages.length ? { reference_image_urls: refImages } : {}),
      ...(refAudios.length ? { reference_audio_urls: refAudios } : {}),
      ...(refVideos.length ? { reference_video_urls: refVideos } : {}),
    },
  };
  // Merge audio source ids into ref-source-id so postNodeAddBatch emits
  // a derived edge for each audio ref too (audio → new video_result).
  const argsForMutate = {
    ...args,
    "ref-source-id": [...refSourcesArg, ...audSrcIds],
  };
  const mutResult = await postNodeAddBatch({
    args: argsForMutate,
    type: "video_result",
    data,
    actor: "cli:generate_video",
    tmpPath: tmpAbsPath,
    pendingJobId: jobId,
  });
  const assignedNodeId = mutResult?.canvas_mutation?.node_id ?? null;
  if (!assignedNodeId) {
    await fs.unlink(tmpAbsPath).catch(() => {});
  }
  const localPath = assignedNodeId
    ? `assets/videos/${assignedNodeId}${ext}`
    : null;
  const url = localPath
    ? viewerUrlForLocalPath({ localPath, projectId })
    : null;

  if (localPath) {
    await kickPreupload({ projectId, localPath, mimeType: "video/mp4" });
  }

  const payload = {
    output_url: url,
    local_path: localPath,
    provider_output_url: videoUrl,
    model: plannedModel,
    duration: durationInt,
    aspect_ratio: args["aspect-ratio"],
    resolution: args.resolution,
    generate_audio: !args["no-audio"],
    poll_seconds: durationSeconds,
    generated_at: generatedAt,
  };
  if (refImages.length) payload.reference_image_urls = refImages;
  if (refAudios.length) payload.reference_audio_urls = refAudios;
  if (refVideos.length) payload.reference_video_urls = refVideos;
  if (mutResult) Object.assign(payload, mutResult);

  emitSuccess(payload);
} catch (e) {
  if (exitCode === 0) {
    fail(classify(e), e.message, e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {});
    exitCode = 1;
  }
} finally {
  await removePending(jobId);
}
process.exit(exitCode);
