import { resolveProduct, upsertStripeProductMapping, expandOrder, createIntakeToken, resolveIntakeToken, submitIntake, jobContext, readyJobs, commerceStatus } from "./commerce_orchestration.js";
import { canvaStatus, canvaAuthStart, canvaCallback, canvaCreateDesign, canvaBrandTemplates, canvaTemplateDataset, canvaAutofill, canvaExport, canvaExportStatus, canvaExportWait, canvaExportStore } from "./canva_bridge.js";
import { registerVisual, markVisualUsed, visualCandidates, recentVisualUsage } from "./visual_memory.js";
import { createUploadSession, uploadPage, uploadFile, orderAssets } from "./customer_uploads.js";
import { createRenderAssetReference, serveRenderAsset } from "./render_assets.js";
import { ensureAssetIntelligence, upsertAssetIntelligence } from "./asset_intelligence.js";
import { startVideoAnalysisSource, videoAnalysisStatus, cleanupVideoAnalysisSource } from "./asset_video_analysis.js";
import { writeDeliverableAssetProvenance } from "./deliverable_asset_provenance.js";

const BUCKET_NAME = "make-you-stop-deliverables";
const MAX_KEY_LENGTH = 512;
const RETURN_BASE = "https://make-you-stop-upload.tripsdelivered.workers.dev";
const SHOP_BASE = "https://makeyoustop.com";

const FILE_RULES = {
  guides: { extensions: ["pdf"], mime: ["application/pdf"] },
  images: { extensions: ["png", "jpg", "jpeg", "webp"], mime: ["image/png", "image/jpeg", "image/webp"] },
  videos: { extensions: ["mp4"], mime: ["video/mp4"] },
  storyboards: { extensions: ["pdf"], mime: ["application/pdf"] },
  showcases: { extensions: ["pdf", "png", "jpg", "jpeg", "webp"], mime: ["application/pdf", "image/png", "image/jpeg", "image/webp"] },
  canva: { extensions: ["pdf", "png", "jpg", "jpeg", "gif", "pptx", "mp4", "zip", "html"], mime: ["application/pdf", "image/png", "image/jpeg", "image/gif", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "video/mp4", "application/zip", "text/html", "application/octet-stream"] }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer"
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
  if (!env.UPLOAD_SECRET) return false;
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${env.UPLOAD_SECRET}`;
}

function requireAuthorized(request, env) {
  if (!env.UPLOAD_SECRET) {
    return json({ success: false, error: "Upload secret is not configured" }, 500);
  }
  if (!isAuthorized(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  return null;
}

function parseObjectKey(key) {
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  if (key.includes("\\") || key.includes("\u0000") || key.includes("//") || key.includes("..")) return null;

  const parts = key.split("/");
  if (parts.length !== 4) return null;

  const [kind, orderId, jobId, fileName] = parts;
  const rule = FILE_RULES[kind];
  if (!rule || !safeId(orderId) || !safeId(jobId)) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(fileName)) return null;

  const ext = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  if (!rule.extensions.includes(ext)) return null;

  return { kind, orderId, jobId, fileName, rule };
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
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isoAfterDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function ensureSupportTables(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS deliverable_components (
        component_id TEXT PRIMARY KEY,
        deliverable_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        job_id TEXT,
        component_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        content_text TEXT,
        content_json TEXT,
        r2_key TEXT,
        mime_type TEXT,
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_deliverable_components_order
      ON deliverable_components(order_id)
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_deliverable_components_deliverable
      ON deliverable_components(deliverable_id)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS return_tokens (
        token_hash TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        customer_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_return_tokens_order
      ON return_tokens(order_id)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS download_tokens (
        token_hash TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        display_name TEXT,
        mime_type TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_download_tokens_order
      ON download_tokens(order_id)
    `)
  ]);
}

