const SHOP_BASE = "https://makeyoustop.com";
const BRAND = {
  cream:"#f4eee5",
  coral:"#ff5f4a",
  ink:"#111111",
  soft:"#fffaf4",
  line:"#e8ddd0"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function auth(request, env) {
  if (!env.UPLOAD_SECRET) return json({ success:false, error:"Backend secret is not configured" }, 500);
  if ((request.headers.get("Authorization") || "") !== `Bearer ${env.UPLOAD_SECRET}`) {
    return json({ success:false, error:"Unauthorized" }, 401);
  }
  return null;
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,"0")).join("");
}

async function tableExists(env, name) {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
  return Boolean(row);
}

async function ensureTables(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS delivery_events (
      event_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      job_id TEXT,
      event_type TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_events_order ON delivery_events(order_id, created_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tracked_links (
      token_hash TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      job_id TEXT,
      link_type TEXT NOT NULL,
      label TEXT,
      destination_url TEXT NOT NULL,
      click_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_clicked_at TEXT,
      active INTEGER NOT NULL DEFAULT 1
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tracked_links_order ON tracked_links(order_id, link_type)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_brand_profiles (
      profile_id TEXT PRIMARY KEY,
      customer_id TEXT,
      brand_id TEXT,
      display_name TEXT,
      context_json TEXT NOT NULL DEFAULT '{}',
      last_order_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_brand_customer ON creator_brand_profiles(customer_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_brand_brand ON creator_brand_profiles(brand_id)")
  ]);
}

async function insertEvent(env, orderId, jobId, eventType, metadata = {}) {
  const id = "evt_" + (await sha256Hex(`${orderId}:${jobId || ""}:${eventType}:${Date.now()}:${Math.random()}`)).slice(0,24);
  await env.DB.prepare(`INSERT INTO delivery_events
    (event_id, order_id, job_id, event_type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .bind(id, orderId, jobId || null, eventType, JSON.stringify(metadata || {})).run();
  return id;
}

async function makeTrackedUrl(request, env, { order_id, job_id, link_type, label, destination_url }) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(`INSERT INTO tracked_links
    (token_hash, order_id, job_id, link_type, label, destination_url, click_count, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), 1)`)
    .bind(tokenHash, order_id, job_id || null, link_type, label || null, destination_url).run();
  return `${new URL(request.url).origin}/go/${token}`;
}

export async function createTrackedLink(request, env) {
  const e = auth(request, env); if (e) return e;
  await ensureTables(env);
  const body = await readJson(request);
  if (!body || !safeId(body.order_id)) return json({ success:false, error:"Invalid order_id" }, 400);
  if (body.job_id && !safeId(body.job_id)) return json({ success:false, error:"Invalid job_id" }, 400);
  const destination = safeUrl(body.destination_url);
  if (!destination) return json({ success:false, error:"A valid HTTPS destination_url is required" }, 400);
  const tracked_url = await makeTrackedUrl(request, env, {
    order_id: body.order_id,
    job_id: body.job_id || null,
    link_type: String(body.link_type || "other").slice(0,80),
    label: String(body.label || "").slice(0,200),
    destination_url: destination
  });
  return json({ success:true, tracked_url });
}

export async function followTrackedLink(request, env, token) {
  await ensureTables(env);
  if (!token || token.length > 300) return new Response("Invalid link", { status:400 });
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT order_id, job_id, link_type, label, destination_url
    FROM tracked_links WHERE token_hash=? AND active=1`).bind(tokenHash).first();
  if (!row) return new Response("This link is not available.", { status:404 });
  await env.DB.prepare(`UPDATE tracked_links
    SET click_count=click_count+1, last_clicked_at=datetime('now') WHERE token_hash=?`)
    .bind(tokenHash).run();
  await insertEvent(env, row.order_id, row.job_id, "link_clicked", {
    link_type: row.link_type, label: row.label
  });
  return Response.redirect(row.destination_url, 302);
}

export async function recordDeliveryEvent(request, env) {
  const e = auth(request, env); if (e) return e;
  await ensureTables(env);
  const body = await readJson(request);
  if (!body || !safeId(body.order_id)) return json({ success:false, error:"Invalid order_id" }, 400);
  if (body.job_id && !safeId(body.job_id)) return json({ success:false, error:"Invalid job_id" }, 400);
  const eventType = String(body.event_type || "").trim();
  if (!eventType || eventType.length > 100) return json({ success:false, error:"Invalid event_type" }, 400);
  const event_id = await insertEvent(env, body.order_id, body.job_id || null, eventType, body.metadata || {});
  return json({ success:true, event_id });
}

export async function upsertCreatorBrandProfile(request, env) {
  const e = auth(request, env); if (e) return e;
  await ensureTables(env);
  const body = await readJson(request);
  if (!body) return json({ success:false, error:"Invalid JSON" }, 400);
  if (body.customer_id && !safeId(body.customer_id)) return json({ success:false, error:"Invalid customer_id" }, 400);
  if (body.brand_id && !safeId(body.brand_id)) return json({ success:false, error:"Invalid brand_id" }, 400);
  if (body.last_order_id && !safeId(body.last_order_id)) return json({ success:false, error:"Invalid last_order_id" }, 400);
  const seed = body.brand_id || body.customer_id || body.last_order_id;
  if (!seed) return json({ success:false, error:"customer_id, brand_id or last_order_id is required" }, 400);
  const profileId = "profile_" + (await sha256Hex(`${body.customer_id || ""}:${body.brand_id || ""}:${seed}`)).slice(0,24);
  await env.DB.prepare(`INSERT INTO creator_brand_profiles
    (profile_id, customer_id, brand_id, display_name, context_json, last_order_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(profile_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id, creator_brand_profiles.customer_id),
      brand_id=COALESCE(excluded.brand_id, creator_brand_profiles.brand_id),
      display_name=COALESCE(excluded.display_name, creator_brand_profiles.display_name),
      context_json=excluded.context_json,
      last_order_id=COALESCE(excluded.last_order_id, creator_brand_profiles.last_order_id),
      updated_at=datetime('now')`)
    .bind(profileId, body.customer_id || null, body.brand_id || null,
      body.display_name ? String(body.display_name).slice(0,300) : null,
      JSON.stringify(body.context || {}), body.last_order_id || null).run();
  return json({ success:true, profile_id:profileId });
}

export async function orderTrace(request, env, orderId) {
  const e = auth(request, env); if (e) return e;
  await ensureTables(env);
  if (!safeId(orderId)) return json({ success:false, error:"Invalid order_id" }, 400);

  async function rows(table, sql, binds=[]) {
    if (!(await tableExists(env, table))) return [];
    return (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  }

  const order = (await rows("orders", "SELECT * FROM orders WHERE order_id=?", [orderId]))[0] || null;
  const jobs = await rows("job_context", "SELECT * FROM job_context WHERE order_id=? ORDER BY sequence_index, created_at", [orderId]);
  const deliverables = await rows("deliverables", "SELECT * FROM deliverables WHERE order_id=? ORDER BY delivery_order, created_at", [orderId]);
  const components = await rows("deliverable_components", "SELECT * FROM deliverable_components WHERE order_id=? ORDER BY created_at", [orderId]);
  const intake = await rows("intake_submissions", "SELECT * FROM intake_submissions WHERE order_id=? ORDER BY created_at", [orderId]);
  const shopping = await rows("shopping_intents", "SELECT * FROM shopping_intents WHERE order_id=? ORDER BY created_at", [orderId]);
  const events = await rows("delivery_events", "SELECT * FROM delivery_events WHERE order_id=? ORDER BY created_at", [orderId]);
  const links = await rows("tracked_links", "SELECT link_type,label,click_count,created_at,last_clicked_at,active FROM tracked_links WHERE order_id=? ORDER BY created_at", [orderId]);

  let profiles = [];
  if (order) {
    const customerId = order.customer_id || null;
    const brandId = order.brand_id || null;
    if (customerId || brandId) {
      const clauses = [], binds = [];
      if (customerId) { clauses.push("customer_id=?"); binds.push(customerId); }
      if (brandId) { clauses.push("brand_id=?"); binds.push(brandId); }
      profiles = await rows("creator_brand_profiles", `SELECT * FROM creator_brand_profiles WHERE ${clauses.join(" OR ")} ORDER BY updated_at DESC`, binds);
    }
  }

  return json({ success:true, order, jobs, deliverables, components, intake_submissions:intake, shopping_intents:shopping, delivery_events:events, tracked_links:links, creator_brand_profiles:profiles });
}

function productCopy(productKey) {
  if (productKey === "hooks") return {
    name:"Hook Pack",
    subject:"Your personalised Hook Pack is ready",
    intro:"Your personalised Make You Stop Hook Pack is ready.",
    detail:"Inside are your 10 personalised hooks, Top 3 to test first, creative angles, opening direction, CTA starters and usage guidance."
  };
  return {
    name:"creative",
    subject:"Your Make You Stop creative is ready",
    intro:"Your Make You Stop creative is ready.",
    detail:"Open your finished creative below."
  };
}

export async function buildDeliveryEmail(request, env) {
  const e = auth(request, env); if (e) return e;
  await ensureTables(env);
  const body = await readJson(request);
  if (!body || !safeId(body.order_id)) return json({ success:false, error:"Invalid order_id" }, 400);
  if (body.job_id && !safeId(body.job_id)) return json({ success:false, error:"Invalid job_id" }, 400);

  const productKey = String(body.product_key || "hooks");
  const copy = productCopy(productKey);
  const deliveryUrl = safeUrl(body.delivery_url);
  const returnUrl = safeUrl(body.return_url);
  if (!deliveryUrl) return json({ success:false, error:"delivery_url is required" }, 400);
  if (!returnUrl) return json({ success:false, error:"return_url is required" }, 400);

  const openUrl = await makeTrackedUrl(request, env, {
    order_id:body.order_id, job_id:body.job_id || null, link_type:"delivery_open",
    label:`Open your ${copy.name}`, destination_url:deliveryUrl
  });
  const upgradeUrl = await makeTrackedUrl(request, env, {
    order_id:body.order_id, job_id:body.job_id || null, link_type:"upgrade",
    label:"Take this further", destination_url:returnUrl
  });

  const terms = safeUrl(env.TERMS_URL) || `${SHOP_BASE}/#terms`;
  const refund = safeUrl(env.REFUND_POLICY_URL) || `${SHOP_BASE}/#refund-policy`;
  const privacy = safeUrl(env.PRIVACY_POLICY_URL) || `${SHOP_BASE}/#privacy`;

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:${BRAND.cream};color:${BRAND.ink};font-family:Arial,Helvetica,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:24px 14px}.card{background:${BRAND.soft};border:1px solid ${BRAND.line};border-radius:24px;overflow:hidden;box-shadow:0 14px 40px rgba(17,17,17,.08)}
.head{background:${BRAND.cream};color:${BRAND.ink};padding:36px 28px 30px;text-align:center;border-bottom:1px solid ${BRAND.line}}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.18em;font-weight:800}
.brand:before{content:"";width:9px;height:9px;border-radius:50%;background:${BRAND.coral}}
.head h1{font-size:36px;line-height:1.03;margin:20px auto 0;max-width:500px}.head h1 span{color:${BRAND.coral}}
.body{padding:30px 28px}.body p{font-size:17px;line-height:1.6;margin:0 0 18px}
.kicker{font-size:12px;letter-spacing:.14em;font-weight:800;color:${BRAND.coral};text-transform:uppercase;text-align:center;margin-bottom:10px}
.top3{background:#fff;border:1px solid ${BRAND.line};border-radius:16px;padding:17px 18px;margin:22px 0;font-size:15px;line-height:1.5}
.button{display:block;text-align:center;background:${BRAND.coral};color:#fff!important;text-decoration:none;padding:18px 20px;border-radius:999px;font-weight:800;font-size:17px;margin:24px 0}
.next{border-top:1px solid ${BRAND.line};margin-top:32px;padding-top:28px}.next h2{font-size:25px;margin:0 0 10px;text-align:center}
.next p{text-align:center}.next-grid{display:grid;gap:10px;margin-top:18px}
.next-card{display:block;border:1px solid ${BRAND.line};border-radius:16px;padding:16px 18px;text-decoration:none;color:${BRAND.ink};background:#fff;font-weight:700}
.next-card small{display:block;font-weight:400;color:#6b625b;margin-top:5px;font-size:13px;line-height:1.4}
.footer{text-align:center;color:#756c64;font-size:12px;line-height:1.8;padding:22px 12px}.footer a{color:#756c64}
@media(max-width:480px){.wrap{padding:0}.card{border-radius:0;border-left:0;border-right:0}.head{padding:32px 22px 26px}.head h1{font-size:32px}.body{padding:26px 22px}.body p{font-size:16px}}
</style></head><body><div class="wrap"><div class="card">
<div class="head"><div class="brand">MAKE YOU STOP</div><div class="kicker">CREATIVE BUILT FOR THE SCROLL.</div><h1>Your personalised <span>Hook Pack</span> is ready</h1></div>
<div class="body"><p>${escapeHtml(copy.intro)}</p><p>${escapeHtml(copy.detail)}</p>
<a class="button" href="${escapeHtml(openUrl)}">Open your ${escapeHtml(copy.name)}</a>
<div class="next"><h2>Want to take this further?</h2><p>Keep the momentum going without starting from scratch. Your creator/brand context can carry into the next job.</p>
<div class="next-grid">
<a class="next-card" href="${escapeHtml(upgradeUrl)}">Turn a hook into your next creative →<small>Take one of your strongest hooks into a Storyboard, Image / Words creative or Video / Reel.</small></a>
<a class="next-card" href="${escapeHtml(upgradeUrl)}">Fresh hooks every month →<small>Interested in a new personalised Hook Pack each month? See the recurring Hook option.</small></a>
<a class="next-card" href="${escapeHtml(upgradeUrl)}">Create something new →<small>Start another brief using the creator/brand context already on file.</small></a>
</div></div>
</div></div>
<div class="footer">Make You Stop · makeyoustop.com<br>
<a href="${escapeHtml(terms)}">Terms &amp; Conditions</a> · <a href="${escapeHtml(refund)}">Refund Policy</a> · <a href="${escapeHtml(privacy)}">Privacy Policy</a></div>
</div></body></html>`;

  const text = `${copy.intro}\n\n${copy.detail}\n\nOpen your ${copy.name}: ${openUrl}\n\nWant to take this further?\nTurn a hook into your next creative, get fresh hooks every month, or create something new using your saved creator/brand context.\nSee your next options: ${upgradeUrl}\n\nTerms & Conditions: ${terms}\nRefund Policy: ${refund}\nPrivacy Policy: ${privacy}\n\nMake You Stop · makeyoustop.com`;

  await insertEvent(env, body.order_id, body.job_id || null, "delivery_email_built", { product_key:productKey });

  return json({
    success:true,
    delivery_contract_version:1,
    subject:copy.subject,
    html,
    text,
    links:{ delivery:openUrl, upgrade:upgradeUrl, terms, refund_policy:refund, privacy_policy:privacy },
    presentation:{ mobile_first:true, desktop_friendly:true, max_email_width_px:620 },
    send_state:"not_sent"
  });
}
