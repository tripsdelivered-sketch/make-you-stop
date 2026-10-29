import {
  requireAssetIntelligenceAuth,
  loadValidatedAsset,
  sha256Hex
} from "./asset_intelligence.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function writeDeliverableAssetProvenance(request, env) {
  const authError = requireAssetIntelligenceAuth(request, env);
  if (authError) return authError;

  const body = await readJson(request);
  const required = ["order_id", "job_id", "deliverable_id", "asset_id"];

  if (!body || required.some((field) => !safeId(body[field]))) {
    return json({ success: false, error: "Invalid provenance request" }, 400);
  }

  const loaded = await loadValidatedAsset(env, body);
  if (loaded.response) return loaded.response;

  const intelligence = await env.DB.prepare(`
    SELECT
      source_fingerprint,
      customer_id,
      brand_id,
      reuse_permission
    FROM asset_intelligence
    WHERE asset_id = ?
    LIMIT 1
  `).bind(body.asset_id).first();

  if (!intelligence || intelligence.source_fingerprint !== loaded.sourceFingerprint) {
    return json({
      success: false,
      error: "Verified current asset intelligence is required"
    }, 409);
  }

  const sceneNumber = Number(body.scene_number);
  if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
    return json({ success: false, error: "Invalid scene_number" }, 400);
  }

  const renderId =
    typeof body.render_id === "string" && body.render_id
      ? body.render_id.slice(0, 200)
      : "";

  const provenanceId = await sha256Hex([
    body.deliverable_id,
    renderId,
    sceneNumber,
    body.asset_id
  ].join("|"));

  await env.DB.prepare(`
    INSERT INTO deliverable_asset_provenance (
      provenance_id,
      order_id,
      job_id,
      deliverable_id,
      render_id,
      scene_number,
      asset_id,
      origin_order_id,
      origin_job_id,
      customer_id,
      brand_id,
      source_type,
      media_type,
      mime_type,
      source_fingerprint,
      reuse_permission,
      assignment_status,
      assignment_reason,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(provenance_id) DO UPDATE SET
      render_id=excluded.render_id,
      source_type=excluded.source_type,
      media_type=excluded.media_type,
      mime_type=excluded.mime_type,
      assignment_status=excluded.assignment_status,
      assignment_reason=excluded.assignment_reason
  `).bind(
    provenanceId,
    body.order_id,
    body.job_id,
    body.deliverable_id,
    renderId || null,
    sceneNumber,
    body.asset_id,
    loaded.asset.order_id,
    loaded.asset.job_id,
    loaded.asset.customer_id || intelligence.customer_id || null,
    loaded.asset.brand_id || intelligence.brand_id || null,
    typeof body.source_type === "string"
      ? body.source_type.slice(0, 50)
      : "supplied",
    typeof body.media_type === "string"
      ? body.media_type.slice(0, 50)
      : loaded.asset.mime_type.startsWith("video/")
        ? "video"
        : "image",
    loaded.asset.mime_type,
    loaded.sourceFingerprint,
    loaded.asset.reuse_permission,
    typeof body.assignment_status === "string"
      ? body.assignment_status.slice(0, 100)
      : null,
    typeof body.assignment_reason === "string"
      ? body.assignment_reason.slice(0, 500)
      : null
  ).run();

  return json({
    success: true,
    provenance_id: provenanceId
  });
}
