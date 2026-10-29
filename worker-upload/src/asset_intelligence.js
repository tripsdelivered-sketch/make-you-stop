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

function authorized(request, env) {
  const expected = env.ASSET_INTELLIGENCE_TOKEN;
  const supplied = request.headers.get("Authorization") || "";
  return Boolean(expected) && supplied === `Bearer ${expected}`;
}

export function requireAssetIntelligenceAuth(request, env) {
  if (!env.ASSET_INTELLIGENCE_TOKEN) {
    return json({ success: false, error: "Asset intelligence access is not configured" }, 500);
  }
  if (!authorized(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  return null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function nowIso() {
  return new Date().toISOString();
}

export function deriveOrientation(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!w || !h) return "unknown";
  if (h > w) return "portrait";
  if (w > h) return "landscape";
  return "square";
}

const ALLOWED_MEDIA = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime"
]);

const ALLOWED_ANALYSIS_STATUS = new Set(["complete", "uncertain", "failed"]);
const ALLOWED_CLEANUP_STATUS = new Set(["not_required", "pending", "complete", "failed_retry"]);
const ALLOWED_ASSET_ROLES = new Set([
  "product",
  "packaging",
  "lifestyle",
  "detail",
  "demo",
  "ugc",
  "unknown"
]);
const ALLOWED_SUBJECT_TYPES = new Set([
  "person",
  "product",
  "object",
  "environment",
  "open_space",
  "unknown"
]);

async function loadAsset(env, assetId) {
  return env.DB.prepare(`
    SELECT
      asset_id,
      order_id,
      job_id,
      customer_id,
      brand_id,
      original_name,
      r2_key,
      mime_type,
      size_bytes,
      reuse_permission,
      source_type,
      created_at
    FROM uploaded_assets
    WHERE asset_id = ?
    LIMIT 1
  `).bind(assetId).first();
}

function sameValue(a, b) {
  return String(a || "") === String(b || "");
}

function validateBoundary(asset, body) {
  if (!asset) {
    return { ok: false, status: 404, error: "Asset not found" };
  }

  const sameOrigin =
    sameValue(body.order_id, asset.order_id) &&
    sameValue(body.job_id, asset.job_id);

  if (sameOrigin) {
    return { ok: true, reused: false };
  }

  if (asset.reuse_permission !== "same_brand_allowed") {
    return { ok: false, status: 403, error: "Asset is restricted to its origin order/job" };
  }

  if (!body.customer_id || !body.brand_id || !asset.customer_id || !asset.brand_id) {
    return { ok: false, status: 403, error: "Reusable asset requires customer and brand identity" };
  }

  if (
    !sameValue(body.customer_id, asset.customer_id) ||
    !sameValue(body.brand_id, asset.brand_id)
  ) {
    return { ok: false, status: 403, error: "Asset reuse boundary mismatch" };
  }

  return { ok: true, reused: true };
}

async function fingerprintFor(asset, object) {
  const uploaded =
    object?.uploaded instanceof Date
      ? object.uploaded.toISOString()
      : String(object?.uploaded || asset.created_at || "");

  const identity = [
    asset.asset_id,
    asset.r2_key,
    asset.mime_type,
    Number(object?.size || asset.size_bytes || 0),
    object?.etag || object?.version || "",
    uploaded
  ].join("|");

  return `sha256:${await sha256Hex(identity)}`;
}

export async function loadValidatedAsset(env, body) {
  if (!body || !safeId(body.asset_id) || !safeId(body.order_id) || !safeId(body.job_id)) {
    return { response: json({ success: false, error: "Invalid asset request" }, 400) };
  }

  const asset = await loadAsset(env, body.asset_id);
  const boundary = validateBoundary(asset, body);

  if (!boundary.ok) {
    return { response: json({ success: false, error: boundary.error }, boundary.status) };
  }

  if (!ALLOWED_MEDIA.has(asset.mime_type)) {
    return { response: json({ success: false, error: "Unsupported asset MIME type" }, 400) };
  }

  const object = await env.BUCKET.head(asset.r2_key);
  if (!object) {
    return { response: json({ success: false, error: "Stored asset not found" }, 404) };
  }

  const sourceFingerprint = await fingerprintFor(asset, object);
  return {
    asset,
    object,
    sourceFingerprint,
    reused: boundary.reused
  };
}

function parseTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function intelligencePayload(row) {
  if (!row) return null;

  return {
    asset_id: row.asset_id,
    origin_order_id: row.origin_order_id,
    origin_job_id: row.origin_job_id,
    customer_id: row.customer_id,
    brand_id: row.brand_id,
    reuse_permission: row.reuse_permission,
    source_fingerprint: row.source_fingerprint,
    media_type: row.media_type,
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    duration_ms: row.duration_ms,
    product_or_subject_id: row.product_or_subject_id,
    asset_role: row.asset_role,
    subject_type: row.subject_type,
    asset_tags: parseTags(row.asset_tags_json),
    analysis_status: row.analysis_status,
    analysis_confidence: row.analysis_confidence,
    analysis_version: row.analysis_version,
    analyzed_at: row.analyzed_at,
    cleanup_status: row.cleanup_status,
    cleanup_attempt_count: row.cleanup_attempt_count,
    next_cleanup_at: row.next_cleanup_at
  };
}

