import {
  requireAssetIntelligenceAuth,
  loadValidatedAsset,
  nowIso,
  deriveOrientation
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

export async function startVideoAnalysisSource(request, env, baseUrl) {
  const authError = requireAssetIntelligenceAuth(request, env);
  if (authError) return authError;

  if (!env.STREAM) {
    return json({ success: false, error: "Stream binding is not configured" }, 500);
  }

  if (!env.RENDER_ACCESS_TOKEN) {
    return json({ success: false, error: "Render access is not configured" }, 500);
  }

  const body = await readJson(request);
  const loaded = await loadValidatedAsset(env, body);
  if (loaded.response) return loaded.response;

  if (!["video/mp4", "video/quicktime"].includes(loaded.asset.mime_type)) {
    return json({ success: false, error: "Asset is not a supported video" }, 400);
  }

  const renderRequest = new Request(`${baseUrl}/api/assets/render-reference`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RENDER_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      asset_id: loaded.asset.asset_id,
      order_id: loaded.asset.order_id,
      job_id: loaded.asset.job_id,
      ttl_minutes: 120
    })
  });

  const renderResponse = await fetch(renderRequest);
  if (!renderResponse.ok) {
    return json({ success: false, error: "Unable to create temporary video source" }, 502);
  }

  const renderData = await renderResponse.json();

  const video = await env.STREAM.upload(renderData.temporary_https_url, {
    requireSignedURLs: true,
    creator: loaded.asset.customer_id || "make-you-stop",
    meta: {
      purpose: "asset-intelligence",
      asset_id: loaded.asset.asset_id,
      order_id: loaded.asset.order_id,
      job_id: loaded.asset.job_id
    }
  });

  return json({
    success: true,
    status: video.readyToStream ? "ready" : "pending",
    asset_id: loaded.asset.asset_id,
    analysis_job_id: video.id,
    source_fingerprint: loaded.sourceFingerprint
  });
}

function signedThumbnailFromDetails(details, providerId, token, seconds) {
  if (!details?.thumbnail) return null;

  const url = new URL(details.thumbnail);
  const marker = `/${providerId}/`;

  if (!url.pathname.includes(marker)) return null;

  url.pathname = url.pathname.replace(marker, `/${token}/`);
  url.searchParams.set("time", `${seconds.toFixed(3)}s`);
  url.searchParams.set("width", "1024");
  url.searchParams.set("height", "1024");
  url.searchParams.set("fit", "clip");

  return url.toString();
}

export async function videoAnalysisStatus(request, env, url) {
  const authError = requireAssetIntelligenceAuth(request, env);
  if (authError) return authError;

  if (!env.STREAM) {
    return json({ success: false, error: "Stream binding is not configured" }, 500);
  }

  const assetId = url.searchParams.get("asset_id") || "";
  const orderId = url.searchParams.get("order_id") || "";
  const jobId = url.searchParams.get("job_id") || "";
  const analysisJobId = url.searchParams.get("analysis_job_id") || "";
  const customerId = url.searchParams.get("customer_id") || "";
  const brandId = url.searchParams.get("brand_id") || "";

  const loaded = await loadValidatedAsset(env, {
    asset_id: assetId,
    order_id: orderId,
    job_id: jobId,
    customer_id: customerId,
    brand_id: brandId
  });

  if (loaded.response) return loaded.response;

  if (!safeId(analysisJobId)) {
    return json({ success: false, error: "Invalid analysis_job_id" }, 400);
  }

  let details;
  try {
    details = await env.STREAM.video(analysisJobId).details();
  } catch {
    return json({
      success: false,
      status: "failed",
      asset_id: assetId,
      error: "Stream video not found"
    }, 404);
  }

  if (!details.readyToStream) {
    const state = String(details.status?.state || "pending").toLowerCase();

    if (state === "error" || state === "failed") {
      return json({
        success: false,
        status: "failed",
        asset_id: assetId,
        error: "Stream processing failed"
      }, 422);
    }

    return json({
      success: true,
      status: "pending",
      asset_id: assetId
    });
  }

  const durationSeconds = Number(details.duration || 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return json({
      success: false,
      status: "failed",
      asset_id: assetId,
      error: "Stream duration unavailable"
    }, 422);
  }

  const durationMs = Math.max(1, Math.floor(durationSeconds * 1000));
  const percentages = [0.10, 0.50, 0.90];

  const positions = percentages.map((pct) =>
    Math.min(
      Math.max(Math.floor(durationMs * pct), 0),
      Math.max(0, durationMs - 1)
    )
  );

  const token = await env.STREAM.video(analysisJobId).generateToken();

  const frames = positions.map((positionMs, index) => ({
    position_ms: positionMs,
    percentage: percentages[index],
    url: signedThumbnailFromDetails(
      details,
      analysisJobId,
      token,
      positionMs / 1000
    )
  }));

  if (frames.some((frame) => !frame.url)) {
    return json({
      success: false,
      status: "failed",
      asset_id: assetId,
      error: "Stream thumbnail unavailable"
    }, 422);
  }

  const width = Number(details.input?.width || 0) || null;
  const height = Number(details.input?.height || 0) || null;

  return json({
    success: true,
    status: "ready",
    asset_id: assetId,
    analysis_job_id: analysisJobId,
    source_fingerprint: loaded.sourceFingerprint,
    duration_ms: durationMs,
    width,
    height,
    orientation: deriveOrientation(width, height),
    frames
  });
}

