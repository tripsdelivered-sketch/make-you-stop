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

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function requireAuthorized(request, env) {
  const supplied = bearer(request);
  const accepted = [env.ASSET_INTELLIGENCE_TOKEN, env.UPLOAD_SECRET, env.RENDER_ACCESS_TOKEN]
    .filter((value) => typeof value === "string" && value.length > 0);
  if (!accepted.length) return json({ success: false, error: "Asset intelligence authentication is not configured" }, 500);
  if (!accepted.includes(supplied)) return json({ success: false, error: "Unauthorized" }, 401);
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureTables(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS asset_intelligence_v1 (
      asset_id TEXT PRIMARY KEY,
      origin_order_id TEXT NOT NULL,
      origin_job_id TEXT NOT NULL,
      customer_id TEXT,
      brand_id TEXT,
      reuse_permission TEXT NOT NULL DEFAULT 'current_order_only',
      source_fingerprint TEXT NOT NULL,
      media_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      orientation TEXT,
      duration_ms INTEGER,
      product_or_subject_id TEXT,
      asset_role TEXT,
      subject_type TEXT,
      asset_tags_json TEXT,
      analysis_status TEXT NOT NULL DEFAULT 'pending',
      analysis_confidence REAL,
      analysis_version TEXT,
      analysis_provider_id TEXT,
      analyzed_at TEXT,
      cleanup_status TEXT,
      cleanup_attempt_count INTEGER NOT NULL DEFAULT 0,
      next_cleanup_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_asset_intelligence_v1_brand ON asset_intelligence_v1(brand_id, analysis_status)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS asset_analysis_sources_v1 (
      analysis_job_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      customer_id TEXT,
      brand_id TEXT,
      source_fingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cleaned_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_asset_analysis_sources_v1_asset ON asset_analysis_sources_v1(asset_id, created_at)")
  ]);
}

async function getAsset(env, body) {
  if (!body || !safeId(body.asset_id) || !safeId(body.order_id) || !safeId(body.job_id)) return null;
  const asset = await env.DB.prepare(`
    SELECT asset_id, order_id, job_id, customer_id, brand_id, original_name, r2_key,
           mime_type, size_bytes, reuse_permission, source_type
    FROM uploaded_assets
    WHERE asset_id=? AND order_id=? AND job_id=?
    LIMIT 1
  `).bind(body.asset_id, body.order_id, body.job_id).first();
  if (!asset) return null;
  if (body.customer_id && asset.customer_id && body.customer_id !== asset.customer_id) return null;
  if (body.brand_id && asset.brand_id && body.brand_id !== asset.brand_id) return null;
  return asset;
}

async function fingerprint(env, asset) {
  const cached = await env.DB.prepare("SELECT source_fingerprint FROM asset_intelligence_v1 WHERE asset_id=?").bind(asset.asset_id).first();
  if (cached?.source_fingerprint) return cached.source_fingerprint;
  const object = await env.BUCKET.get(asset.r2_key);
  if (!object) throw new Error("Stored asset not found");
  const bytes = await object.arrayBuffer();
  return "sha256:" + await sha256Hex(bytes);
}

function mediaType(mime) {
  if (String(mime || "").startsWith("image/")) return "image";
  if (String(mime || "").startsWith("video/")) return "video";
  return "unsupported";
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { return []; }
  }
  return [];
}

function intelligenceFromRow(row) {
  if (!row) return null;
  return {
    asset_id: row.asset_id,
    origin_order_id: row.origin_order_id,
    origin_job_id: row.origin_job_id,
    customer_id: row.customer_id || null,
    brand_id: row.brand_id || null,
    reuse_permission: row.reuse_permission,
    source_fingerprint: row.source_fingerprint,
    media_type: row.media_type,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    orientation: row.orientation || "unknown",
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    product_or_subject_id: row.product_or_subject_id || null,
    asset_role: row.asset_role || null,
    subject_type: row.subject_type || null,
    asset_tags: parseTags(row.asset_tags_json),
    analysis_status: row.analysis_status,
    analysis_confidence: row.analysis_confidence == null ? null : Number(row.analysis_confidence),
    analysis_version: row.analysis_version || null,
    analyzed_at: row.analyzed_at || null,
    cleanup_status: row.cleanup_status || null,
    cleanup_attempt_count: Number(row.cleanup_attempt_count || 0),
    next_cleanup_at: row.next_cleanup_at || null
  };
}