async function recountOrder(env, orderId) {
  const countRow = await env.DB.prepare(`
    SELECT COUNT(DISTINCT deliverable_id) AS completed_deliverables
    FROM deliverables
    WHERE order_id = ?
      AND status = 'completed'
  `).bind(orderId).first();

  const completed = Number(countRow?.completed_deliverables || 0);

  await env.DB.prepare(`
    UPDATE orders
    SET
      completed_deliverables = ?,
      status = CASE
        WHEN status = 'complete' THEN 'complete'
        WHEN ? >= expected_deliverables THEN 'complete'
        ELSE 'in_progress'
      END,
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(completed, completed, orderId).run();

  const order = await env.DB.prepare(`
    SELECT
      order_id,
      completed_deliverables,
      expected_deliverables,
      status,
      delivery_email_sent_at
    FROM orders
    WHERE order_id = ?
  `).bind(orderId).first();

  return order || null;
}

async function markNormalizedJobComplete(env, jobId) {
  if (!jobId || !safeId(jobId) || !env.DB) return;

  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='job_context'"
  ).first();

  if (!table) return;

  await env.DB.prepare(`
    UPDATE job_context
    SET status='complete', updated_at=datetime('now')
    WHERE job_id=?
  `).bind(jobId).run();
}

async function uploadObject(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;

  const objectKey = request.headers.get("X-Object-Key") || "";
  const parsed = parseObjectKey(objectKey);
  if (!parsed) return json({ success: false, error: "Invalid object key" }, 400);

  const mimeType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!parsed.rule.mime.includes(mimeType)) {
    return json({ success: false, error: "Content type does not match object type" }, 400);
  }

  await env.BUCKET.put(objectKey, request.body, {
    httpMetadata: { contentType: mimeType }
  });

  return json({
    success: true,
    bucket: BUCKET_NAME,
    r2_key: objectKey,
    mime_type: mimeType
  });
}

async function completeDeliverable(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureSupportTables(env);

  const body = await readJson(request);
  if (!body) return json({ success: false, error: "Invalid JSON" }, 400);

  const requiredIds = ["deliverable_id", "order_id", "job_id", "deliverable_type"];
  for (const field of requiredIds) {
    if (!safeId(body[field])) return json({ success: false, error: `Invalid ${field}` }, 400);
  }

  if (body.parent_job_id != null && body.parent_job_id !== "" && !safeId(body.parent_job_id)) {
    return json({ success: false, error: "Invalid parent_job_id" }, 400);
  }

  const deliveryOrder = Number.isFinite(Number(body.delivery_order)) ? Number(body.delivery_order) : 1;
  const displayName = typeof body.display_name === "string" ? body.display_name.slice(0, 300) : null;
  const contentText = typeof body.content_text === "string" ? body.content_text : null;
  const contentJson = body.content_json == null
    ? null
    : typeof body.content_json === "string"
      ? body.content_json
      : JSON.stringify(body.content_json);
  const r2Key = typeof body.r2_key === "string" && body.r2_key ? body.r2_key : null;
  const mimeType = typeof body.mime_type === "string" && body.mime_type ? body.mime_type : null;

  if (r2Key && !parseObjectKey(r2Key)) {
    return json({ success: false, error: "Invalid r2_key" }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO deliverables (
      deliverable_id,
      order_id,
      job_id,
      parent_job_id,
      deliverable_type,
      status,
      file_url,
      display_name,
      delivery_order,
      content_text,
      content_json,
      r2_key,
      mime_type,
      created_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, 'completed', NULL, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(deliverable_id) DO UPDATE SET
      order_id = excluded.order_id,
      job_id = excluded.job_id,
      parent_job_id = excluded.parent_job_id,
      deliverable_type = excluded.deliverable_type,
      status = 'completed',
      file_url = NULL,
      display_name = excluded.display_name,
      delivery_order = excluded.delivery_order,
      content_text = excluded.content_text,
      content_json = excluded.content_json,
      r2_key = excluded.r2_key,
      mime_type = excluded.mime_type,
      completed_at = datetime('now')
  `).bind(
    body.deliverable_id,
    body.order_id,
    body.job_id,
    body.parent_job_id || null,
    body.deliverable_type,
    displayName,
    deliveryOrder,
    contentText,
    contentJson,
    r2Key,
    mimeType
  ).run();

  await markNormalizedJobComplete(env, body.job_id);

  const order = await recountOrder(env, body.order_id);

  return json({
    success: true,
    deliverable_id: body.deliverable_id,
    order
  });
}

