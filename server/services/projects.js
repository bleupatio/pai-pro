// Project lifecycle — load on viewer boot, mint a new on-disk project
// when none exists yet, ensure each project's asset folders before any
// write lands.

import fsp from "node:fs/promises";
import path from "node:path";

import { initProjectMutatorState } from "../canvas_mutator.js";
import { reseedFromCanvas } from "../pai_assets_client.js";
import {
  PROJECTS_DIR,
  isValidId,
  projectDir,
  workflowPath,
  mutationLogPath,
} from "../lib/paths.js";
import {
  readMeta,
  readCanvas,
  readCanvasPositions,
  readPendingDir,
} from "../lib/readers.js";
import { writeMeta, writeActive } from "../lib/writers.js";

export async function ensureProjectStructure(id) {
  const dir = projectDir(id);
  // The four real asset buckets the mutator + CLIs write to. `audios/`
  // and `notes/` are also created lazily on first write, but pre-
  // creating makes a fresh project's `ls assets/` self-documenting.
  // `voices/` is dead (audio_result lands in `audios/`); `refs/` is
  // legacy (see migrate_ids.js — reference images now live in
  // `images/` with subtype="reference"); `.tmp/` is created lazily by
  // the upload route and the mutator's tmp_path rename path.
  await fsp.mkdir(path.join(dir, "assets/images"), { recursive: true });
  await fsp.mkdir(path.join(dir, "assets/videos"), { recursive: true });
  await fsp.mkdir(path.join(dir, "assets/audios"), { recursive: true });
  await fsp.mkdir(path.join(dir, "assets/notes"),  { recursive: true });
  // Claude Code's settings discovery doesn't walk up from cwd, so
  // per-project sessions (cwd=projects/<id>/) need their own .claude/.
  try {
    await fsp.symlink("../../.claude", path.join(dir, ".claude"));
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}

export async function loadProject(projects, id) {
  const meta = await readMeta(id);
  if (!meta) return null;
  const canvasState = await readCanvas(id);
  const canvasPositions = await readCanvasPositions(id);
  const pendingGenerations = await readPendingDir(id);
  const entry = { id, meta, canvasState, canvasPositions, pendingGenerations };
  initProjectMutatorState(entry, {
    workflowPath: workflowPath(id),
    mutationLogPath: mutationLogPath(id),
  });
  // Reseed the in-process asset cache from the canvas itself —
  // workflow.json node metadata replaces the old .ark_cache.json sidecar.
  reseedFromCanvas(id, Array.isArray(canvasState?.nodes) ? canvasState.nodes : []);
  projects.set(id, entry);
  return entry;
}

export async function primeProjects(projects) {
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!isValidId(e.name)) continue;
    await ensureProjectStructure(e.name);
    await loadProject(projects, e.name);
  }
  if (projects.size === 0) {
    const id = "scratch";
    await ensureProjectStructure(id);
    await fsp.writeFile(
      workflowPath(id),
      JSON.stringify({ version: 2, workflow_id: id, title: "", nodes: [], edges: [] }, null, 2) + "\n",
    );
    const now = new Date().toISOString();
    await writeMeta(id, { id, title: "Untitled project", created_at: now, last_active_at: now });
    await loadProject(projects, id);
    await writeActive(id);
  }
}