export async function ensureAssetIntelligence(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureTables(env);
  const body = await readJson(request);
  const asset = await getAsset(env, body);
  if (!asset) return json({ success: false, error: "Asset does not belong to this order/job identity" }, 404);

  const existing = await env.DB.prepare("SELECT * FROM asset_intelligence_v1 WHERE asset_id=?").bind(asset.asset_id).first();
  if (existing?.analysis_status === "complete") {
    return json({
      success: true,
      status: "ready",
      asset_id: asset.asset_id,
      source_fingerprint: existing.source_fingerprint,
      intelligence: intelligenceFromRow(existing)
    });
  }

  const sourceFingerprint = existing?.source_fingerprint || await fingerprint(env, asset);
  const type = mediaType(asset.mime_type);
  if (type === "unsupported") {
    return json({ success: true, status: "unsupported", asset_id: asset.asset_id, source_fingerprint: sourceFingerprint });
  }

  await env.DB.prepare(`
    INSERT INTO asset_intelligence_v1 (
      asset_id, origin_order_id, origin_job_id, customer_id, brand_id, reuse_permission,
      source_fingerprint, media_type, analysis_status, cleanup_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))
    ON CONFLICT(asset_id) DO UPDATE SET
      origin_order_id=excluded.origin_order_id,
      origin_job_id=excluded.origin_job_id,
      customer_id=excluded.customer_id,
      brand_id=excluded.brand_id,
      reuse_permission=excluded.reuse_permission,
      source_fingerprint=excluded.source_fingerprint,
      media_type=excluded.media_type,
      updated_at=datetime('now')
  `).bind(
    asset.asset_id, asset.order_id, asset.job_id, asset.customer_id || null, asset.brand_id || null,
    asset.reuse_permission, sourceFingerprint, type, type === "image" ? "not_required" : "pending"
  ).run();

  return json({
    success: true,
    status: "pending",
    asset_id: asset.asset_id,
    source_fingerprint: sourceFingerprint,
    media_type: type
  });
}

export async function upsertAssetIntelligence(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureTables(env);
  const body = await readJson(request);
  const asset = await getAsset(env, body);
  if (!asset) return json({ success: false, error: "Asset does not belong to this order/job identity" }, 404);

  const sourceFingerprint = typeof body.source_fingerprint === "string" && body.source_fingerprint
    ? body.source_fingerprint
    : await fingerprint(env, asset);
  const type = body.media_type === "video" || body.media_type === "image" ? body.media_type : mediaType(asset.mime_type);
  const tags = Array.isArray(body.asset_tags) ? body.asset_tags.map(String) : [];

  await env.DB.prepare(`
    INSERT INTO asset_intelligence_v1 (
      asset_id, origin_order_id, origin_job_id, customer_id, brand_id, reuse_permission,
      source_fingerprint, media_type, width, height, orientation, duration_ms,
      product_or_subject_id, asset_role, subject_type, asset_tags_json, analysis_status,
      analysis_confidence, analysis_version, analysis_provider_id, analyzed_at,
      cleanup_status, cleanup_attempt_count, next_cleanup_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(asset_id) DO UPDATE SET
      origin_order_id=excluded.origin_order_id,
      origin_job_id=excluded.origin_job_id,
      customer_id=excluded.customer_id,
      brand_id=excluded.brand_id,
      reuse_permission=excluded.reuse_permission,
      source_fingerprint=excluded.source_fingerprint,
      media_type=excluded.media_type,
      width=excluded.width,
      height=excluded.height,
      orientation=excluded.orientation,
      duration_ms=excluded.duration_ms,
      product_or_subject_id=excluded.product_or_subject_id,
      asset_role=excluded.asset_role,
      subject_type=excluded.subject_type,
      asset_tags_json=excluded.asset_tags_json,
      analysis_status=excluded.analysis_status,
      analysis_confidence=excluded.analysis_confidence,
      analysis_version=excluded.analysis_version,
      analysis_provider_id=excluded.analysis_provider_id,
      analyzed_at=excluded.analyzed_at,
      cleanup_status=excluded.cleanup_status,
      updated_at=datetime('now')
  `).bind(
    asset.asset_id, asset.order_id, asset.job_id, asset.customer_id || null, asset.brand_id || null,
    body.reuse_permission || asset.reuse_permission, sourceFingerprint, type,
    body.width == null ? null : Number(body.width),
    body.height == null ? null : Number(body.height),
    body.orientation || null,
    body.duration_ms == null ? null : Number(body.duration_ms),
    body.product_or_subject_id || null,
    body.asset_role || null,
    body.subject_type || null,
    JSON.stringify(tags),
    body.analysis_status || "complete",
    body.analysis_confidence == null ? null : Number(body.analysis_confidence),
    body.analysis_version || "asset-intelligence-v1",
    body.analysis_provider_id || null,
    body.analyzed_at || new Date().toISOString(),
    body.cleanup_status || (type === "video" ? "pending" : "not_required")
  ).run();

  const row = await env.DB.prepare("SELECT * FROM asset_intelligence_v1 WHERE asset_id=?").bind(asset.asset_id).first();
  return json({ success: true, status: "ready", intelligence: intelligenceFromRow(row) });
}