async function upsertComponent(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureSupportTables(env);

  const body = await readJson(request);
  if (!body) return json({ success: false, error: "Invalid JSON" }, 400);

  for (const field of ["component_id", "deliverable_id", "order_id", "component_type"]) {
    if (!safeId(body[field])) return json({ success: false, error: `Invalid ${field}` }, 400);
  }

  if (body.job_id != null && body.job_id !== "" && !safeId(body.job_id)) {
    return json({ success: false, error: "Invalid job_id" }, 400);
  }

  const contentJson = body.content_json == null
    ? null
    : typeof body.content_json === "string"
      ? body.content_json
      : JSON.stringify(body.content_json);
  const r2Key = typeof body.r2_key === "string" && body.r2_key ? body.r2_key : null;

  if (r2Key && !parseObjectKey(r2Key)) {
    return json({ success: false, error: "Invalid r2_key" }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO deliverable_components (
      component_id,
      deliverable_id,
      order_id,
      job_id,
      component_type,
      status,
      content_text,
      content_json,
      r2_key,
      mime_type,
      display_name,
      created_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(component_id) DO UPDATE SET
      deliverable_id = excluded.deliverable_id,
      order_id = excluded.order_id,
      job_id = excluded.job_id,
      component_type = excluded.component_type,
      status = 'completed',
      content_text = excluded.content_text,
      content_json = excluded.content_json,
      r2_key = excluded.r2_key,
      mime_type = excluded.mime_type,
      display_name = excluded.display_name,
      completed_at = datetime('now')
  `).bind(
    body.component_id,
    body.deliverable_id,
    body.order_id,
    body.job_id || null,
    body.component_type,
    typeof body.content_text === "string" ? body.content_text : null,
    contentJson,
    r2Key,
    typeof body.mime_type === "string" ? body.mime_type : null,
    typeof body.display_name === "string" ? body.display_name.slice(0, 300) : null
  ).run();

  await markNormalizedJobComplete(env, body.job_id || null);

  return json({
    success: true,
    component_id: body.component_id,
    counting: false
  });
}

async function orderManifest(request, env, orderId) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureSupportTables(env);

  if (!safeId(orderId)) return json({ success: false, error: "Invalid order_id" }, 400);

  const order = await env.DB.prepare(`
    SELECT
      order_id,
      completed_deliverables,
      expected_deliverables,
      status,
      delivery_email_sent_at
    FROM orders
    WHERE order_id = ?
  `).bind(orderId).first();

  if (!order) return json({ success: false, error: "Order not found" }, 404);

  const deliverables = await env.DB.prepare(`
    SELECT
      deliverable_id,
      job_id,
      parent_job_id,
      deliverable_type,
      status,
      display_name,
      delivery_order,
      content_text,
      content_json,
      r2_key,
      mime_type,
      completed_at
    FROM deliverables
    WHERE order_id = ?
    ORDER BY delivery_order ASC, created_at ASC
  `).bind(orderId).all();

  const components = await env.DB.prepare(`
    SELECT
      component_id,
      deliverable_id,
      job_id,
      component_type,
      status,
      content_text,
      content_json,
      r2_key,
      mime_type,
      display_name,
      completed_at
    FROM deliverable_components
    WHERE order_id = ?
    ORDER BY created_at ASC
  `).bind(orderId).all();

  return json({
    success: true,
    ready:
      order.status === "complete" &&
      Number(order.completed_deliverables || 0) >= Number(order.expected_deliverables || 0) &&
      !order.delivery_email_sent_at,
    order,
    deliverables: deliverables.results || [],
    components: components.results || []
  });
}

async function createReturnToken(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureSupportTables(env);

  const body = await readJson(request);
  if (!body || !safeId(body.order_id)) {
    return json({ success: false, error: "Invalid order_id" }, 400);
  }

  const order = await env.DB.prepare("SELECT order_id, customer_id FROM orders WHERE order_id = ?")
    .bind(body.order_id)
    .first();

  if (!order) return json({ success: false, error: "Order not found" }, 404);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const ttlDays = Math.min(Math.max(Number(body.ttl_days || 365), 1), 730);
  const expiresAt = isoAfterDays(ttlDays);

  await env.DB.prepare(`
    INSERT INTO return_tokens (token_hash, order_id, customer_id, active, created_at, expires_at)
    VALUES (?, ?, ?, 1, datetime('now'), ?)
  `).bind(tokenHash, order.order_id, order.customer_id || null, expiresAt).run();

  return json({
    success: true,
    return_url: `${RETURN_BASE}/return/${token}`,
    expires_at: expiresAt
  });
}

function offersForTypes(types) {
  const set = new Set(types);
  const offers = new Map();

  function add(slug, label) {
    if (!offers.has(slug)) offers.set(slug, label);
  }

  if (set.has("hooks")) {
    add("storyboard", "Turn a hook into a Storyboard");
    add("image_words", "Turn a hook into an Image / Words creative");
    add("video_reel", "Turn a hook into a Video / Reel");
  }
  if (set.has("storyboard")) {
    add("storyboard_showcase", "Add a Showcase to this Storyboard");
    add("video_reel", "Turn this Storyboard into a Video / Reel");
  }
  if (set.has("storyboard_showcase")) {
    add("video_reel", "Turn this concept into a Video / Reel");
  }
  if (set.has("image_words")) {
    add("video_reel", "Build this idea into a Video / Reel");
    add("storyboard", "Plan the next idea as a Storyboard");
  }
  if (set.has("video_reel")) {
    add("storyboard", "Plan another concept");
    add("guide_ebook", "Create a Guide / Playbook");
  }
  if (set.has("guide_ebook")) {
    add("guide_ebook", "Create another Guide / Playbook");
    add("storyboard", "Turn a topic into a Storyboard");
  }

  add("new_order", "Create something new");
  return [...offers.entries()].map(([slug, label]) => ({ slug, label }));
}

async function resolveReturn(request, env, token) {
  await ensureSupportTables(env);
  if (!safeText(token, 200)) return html("<h1>Invalid return link</h1>", 400);

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`
    SELECT order_id, expires_at
    FROM return_tokens
    WHERE token_hash = ?
      AND active = 1
  `).bind(tokenHash).first();

  if (!row) return html("<h1>This return link is not available.</h1>", 404);
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return html("<h1>This return link has expired.</h1>", 410);
  }

  const result = await env.DB.prepare(`
    SELECT DISTINCT deliverable_type
    FROM deliverables
    WHERE order_id = ?
      AND status = 'completed'
  `).bind(row.order_id).all();

  const types = (result.results || []).map((r) => r.deliverable_type);
  const offers = offersForTypes(types);

  const cards = offers.map((offer) => {
    const href = `${SHOP_BASE}/?return_token=${encodeURIComponent(token)}&product=${encodeURIComponent(offer.slug)}#shop`;
    return `<a class="offer" href="${href}">${offer.label}<span>Continue →</span></a>`;
  }).join("");

  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Continue with Make You Stop</title>
<style>
body{margin:0;background:#0b0b0d;color:#fff;font-family:Inter,Arial,sans-serif}
main{max-width:720px;margin:auto;padding:48px 20px}
small{letter-spacing:.14em;text-transform:uppercase;color:#9ca3af}
h1{font-size:clamp(34px,7vw,58px);line-height:1;margin:12px 0 16px}
p{color:#d1d5db;font-size:18px;line-height:1.6}
.grid{display:grid;gap:12px;margin-top:28px}
.offer{display:flex;justify-content:space-between;gap:20px;padding:18px 20px;border:1px solid #2b2b31;border-radius:16px;color:#fff;text-decoration:none;background:#151519}
.offer:hover{border-color:#fff}
.offer span{color:#a7f3d0;white-space:nowrap}
.note{font-size:13px;color:#9ca3af;margin-top:28px}
</style>
</head>
<body>
<main>
<small>MAKE YOU STOP</small>
<h1>Want to take it further?</h1>
<p>Choose a next step. You can continue from previous creative or start something new. Payment for any new work happens as a new order.</p>
<div class="grid">${cards}</div>
<p class="note">This link does not provide access to your private files or personal details.</p>
</main>
</body>
</html>`);
}

async function createDownloadToken(request, env) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  await ensureSupportTables(env);

  const body = await readJson(request);
  if (!body || !safeId(body.order_id) || typeof body.r2_key !== "string" || !parseObjectKey(body.r2_key)) {
    return json({ success: false, error: "Invalid download request" }, 400);
  }

  const matchDeliverable = await env.DB.prepare(`
    SELECT 1 AS ok
    FROM deliverables
    WHERE order_id = ? AND r2_key = ? AND status = 'completed'
    LIMIT 1
  `).bind(body.order_id, body.r2_key).first();

  const matchComponent = matchDeliverable ? null : await env.DB.prepare(`
    SELECT 1 AS ok
    FROM deliverable_components
    WHERE order_id = ? AND r2_key = ? AND status = 'completed'
    LIMIT 1
  `).bind(body.order_id, body.r2_key).first();

  if (!matchDeliverable && !matchComponent) {
    return json({ success: false, error: "Stored file does not belong to completed order output" }, 404);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const ttlDays = Math.min(Math.max(Number(body.ttl_days || 365), 1), 730);
  const expiresAt = isoAfterDays(ttlDays);

  await env.DB.prepare(`
    INSERT INTO download_tokens (
      token_hash, order_id, r2_key, display_name, mime_type, active, created_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?)
  `).bind(
    tokenHash,
    body.order_id,
    body.r2_key,
    typeof body.display_name === "string" ? body.display_name.slice(0, 300) : null,
    typeof body.mime_type === "string" ? body.mime_type : null,
    expiresAt
  ).run();

  return json({
    success: true,
    download_url: `${RETURN_BASE}/download/${token}`,
    expires_at: expiresAt
  });
}

async function serveDownload(env, token) {
  await ensureSupportTables(env);
  if (!safeText(token, 200)) return json({ success: false, error: "Invalid download link" }, 400);

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`
    SELECT r2_key, display_name, mime_type, expires_at
    FROM download_tokens
    WHERE token_hash = ?
      AND active = 1
  `).bind(tokenHash).first();

  if (!row) return json({ success: false, error: "Download link not found" }, 404);
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return json({ success: false, error: "Download link expired" }, 410);
  }

  const object = await env.BUCKET.get(row.r2_key);
  if (!object) return json({ success: false, error: "File not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", row.mime_type || headers.get("Content-Type") || "application/octet-stream");
  const name = (row.display_name || row.r2_key.split("/").pop() || "download").replace(/["\r\n]/g, "");
  headers.set("Content-Disposition", `attachment; filename="${name}"`);

  return new Response(object.body, { headers });
}

async function recountEndpoint(request, env, orderId) {
  const authError = requireAuthorized(request, env);
  if (authError) return authError;
  if (!safeId(orderId)) return json({ success: false, error: "Invalid order_id" }, 400);
  const order = await recountOrder(env, orderId);
  if (!order) return json({ success: false, error: "Order not found" }, 404);
  return json({ success: true, order });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/health") {
        return json({
          success: true,
          service: "make-you-stop-backend",
          bucket: BUCKET_NAME,
          d1_configured: Boolean(env.DB),
          r2_configured: Boolean(env.BUCKET)
        });
      }

      // Backward-compatible Guide upload: existing Make #410 can continue PUT /
      if (request.method === "PUT" && (path === "/" || path === "/upload")) {
        return uploadObject(request, env);
      }

      if (request.method === "POST" && path === "/api/deliverables/complete") {
        return completeDeliverable(request, env);
      }

      if (request.method === "POST" && path === "/api/components") {
        return upsertComponent(request, env);
      }

      const manifestMatch = path.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/manifest$/);
      if (request.method === "GET" && manifestMatch) {
        return orderManifest(request, env, manifestMatch[1]);
      }

      const recountMatch = path.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/recount$/);
      if (request.method === "POST" && recountMatch) {
        return recountEndpoint(request, env, recountMatch[1]);
      }

      if (request.method === "POST" && path === "/api/return-tokens") {
        return createReturnToken(request, env);
      }

      if (request.method === "POST" && path === "/api/download-tokens") {
        return createDownloadToken(request, env);
      }

      if (request.method === "POST" && path === "/api/assets/render-reference") {
        return createRenderAssetReference(request, env, RETURN_BASE);
      }

      if (request.method === "POST" && path === "/api/assets/intelligence/ensure") {
        return ensureAssetIntelligence(request, env);
      }

      if (request.method === "POST" && path === "/api/assets/intelligence/upsert") {
        return upsertAssetIntelligence(request, env);
      }

      if (request.method === "POST" && path === "/api/assets/intelligence/video-source") {
        return startVideoAnalysisSource(request, env, RETURN_BASE);
      }

      if (request.method === "GET" && path === "/api/assets/intelligence/video-source/status") {
        return videoAnalysisStatus(request, env, url);
      }

      if (request.method === "POST" && path === "/api/assets/intelligence/video-source/cleanup") {
        return cleanupVideoAnalysisSource(request, env);
      }

      if (request.method === "POST" && path === "/api/deliverables/asset-provenance") {
        return writeDeliverableAssetProvenance(request, env);
      }


      if (request.method === "GET" && path === "/api/commerce/status") {
        return commerceStatus(request, env);
      }

      if (request.method === "POST" && path === "/api/products/resolve") {
        return resolveProduct(request, env);
      }

      if (request.method === "POST" && path === "/api/product-mappings") {
        return upsertStripeProductMapping(request, env);
      }

      const expandOrderMatch = path.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/expand$/);
      if (request.method === "POST" && expandOrderMatch) {
        return expandOrder(request, env, expandOrderMatch[1]);
      }

      if (request.method === "POST" && path === "/api/intake-tokens") {
        return createIntakeToken(request, env);
      }

      const resolveIntakeMatch = path.match(/^\/api\/intake-tokens\/([^/]+)$/);
      if (request.method === "GET" && resolveIntakeMatch) {
        return resolveIntakeToken(request, env, resolveIntakeMatch[1]);
      }

      const intakeSubmitMatch = path.match(/^\/intake\/([^/]+)$/);
      if (request.method === "POST" && intakeSubmitMatch) {
        return submitIntake(request, env, intakeSubmitMatch[1]);
      }

      const jobContextMatch = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]+)\/context$/);
      if (request.method === "GET" && jobContextMatch) {
        return jobContext(request, env, jobContextMatch[1]);
      }

      if (request.method === "GET" && path === "/api/jobs/ready") {
        return readyJobs(request, env);
      }

      if (request.method === "POST" && path === "/api/upload-sessions") {
        return createUploadSession(request, env);
      }

      if (request.method === "GET" && path === "/api/canva/status") {
        return canvaStatus(request, env);
      }

      if (request.method === "POST" && path === "/api/canva/auth/start") {
        return canvaAuthStart(request, env);
      }

      if (request.method === "GET" && path === "/canva/oauth/callback") {
        return canvaCallback(request, env);
      }

      if (request.method === "POST" && path === "/api/canva/designs") {
        return canvaCreateDesign(request, env);
      }

      if (request.method === "GET" && path === "/api/canva/brand-templates") {
        return canvaBrandTemplates(request, env);
      }

      const canvaDatasetMatch = path.match(/^\/api\/canva\/brand-templates\/([^/]+)\/dataset$/);
      if (request.method === "GET" && canvaDatasetMatch) {
        return canvaTemplateDataset(request, env, canvaDatasetMatch[1]);
      }

      if (request.method === "POST" && path === "/api/canva/autofills") {
        return canvaAutofill(request, env);
      }

      if (request.method === "POST" && path === "/api/canva/exports") {
        return canvaExport(request, env);
      }

      const canvaExportWaitMatch = path.match(/^\/api\/canva\/exports\/([^/]+)\/wait$/);
      if (request.method === "GET" && canvaExportWaitMatch) {
        return canvaExportWait(request, env, canvaExportWaitMatch[1]);
      }

      const canvaExportStoreMatch = path.match(/^\/api\/canva\/exports\/([^/]+)\/store$/);
      if (request.method === "POST" && canvaExportStoreMatch) {
        return canvaExportStore(request, env, canvaExportStoreMatch[1]);
      }

      const canvaExportMatch = path.match(/^\/api\/canva\/exports\/([^/]+)$/);
      if (request.method === "GET" && canvaExportMatch) {
        return canvaExportStatus(request, env, canvaExportMatch[1]);
      }

      if (request.method === "POST" && path === "/api/visuals") {
        return registerVisual(request, env);
      }

      if (request.method === "POST" && path === "/api/visuals/used") {
        return markVisualUsed(request, env);
      }

      if (request.method === "GET" && path === "/api/visuals/candidates") {
        return visualCandidates(request, env);
      }

      if (request.method === "GET" && path === "/api/visuals/recent-usage") {
        return recentVisualUsage(request, env);
      }


      const assetsMatch = path.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/assets$/);
      if (request.method === "GET" && assetsMatch) {
        return orderAssets(request, env, assetsMatch[1]);
      }

      const customerUploadFileMatch = path.match(/^\/customer-upload\/([^/]+)\/file$/);
      if (request.method === "PUT" && customerUploadFileMatch) {
        return uploadFile(request, env, customerUploadFileMatch[1]);
      }

      const customerUploadMatch = path.match(/^\/customer-upload\/([^/]+)$/);
      if (request.method === "GET" && customerUploadMatch) {
        return uploadPage(env, customerUploadMatch[1]);
      }

      const returnMatch = path.match(/^\/return\/([^/]+)$/);
      if (request.method === "GET" && returnMatch) {
        return resolveReturn(request, env, returnMatch[1]);
      }

      const downloadMatch = path.match(/^\/download\/([^/]+)$/);
      if (request.method === "GET" && downloadMatch) {
        return serveDownload(env, downloadMatch[1]);
      }

      const renderAssetMatch = path.match(/^\/render-asset\/([^/]+)$/);
      if ((request.method === "GET" || request.method === "HEAD") && renderAssetMatch) {
        return serveRenderAsset(request, env, renderAssetMatch[1]);
      }

      return json({ success: false, error: "Method or route not allowed" }, 405);
    } catch (error) {
      return json({
        success: false,
        error: "Internal error",
        detail: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  }
};