export async function ensureAssetIntelligence(request, env) {
  const authError = requireAssetIntelligenceAuth(request, env);
  if (authError) return authError;

  const body = await readJson(request);
  const loaded = await loadValidatedAsset(env, body);
  if (loaded.response) return loaded.response;

  const row = await env.DB.prepare(`
    SELECT *
    FROM asset_intelligence
    WHERE asset_id = ?
    LIMIT 1
  `).bind(loaded.asset.asset_id).first();

  if (
    row &&
    row.source_fingerprint === loaded.sourceFingerprint &&
    (row.analysis_status === "complete" || row.analysis_status === "uncertain")
  ) {
    return json({
      success: true,
      status: "ready",
      asset_id: loaded.asset.asset_id,
      source_fingerprint: loaded.sourceFingerprint,
      intelligence: intelligencePayload(row)
    });
  }

  return json({
    success: true,
    status: "needs_analysis",
    asset_id: loaded.asset.asset_id,
    source_fingerprint: loaded.sourceFingerprint,
    media_type: loaded.asset.mime_type.startsWith("video/") ? "video" : "image",
    mime_type: loaded.asset.mime_type,
    size_bytes: Number(loaded.object.size || loaded.asset.size_bytes || 0) || null
  });
}

export async function upsertAssetIntelligence(request, env) {
  const authError = requireAssetIntelligenceAuth(request, env);
  if (authError) return authError;

  const body = await readJson(request);
  const loaded = await loadValidatedAsset(env, body);
  if (loaded.response) return loaded.response;

  if (body.source_fingerprint !== loaded.sourceFingerprint) {
    return json({ success: false, error: "Source fingerprint is stale" }, 409);
  }

  if (!ALLOWED_ANALYSIS_STATUS.has(body.analysis_status)) {
    return json({ success: false, error: "Invalid analysis_status" }, 400);
  }

  const role = body.asset_role == null ? "unknown" : String(body.asset_role);
  const subject = body.subject_type == null ? "unknown" : String(body.subject_type);

  if (!ALLOWED_ASSET_ROLES.has(role) || !ALLOWED_SUBJECT_TYPES.has(subject)) {
    return json({ success: false, error: "Invalid controlled classification" }, 400);
  }

  const tags = Array.isArray(body.asset_tags)
    ? body.asset_tags
        .filter((v) => typeof v === "string" && v.length <= 100)
        .slice(0, 25)
    : [];

  const mediaType = loaded.asset.mime_type.startsWith("video/") ? "video" : "image";
  const width = Number.isFinite(Number(body.width)) ? Number(body.width) : null;
  const height = Number.isFinite(Number(body.height)) ? Number(body.height) : null;
  const durationMs =
    mediaType === "video" && Number.isFinite(Number(body.duration_ms))
      ? Number(body.duration_ms)
      : null;

  const cleanupStatus = ALLOWED_CLEANUP_STATUS.has(body.cleanup_status)
    ? body.cleanup_status
    : mediaType === "video" && body.analysis_provider_id
      ? "pending"
      : "not_required";

  const analyzedAt =
    typeof body.analyzed_at === "string" && body.analyzed_at
      ? body.analyzed_at
      : nowIso();

  const analysisVersion =
    typeof body.analysis_version === "string" && body.analysis_version
      ? body.analysis_version.slice(0, 100)
      : "asset-intelligence-v1";

  await env.DB.prepare(`
    INSERT INTO asset_intelligence (
      asset_id,
      origin_order_id,
      origin_job_id,
      customer_id,
      brand_id,
      reuse_permission,
      source_fingerprint,
      media_type,
      width,
      height,
      orientation,
      duration_ms,
      product_or_subject_id,
      asset_role,
      subject_type,
      asset_tags_json,
      analysis_status,
      analysis_confidence,
      analysis_version,
      analyzed_at,
      cleanup_status,
      cleanup_attempt_count,
      last_cleanup_error,
      next_cleanup_at,
      analysis_provider_id,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      origin_order_id = excluded.origin_order_id,
      origin_job_id = excluded.origin_job_id,
      customer_id = excluded.customer_id,
      brand_id = excluded.brand_id,
      reuse_permission = excluded.reuse_permission,
      source_fingerprint = excluded.source_fingerprint,
      media_type = excluded.media_type,
      width = excluded.width,
      height = excluded.height,
      orientation = excluded.orientation,
      duration_ms = excluded.duration_ms,
      product_or_subject_id = excluded.product_or_subject_id,
      asset_role = excluded.asset_role,
      subject_type = excluded.subject_type,
      asset_tags_json = excluded.asset_tags_json,
      analysis_status = excluded.analysis_status,
      analysis_confidence = excluded.analysis_confidence,
      analysis_version = excluded.analysis_version,
      analyzed_at = excluded.analyzed_at,
      cleanup_status = excluded.cleanup_status,
      cleanup_attempt_count = 0,
      last_cleanup_error = NULL,
      next_cleanup_at = NULL,
      analysis_provider_id = excluded.analysis_provider_id,
      updated_at = excluded.updated_at
  `).bind(
    loaded.asset.asset_id,
    loaded.asset.order_id,
    loaded.asset.job_id,
    loaded.asset.customer_id || body.customer_id || null,
    loaded.asset.brand_id || body.brand_id || null,
    loaded.asset.reuse_permission,
    loaded.sourceFingerprint,
    mediaType,
    width,
    height,
    deriveOrientation(width, height),
    durationMs,
    body.product_or_subject_id || null,
    role,
    subject,
    JSON.stringify(tags),
    body.analysis_status,
    Number.isFinite(Number(body.analysis_confidence))
      ? Number(body.analysis_confidence)
      : null,
    analysisVersion,
    analyzedAt,
    cleanupStatus,
    body.analysis_provider_id || null,
    nowIso()
  ).run();

  const stored = await env.DB.prepare(`
    SELECT *
    FROM asset_intelligence
    WHERE asset_id = ?
  `).bind(loaded.asset.asset_id).first();

  return json({
    success: true,
    status: "ready",
    intelligence: intelligencePayload(stored)
  });
}