async function createTemporaryAssetUrl(env, asset, baseUrl, ttlMinutes = 120) {
  const object = await env.BUCKET.head(asset.r2_key);
  if (!object) throw new Error("Stored asset not found");
  const token = randomToken();
  const tokenHash = await sha256Hex(new TextEncoder().encode(token));
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO render_asset_tokens (
      token_hash, asset_id, order_id, job_id, r2_key, mime_type, size_bytes,
      display_name, active, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)
  `).bind(
    tokenHash, asset.asset_id, asset.order_id, asset.job_id, asset.r2_key, asset.mime_type,
    Number(object.size || asset.size_bytes || 0) || null, asset.original_name || null, expiresAt
  ).run();
  return `${baseUrl}/render-asset/${token}`;
}

export async function createVideoAnalysisSource(request, env, baseUrl) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!env.STREAM) return json({ success: false, error: "Stream binding is not configured" }, 500);
  const body = await readJson(request);
  const asset = await getAsset(env, body);
  if (!asset) return json({ success: false, error: "Asset does not belong to this order/job identity" }, 404);
  if (mediaType(asset.mime_type) !== "video") return json({ success: false, error: "Asset is not a video" }, 400);

  const sourceFingerprint = await fingerprint(env, asset);
  const existing = await env.DB.prepare(`
    SELECT analysis_job_id, status FROM asset_analysis_sources_v1
    WHERE asset_id=? AND cleaned_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).bind(asset.asset_id).first();
  if (existing?.analysis_job_id) {
    return json({
      success: true,
      status: existing.status === "ready" ? "ready" : "pending",
      asset_id: asset.asset_id,
      analysis_job_id: existing.analysis_job_id,
      source_fingerprint: sourceFingerprint
    });
  }

  const url = await createTemporaryAssetUrl(env, asset, baseUrl, 120);
  const video = await env.STREAM.upload(url, {
    creator: "make-you-stop",
    meta: { asset_id: asset.asset_id, order_id: asset.order_id, job_id: asset.job_id },
    requireSignedURLs: false
  });
  const analysisJobId = video.id || video.uid;
  if (!analysisJobId) throw new Error("Stream upload returned no video id");

  await env.DB.prepare(`
    INSERT INTO asset_analysis_sources_v1 (
      analysis_job_id, asset_id, order_id, job_id, customer_id, brand_id,
      source_fingerprint, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).bind(
    analysisJobId, asset.asset_id, asset.order_id, asset.job_id,
    asset.customer_id || null, asset.brand_id || null, sourceFingerprint
  ).run();

  return json({
    success: true,
    status: "pending",
    asset_id: asset.asset_id,
    analysis_job_id: analysisJobId,
    source_fingerprint: sourceFingerprint
  });
}

function orientation(width, height) {
  if (!width || !height) return "unknown";
  if (height > width) return "portrait";
  if (width > height) return "landscape";
  return "square";
}

function thumbnailAt(thumbnail, seconds) {
  if (!thumbnail) return null;
  const base = String(thumbnail).split("?")[0];
  return `${base}?time=${Math.max(seconds, 0).toFixed(3)}s&height=720`;
}

export async function videoAnalysisStatus(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!env.STREAM) return json({ success: false, error: "Stream binding is not configured" }, 500);

  const url = new URL(request.url);
  const assetId = url.searchParams.get("asset_id");
  const orderId = url.searchParams.get("order_id");
  const jobId = url.searchParams.get("job_id");
  const customerId = url.searchParams.get("customer_id");
  const brandId = url.searchParams.get("brand_id");
  let analysisJobId = url.searchParams.get("analysis_job_id");

  if (!safeId(assetId) || !safeId(orderId)) return json({ success: false, error: "Invalid asset_id or order_id" }, 400);

  if (!analysisJobId) {
    const row = await env.DB.prepare(`
      SELECT analysis_job_id FROM asset_analysis_sources_v1
      WHERE asset_id=? AND order_id=? AND cleaned_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).bind(assetId, orderId).first();
    analysisJobId = row?.analysis_job_id || null;
  }
  if (!analysisJobId) return json({ success: false, error: "Video analysis source not found" }, 404);

  const sourceRow = await env.DB.prepare("SELECT * FROM asset_analysis_sources_v1 WHERE analysis_job_id=?").bind(analysisJobId).first();
  if (!sourceRow) return json({ success: false, error: "Video analysis source not found" }, 404);
  if (jobId && sourceRow.job_id !== jobId) return json({ success: false, error: "Job identity mismatch" }, 403);
  if (customerId && sourceRow.customer_id && sourceRow.customer_id !== customerId) return json({ success: false, error: "Customer identity mismatch" }, 403);
  if (brandId && sourceRow.brand_id && sourceRow.brand_id !== brandId) return json({ success: false, error: "Brand identity mismatch" }, 403);

  const details = await env.STREAM.video(analysisJobId).details();
  const ready = details.readyToStream === true || details.status?.state === "ready";
  if (!ready) {
    return json({ success: true, status: "pending", asset_id: assetId, analysis_job_id: analysisJobId });
  }

  const durationSeconds = Number(details.duration || 0);
  const durationMs = durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null;
  const width = Number(details.input?.width || 0) || null;
  const height = Number(details.input?.height || 0) || null;
  const positions = durationSeconds > 0 ? [0.1, 0.5, 0.9] : [];
  const frames = positions.map((percentage) => ({
    position_ms: Math.round(durationSeconds * percentage * 1000),
    percentage,
    url: thumbnailAt(details.thumbnail, durationSeconds * percentage)
  })).filter((frame) => frame.url);

  await env.DB.prepare("UPDATE asset_analysis_sources_v1 SET status='ready' WHERE analysis_job_id=?").bind(analysisJobId).run();

  return json({
    success: true,
    status: "ready",
    asset_id: assetId,
    analysis_job_id: analysisJobId,
    source_fingerprint: sourceRow.source_fingerprint,
    duration_ms: durationMs,
    width,
    height,
    orientation: orientation(width, height),
    frames
  });
}