function cleanupDelaySeconds(attempt) {
  return [0, 60, 300, 1800, 21600][
    Math.min(Math.max(attempt - 1, 0), 4)
  ];
}

export async function cleanupVideoAnalysisSource(request, env) {
  const authError = requireAssetIntelligenceAuth(request, env);
  if (authError) return authError;

  if (!env.STREAM) {
    return json({ success: false, error: "Stream binding is not configured" }, 500);
  }

  const body = await readJson(request);
  const loaded = await loadValidatedAsset(env, body);
  if (loaded.response) return loaded.response;

  const providerId = body.analysis_job_id || body.analysis_provider_id;

  if (!safeId(providerId)) {
    return json({ success: false, error: "Invalid analysis job identifier" }, 400);
  }

  const existing = await env.DB.prepare(`
    SELECT cleanup_attempt_count
    FROM asset_intelligence
    WHERE asset_id = ?
  `).bind(loaded.asset.asset_id).first();

  const attempt = Number(existing?.cleanup_attempt_count || 0) + 1;

  try {
    await env.STREAM.video(providerId).delete();

    await env.DB.prepare(`
      UPDATE asset_intelligence
      SET
        cleanup_status='complete',
        cleanup_attempt_count=0,
        last_cleanup_error=NULL,
        next_cleanup_at=NULL,
        analysis_provider_id=NULL,
        updated_at=?
      WHERE asset_id=?
    `).bind(nowIso(), loaded.asset.asset_id).run();

    return json({
      success: true,
      cleanup_status: "complete",
      asset_id: loaded.asset.asset_id
    });
  } catch (error) {
    const message = String(error?.message || error || "").slice(0, 500);
    const notFound = /not.?found|404/i.test(message);

    if (notFound) {
      await env.DB.prepare(`
        UPDATE asset_intelligence
        SET
          cleanup_status='complete',
          cleanup_attempt_count=0,
          last_cleanup_error=NULL,
          next_cleanup_at=NULL,
          analysis_provider_id=NULL,
          updated_at=?
        WHERE asset_id=?
      `).bind(nowIso(), loaded.asset.asset_id).run();

      return json({
        success: true,
        cleanup_status: "complete",
        asset_id: loaded.asset.asset_id
      });
    }

    const delay = cleanupDelaySeconds(attempt);
    const nextCleanupAt = new Date(Date.now() + delay * 1000).toISOString();

    await env.DB.prepare(`
      UPDATE asset_intelligence
      SET
        cleanup_status='failed_retry',
        cleanup_attempt_count=?,
        last_cleanup_error=?,
        next_cleanup_at=?,
        analysis_provider_id=?,
        updated_at=?
      WHERE asset_id=?
    `).bind(
      attempt,
      message,
      nextCleanupAt,
      providerId,
      nowIso(),
      loaded.asset.asset_id
    ).run();

    return json({
      success: false,
      cleanup_status: "failed_retry",
      cleanup_attempt_count: attempt,
      next_cleanup_at: nextCleanupAt
    }, 502);
  }
}
