// Bridge: paiAssetEvents.on("update") → canvas_mutator.updateNode patch.
//
// Replaces the .ark_cache.json sidecar. When an asset upload reaches a
// terminal Ark status (active / rejected), we mirror that state onto the
// owning canvas node's data.metadata, so the next viewer boot can
// reseed the in-process cache straight from workflow.json (see
// pai_assets_client.js → reseedFromCanvas).
//
// Ephemeral states (pending) are NOT persisted: the chip shows them via
// the live `ark-assets` socket event, and they resolve to a terminal
// state within ~10s of CreateAsset.
//
// Races handled:
//   - Node deleted between upload start and finish → mutator returns
//     not_found, we log + swallow. Asset_id is wasted but no crash.
//   - Project gone (unlikely; assets only fire while a project is
//     loaded) → we drop the event silently.
//   - Concurrent updates → mutator's PQueue serializes them per project.

import { mutate } from "../canvas_mutator.js";
import { paiAssetEvents } from "../pai_assets_client.js";
import { projectIdFromCanvasUrl } from "../lib/paths.js";

// Canonical asset URL form is /projects/<id>/assets/<bucket>/<filename>.
// Filenames are minted as `<node-id>.<ext>` by the mutator's
// applyTmpPathToNode, so the node id == basename without extension.
function nodeIdFromCanvasUrl(url) {
  const m = /\/projects\/[^/]+\/assets\/[^/]+\/([^/.]+)\.[^/]+$/.exec(String(url || ""));
  return m ? m[1] : null;
}

function buildPatch(evt, prevMetadata) {
  if (evt.status === "active") {
    const patch = { metadata: {} };
    const assetId = typeof evt.assetId === "string" ? evt.assetId : null;
    if (!assetId) return null;
    if (prevMetadata?.asset_id === assetId && !prevMetadata?.asset_rejected_reason) {
      return null; // already up-to-date
    }
    patch.metadata.asset_id = assetId;
    if (prevMetadata?.asset_rejected_reason) patch.metadata.asset_rejected_reason = null;
    return patch;
  }
  if (evt.status === "rejected") {
    const reason = typeof evt.reason === "string" && evt.reason ? evt.reason : "rejected";
    if (prevMetadata?.asset_rejected_reason === reason && !prevMetadata?.asset_id) {
      return null; // already up-to-date
    }
    const patch = { metadata: { asset_rejected_reason: reason } };
    if (prevMetadata?.asset_id) patch.metadata.asset_id = null;
    return patch;
  }
  return null;
}

export function wireAssetSync({ projects, mutatorHooks }) {
  paiAssetEvents.on("update", (evt) => {
    if (!evt?.url) return;
    if (evt.status !== "active" && evt.status !== "rejected") return;
    const projectId = projectIdFromCanvasUrl(evt.url);
    if (!projectId) return;
    const p = projects.get(projectId);
    if (!p) return;
    const nodeId = nodeIdFromCanvasUrl(evt.url);
    if (!nodeId) return;
    const node = p.canvasState?.nodes?.find?.((n) => n.id === nodeId);
    if (!node) return;
    const patch = buildPatch(evt, node.data?.metadata);
    if (!patch) return;
    const envelope = {
      request_id: `asset-sync-${projectId}-${nodeId}-${evt.status}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      op: "updateNode",
      payload: { id: nodeId, patch },
      ts: new Date().toISOString(),
      actor: "asset-sync",
    };
    mutate(p, envelope, mutatorHooks).catch((err) => {
      console.warn(`[asset-sync] mutator dispatch failed for ${projectId}/${nodeId}: ${err.message}`);
    });
  });
}
