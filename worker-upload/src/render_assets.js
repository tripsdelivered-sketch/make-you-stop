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

function safeText(value, max = 500) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isAuthorized(request, env) {
  if (!env.RENDER_ACCESS_TOKEN) return false;
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${env.RENDER_ACCESS_TOKEN}`;
}

function requireAuthorized(request, env) {
  if (!env.RENDER_ACCESS_TOKEN) {
    return json({ success: false, error: "Render access token is not configured" }, 500);
  }
  if (!isAuthorized(request, env)) {
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

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const RENDERABLE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime"
]);

export async function createRenderAssetReference(request, env, baseUrl) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;


  const body = await readJson(request);
  if (!body || !safeId(body.asset_id) || !safeId(body.order_id) || !safeId(body.job_id)) {
    return json({ success: false, error: "Invalid asset render-reference request" }, 400);
  }

  const asset = await env.DB.prepare(`
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
      source_type
    FROM uploaded_assets
    WHERE asset_id = ?
    LIMIT 1
  `).bind(body.asset_id).first();

  if (!asset) {
    return json({ success: false, error: "Asset not found" }, 404);
  }

  const sameOrigin =
    asset.order_id === body.order_id &&
    asset.job_id === body.job_id;

  if (!sameOrigin) {
    if (asset.reuse_permission !== "same_brand_allowed") {
      return json({ success: false, error: "Asset is restricted to its origin order/job" }, 403);
    }

    if (
      !safeId(body.customer_id) ||
      !safeId(body.brand_id) ||
      !asset.customer_id ||
      !asset.brand_id ||
      asset.customer_id !== body.customer_id ||
      asset.brand_id !== body.brand_id
    ) {
      return json({ success: false, error: "Asset reuse boundary mismatch" }, 403);
    }

    const currentJob = await env.DB.prepare(`
      SELECT job_id
      FROM job_context
      WHERE job_id = ?
        AND order_id = ?
      LIMIT 1
    `).bind(body.job_id, body.order_id).first();

    if (!currentJob) {
      return json({ success: false, error: "Current reuse job is not valid" }, 403);
    }
  }

  const mimeType = typeof asset.mime_type === "string" ? asset.mime_type : "";
  if (!RENDERABLE_MIME_TYPES.has(mimeType)) {
    return json({ success: false, error: "Asset MIME type is not renderable" }, 400);
  }

  const object = await env.BUCKET.head(asset.r2_key);
  if (!object) {
    return json({ success: false, error: "Stored asset not found" }, 404);
  }

  let ttlMinutes = 60;
  if (body.ttl_minutes !== undefined && body.ttl_minutes !== null && body.ttl_minutes !== "") {
    const requestedTtl = Number(body.ttl_minutes);
    if (!Number.isFinite(requestedTtl)) {
      return json({ success: false, error: "ttl_minutes must be a finite number" }, 400);
    }
    ttlMinutes = Math.min(Math.max(requestedTtl, 10), 360);
  }
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(`
    INSERT INTO render_asset_tokens (
      token_hash,
      asset_id,
      order_id,
      job_id,
      r2_key,
      mime_type,
      size_bytes,
      display_name,
      active,
      created_at,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)
  `).bind(
    tokenHash,
    asset.asset_id,
    body.order_id,
    body.job_id,
    asset.r2_key,
    mimeType,
    Number(object.size || asset.size_bytes || 0) || null,
    typeof asset.original_name === "string" ? asset.original_name.slice(0, 300) : null,
    expiresAt
  ).run();

  return json({
    success: true,
    asset_id: asset.asset_id,
    temporary_https_url: `${baseUrl}/render-asset/${token}`,
    expires_at: expiresAt,
    mime_type: mimeType,
    size_bytes: Number(object.size || asset.size_bytes || 0) || null,
    width: null,
    height: null,
    duration_ms: null
  });
}

function parseSingleRange(value, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((value || "").trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };

  let start;
  let end;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(totalSize - suffix, 0);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalSize - 1;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start >= totalSize
    ) {
      return { invalid: true };
    }
    end = Math.min(end, totalSize - 1);
  }

  return { start, end, length: end - start + 1 };
}

export async function serveRenderAsset(request, env, token) {
  if (!safeText(token, 200)) {
    return json({ success: false, error: "Invalid render asset link" }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`
    SELECT
      asset_id,
      r2_key,
      mime_type,
      size_bytes,
      display_name,
      expires_at
    FROM render_asset_tokens
    WHERE token_hash = ?
      AND active = 1
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row) {
    return json({ success: false, error: "Render asset link not found" }, 404);
  }

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return json({ success: false, error: "Render asset link expired" }, 410);
  }

  const head = await env.BUCKET.head(row.r2_key);
  if (!head) {
    return json({ success: false, error: "Stored asset not found" }, 404);
  }

  const totalSize = Number(head.size || row.size_bytes || 0);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Content-Type",
    row.mime_type || headers.get("Content-Type") || "application/octet-stream"
  );

  const name = (row.display_name || row.asset_id || "asset").replace(/["\r\n]/g, "");
  headers.set("Content-Disposition", `inline; filename="${name}"`);

  if (request.method === "HEAD") {
    if (totalSize > 0) headers.set("Content-Length", String(totalSize));
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader && totalSize > 0) {
    const range = parseSingleRange(rangeHeader, totalSize);

    if (range.invalid) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${totalSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store"
        }
      });
    }

    const object = await env.BUCKET.get(row.r2_key, {
      range: { offset: range.start, length: range.length }
    });

    if (!object) {
      return json({ success: false, error: "Stored asset not found" }, 404);
    }

    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalSize}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await env.BUCKET.get(row.r2_key);
  if (!object) {
    return json({ success: false, error: "Stored asset not found" }, 404);
  }

  if (totalSize > 0) headers.set("Content-Length", String(totalSize));
  return new Response(object.body, { status: 200, headers });
}