export async function cleanupVideoAnalysisSource(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!env.STREAM) return json({ success: false, error: "Stream binding is not configured" }, 500);
  const body = await readJson(request);
  if (!body || !safeId(body.asset_id) || !safeId(body.order_id)) return json({ success: false, error: "Invalid cleanup request" }, 400);

  let analysisJobId = safeId(body.analysis_job_id) ? body.analysis_job_id : null;
  if (!analysisJobId) {
    const row = await env.DB.prepare(`
      SELECT analysis_job_id FROM asset_analysis_sources_v1
      WHERE asset_id=? AND order_id=? AND cleaned_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).bind(body.asset_id, body.order_id).first();
    analysisJobId = row?.analysis_job_id || null;
  }
  if (!analysisJobId) return json({ success: true, cleanup_status: "complete", asset_id: body.asset_id });

  try {
    await env.STREAM.video(analysisJobId).delete();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found/i.test(message)) throw error;
  }

  await env.DB.prepare("UPDATE asset_analysis_sources_v1 SET status='cleaned', cleaned_at=datetime('now') WHERE analysis_job_id=?").bind(analysisJobId).run();
  await env.DB.prepare(`
    UPDATE asset_intelligence_v1
    SET cleanup_status='complete', cleanup_attempt_count=cleanup_attempt_count+1,
        next_cleanup_at=NULL, updated_at=datetime('now')
    WHERE asset_id=?
  `).bind(body.asset_id).run();

  return json({ success: true, cleanup_status: "complete", asset_id: body.asset_id });
}
