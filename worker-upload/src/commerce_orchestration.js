const DEFAULT_TOKEN_TTL_HOURS = 72;

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

function auth(request, env) {
  if (!env.UPLOAD_SECRET) return json({ success: false, error: "Backend secret is not configured" }, 500);
  if ((request.headers.get("Authorization") || "") !== `Bearer ${env.UPLOAD_SECRET}`) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function token(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function stableId(prefix, value) {
  return `${prefix}_${(await sha256Hex(value)).slice(0, 24)}`;
}

function expiresAfterHours(hours) {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

const CORE_MANIFESTS = [
  {
    product_key: "hooks",
    display_name: "Hook Pack",
    manifest_version: 1,
    jobs: [
      { job_key: "hooks", role: "primary", deliverable_type: "hooks", requested_lane: "hooks", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "image_words",
    display_name: "Image / Words",
    manifest_version: 1,
    jobs: [
      { job_key: "image_words", role: "primary", deliverable_type: "image_words", requested_lane: "image_words", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "video_reel",
    display_name: "Video / Reel",
    manifest_version: 1,
    jobs: [
      { job_key: "video_reel", role: "primary", deliverable_type: "video_reel", requested_lane: "video_reel", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" },
      { job_key: "suggested_voice_script", role: "support", component_type: "suggested_voice_script", deliverable_type: "video_reel", requested_lane: "video_reel", counts_toward_expected: false, parent_job_key: "video_reel", sequence_index: 2, delivery_order: 1, intake_type: "shared_parent_intake" }
    ]
  },
  {
    product_key: "what_to_say_guide",
    display_name: "What to Say Guide",
    manifest_version: 1,
    jobs: [
      { job_key: "what_to_say_guide", role: "primary", deliverable_type: "what_to_say_guide", requested_lane: "what_to_say_guide", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "storyboard",
    display_name: "Storyboard",
    manifest_version: 1,
    jobs: [
      { job_key: "storyboard", role: "primary", deliverable_type: "storyboard", requested_lane: "storyboard", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "storyboard_showcase",
    display_name: "Storyboard + Showcase",
    manifest_version: 1,
    required_components: ["storyboard", "showcase"],
    jobs: [
      { job_key: "storyboard_showcase", role: "primary", deliverable_type: "storyboard_showcase", requested_lane: "storyboard_showcase", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "guide_ebook",
    display_name: "Guide / eBook",
    manifest_version: 1,
    jobs: [
      { job_key: "guide_ebook", role: "primary", deliverable_type: "guide_ebook", requested_lane: "guide_ebook", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "unboxing_product_reveal",
    display_name: "Unboxing / Product Reveal",
    manifest_version: 1,
    jobs: [
      { job_key: "unboxing_product_reveal", role: "primary", deliverable_type: "unboxing_product_reveal", requested_lane: "unboxing_product_reveal", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  }
];

async function ensureTables(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");

  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_manifests (
      product_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      manifest_version INTEGER NOT NULL DEFAULT 1,
      manifest_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_product_mappings (
      mapping_key TEXT PRIMARY KEY,
      product_key TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS job_context (
      job_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      parent_job_id TEXT,
      deliverable_id TEXT,
      product_key TEXT NOT NULL,
      deliverable_type TEXT NOT NULL,
      component_type TEXT,
      requested_lane TEXT NOT NULL,
      job_role TEXT NOT NULL,
      counts_toward_expected INTEGER NOT NULL DEFAULT 1,
      request_type TEXT NOT NULL DEFAULT 'new',
      sequence_index INTEGER NOT NULL DEFAULT 1,
      delivery_order INTEGER NOT NULL DEFAULT 1,
      manifest_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'awaiting_intake',
      intake_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_job_context_order ON job_context(order_id, sequence_index)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_job_context_status ON job_context(status, intake_status)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS intake_tokens (
      token_hash TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      job_id TEXT,
      intake_type TEXT NOT NULL DEFAULT 'creative_brief',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_intake_tokens_order ON intake_tokens(order_id)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS intake_submissions (
      submission_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      order_id TEXT NOT NULL,
      job_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_intake_submissions_job ON intake_submissions(job_id, created_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_ingress_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT,
      checkout_session_id TEXT,
      product_key TEXT,
      order_id TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`)
  ]);

  const jobContextCols = await tableColumns(env, "job_context");
  if (!jobContextCols.has("deliverable_id")) {
    await env.DB.prepare("ALTER TABLE job_context ADD COLUMN deliverable_id TEXT").run();
  }

  for (const manifest of CORE_MANIFESTS) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO product_manifests (
        product_key, display_name, manifest_version, manifest_json, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).bind(
      manifest.product_key,
      manifest.display_name,
      manifest.manifest_version,
      JSON.stringify(manifest)
    ).run();
  }
}

async function tableColumns(env, table) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result.results || []).map((r) => r.name));
}

function extractStripePurchaseKeys(body) {
  const keys = [];

  function add(kind, value) {
    if (typeof value === "string" && value.length > 0 && value.length <= 300) {
      keys.push(`${kind}:${value}`);
    }
  }

  add("price", body?.stripe_price_id);
  add("product", body?.stripe_product_id);
  add("payment_link", body?.payment_link_id);
  add("payment_link", body?.stripe_payment_link_id);

  const session = body?.checkout_session && typeof body.checkout_session === "object"
    ? body.checkout_session
    : body?.session && typeof body.session === "object"
      ? body.session
      : null;

  if (session) add("payment_link", session.payment_link);

  const lineItems =
    body?.stripe_line_items ??
    body?.line_items ??
    session?.line_items ??
    null;

  const data = Array.isArray(lineItems)
    ? lineItems
    : Array.isArray(lineItems?.data)
      ? lineItems.data
      : [];

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const price = item.price;
    if (typeof price === "string") {
      add("price", price);
      continue;
    }
    if (price && typeof price === "object") {
      add("price", price.id);
      const product = price.product;
      if (typeof product === "string") add("product", product);
      else if (product && typeof product === "object") add("product", product.id);
    }
  }

  return [...new Set(keys)];
}

async function resolveManifest(env, body) {
  let productKey = safeId(body?.product_key) ? body.product_key : null;

  if (!productKey) {
    const candidates = extractStripePurchaseKeys(body);

    for (const mappingKey of candidates) {
      const mapping = await env.DB.prepare(
        "SELECT product_key FROM stripe_product_mappings WHERE mapping_key = ? AND active = 1"
      ).bind(mappingKey).first();
      if (mapping?.product_key) {
        productKey = mapping.product_key;
        break;
      }
    }
  }

  if (!productKey) return null;

  const row = await env.DB.prepare(
    "SELECT product_key, display_name, manifest_version, manifest_json FROM product_manifests WHERE product_key = ? AND active = 1"
  ).bind(productKey).first();

  if (!row) return null;

  let manifest;
  try { manifest = JSON.parse(row.manifest_json); } catch { return null; }

  return {
    product_key: row.product_key,
    display_name: row.display_name,
    manifest_version: Number(row.manifest_version || 1),
    manifest
  };
}

export async function resolveProduct(request, env) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  const body = await readJson(request);
  if (!body) return json({ success: false, error: "Invalid JSON" }, 400);

  const resolved = await resolveManifest(env, body);
  if (!resolved) {
    return json({
      success: true,
      resolved: false,
      migration_fallback_allowed: true,
      purchase_keys: extractStripePurchaseKeys(body),
      message: "No active Stripe-to-product mapping exists yet. Preserve the current Make fallback during staged migration."
    });
  }

  return json({ success: true, resolved: true, ...resolved });
}

export async function upsertStripeProductMapping(request, env) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  const body = await readJson(request);
  if (!body || !safeId(body.product_key)) return json({ success: false, error: "Invalid product_key" }, 400);

  const manifest = await resolveManifest(env, { product_key: body.product_key });
  if (!manifest) return json({ success: false, error: "Unknown product_key" }, 404);

  let mappingKey = null;
  if (typeof body.stripe_price_id === "string" && body.stripe_price_id) mappingKey = `price:${body.stripe_price_id}`;
  else if (typeof body.stripe_product_id === "string" && body.stripe_product_id) mappingKey = `product:${body.stripe_product_id}`;
  else if (typeof body.payment_link_id === "string" && body.payment_link_id) mappingKey = `payment_link:${body.payment_link_id}`;

  if (!mappingKey || mappingKey.length > 300) return json({ success: false, error: "A Stripe price, product, or payment-link ID is required" }, 400);

  await env.DB.prepare(`
    INSERT INTO stripe_product_mappings (mapping_key, product_key, active, created_at, updated_at)
    VALUES (?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(mapping_key) DO UPDATE SET
      product_key = excluded.product_key,
      active = 1,
      updated_at = datetime('now')
  `).bind(mappingKey, body.product_key).run();

  return json({ success: true, mapping_key: mappingKey, product_key: body.product_key });
}

async function mirrorJob(env, ctx, body) {
  const cols = await tableColumns(env, "jobs");
  if (!cols.has("job_id")) return;

  const values = {
    job_id: ctx.job_id,
    order_id: ctx.order_id,
    parent_job_id: ctx.parent_job_id,
    deliverable_id: ctx.deliverable_id,
    customer_id: body.customer_id || null,
    brand_id: body.brand_id || null,
    deliverable_type: ctx.deliverable_type,
    requested_lane: ctx.requested_lane,
    request_type: ctx.request_type,
    status: ctx.status,
    sequence_index: ctx.sequence_index,
    delivery_order: ctx.delivery_order,
    created_at: null,
    updated_at: null
  };

  const names = Object.keys(values).filter((name) => cols.has(name) && name !== "created_at" && name !== "updated_at");
  const placeholders = names.map(() => "?").join(", ");
  const updates = names.filter((name) => name !== "job_id").map((name) => `${name}=excluded.${name}`).join(", ");

  if (!names.includes("job_id")) return;

  const sql = `INSERT INTO jobs (${names.join(", ")}, created_at, updated_at)
    VALUES (${placeholders}, datetime('now'), datetime('now'))
    ON CONFLICT(job_id) DO UPDATE SET ${updates}${updates ? ", " : ""}updated_at=datetime('now')`;

  await env.DB.prepare(sql).bind(...names.map((name) => values[name])).run();
}

async function updateOrderManifest(env, orderId, resolved, expectedCount) {
  const cols = await tableColumns(env, "orders");
  if (!cols.has("order_id")) return;

  const sets = [];
  const params = [];

  if (cols.has("product_selected")) { sets.push("product_selected = ?"); params.push(resolved.display_name); }
  if (cols.has("expected_deliverables")) { sets.push("expected_deliverables = ?"); params.push(expectedCount); }
  if (cols.has("expected_manifest_json")) { sets.push("expected_manifest_json = ?"); params.push(JSON.stringify(resolved.manifest)); }
  if (cols.has("status")) { sets.push("status = CASE WHEN status = 'complete' THEN status ELSE 'awaiting_intake' END"); }
  if (cols.has("updated_at")) { sets.push("updated_at = datetime('now')"); }

  if (!sets.length) return;
  params.push(orderId);
  await env.DB.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE order_id = ?`).bind(...params).run();
}

export async function expandOrder(request, env, orderId) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  if (!safeId(orderId)) return json({ success: false, error: "Invalid order_id" }, 400);
  const body = await readJson(request);
  if (!body) return json({ success: false, error: "Invalid JSON" }, 400);

  const order = await env.DB.prepare("SELECT order_id FROM orders WHERE order_id = ?").bind(orderId).first();
  if (!order) return json({ success: false, error: "Order not found" }, 404);

  const resolved = await resolveManifest(env, body);
  if (!resolved) return json({ success: false, error: "No active product manifest matches this purchase" }, 404);

  const requestType = safeId(body.request_type) ? body.request_type : "new";
  const jobMap = new Map();
  const deliverableMap = new Map();
  const created = [];

  for (const spec of resolved.manifest.jobs || []) {
    const jobId = await stableId("job", `${orderId}|${resolved.product_key}|${resolved.manifest_version}|${spec.job_key}`);
    jobMap.set(spec.job_key, jobId);
    if (spec.role === "primary") {
      const deliverableId = await stableId("del", `${orderId}|${resolved.product_key}|${resolved.manifest_version}|${spec.job_key}`);
      deliverableMap.set(spec.job_key, deliverableId);
    }
  }

  for (const spec of resolved.manifest.jobs || []) {
    const jobId = jobMap.get(spec.job_key);
    const parentJobId = spec.parent_job_key ? jobMap.get(spec.parent_job_key) || null : null;
    const deliverableId = spec.role === "primary"
      ? deliverableMap.get(spec.job_key)
      : spec.parent_job_key
        ? deliverableMap.get(spec.parent_job_key) || null
        : null;
    const ctx = {
      job_id: jobId,
      order_id: orderId,
      parent_job_id: parentJobId,
      deliverable_id: deliverableId,
      product_key: resolved.product_key,
      deliverable_type: spec.deliverable_type,
      component_type: spec.component_type || null,
      requested_lane: spec.requested_lane,
      job_role: spec.role,
      counts_toward_expected: spec.counts_toward_expected ? 1 : 0,
      request_type: requestType,
      sequence_index: Number(spec.sequence_index || 1),
      delivery_order: Number(spec.delivery_order || 1),
      manifest_version: resolved.manifest_version,
      status: "awaiting_intake",
      intake_status: spec.intake_type === "shared_parent_intake" ? "shared_parent" : "pending"
    };

    await env.DB.prepare(`
      INSERT INTO job_context (
        job_id, order_id, parent_job_id, deliverable_id, product_key, deliverable_type, component_type,
        requested_lane, job_role, counts_toward_expected, request_type, sequence_index,
        delivery_order, manifest_version, status, intake_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(job_id) DO UPDATE SET
        order_id=excluded.order_id,
        parent_job_id=excluded.parent_job_id,
        deliverable_id=excluded.deliverable_id,
        product_key=excluded.product_key,
        deliverable_type=excluded.deliverable_type,
        component_type=excluded.component_type,
        requested_lane=excluded.requested_lane,
        job_role=excluded.job_role,
        counts_toward_expected=excluded.counts_toward_expected,
        request_type=excluded.request_type,
        sequence_index=excluded.sequence_index,
        delivery_order=excluded.delivery_order,
        manifest_version=excluded.manifest_version,
        updated_at=datetime('now')
    `).bind(
      ctx.job_id, ctx.order_id, ctx.parent_job_id, ctx.deliverable_id, ctx.product_key, ctx.deliverable_type,
      ctx.component_type, ctx.requested_lane, ctx.job_role, ctx.counts_toward_expected,
      ctx.request_type, ctx.sequence_index, ctx.delivery_order, ctx.manifest_version,
      ctx.status, ctx.intake_status
    ).run();

    await mirrorJob(env, ctx, body);
    created.push(ctx);
  }

  const expectedCount = created.filter((x) => x.counts_toward_expected === 1).length;
  await updateOrderManifest(env, orderId, resolved, expectedCount);

  if (safeId(body.stripe_event_id)) {
    await env.DB.prepare(`
      INSERT INTO stripe_ingress_events (event_id, event_type, checkout_session_id, product_key, order_id, status, created_at, processed_at)
      VALUES (?, ?, ?, ?, ?, 'processed', datetime('now'), datetime('now'))
      ON CONFLICT(event_id) DO UPDATE SET
        product_key=excluded.product_key,
        order_id=excluded.order_id,
        status='processed',
        processed_at=datetime('now')
    `).bind(
      body.stripe_event_id,
      typeof body.stripe_event_type === "string" ? body.stripe_event_type.slice(0, 120) : null,
      typeof body.checkout_session_id === "string" ? body.checkout_session_id.slice(0, 200) : null,
      resolved.product_key,
      orderId
    ).run();
  }

  return json({
    success: true,
    order_id: orderId,
    product_key: resolved.product_key,
    display_name: resolved.display_name,
    manifest_version: resolved.manifest_version,
    expected_deliverables: expectedCount,
    jobs: created
  });
}

export async function createIntakeToken(request, env) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  const body = await readJson(request);
  if (!body || !safeId(body.order_id)) return json({ success: false, error: "Invalid order_id" }, 400);
  if (body.job_id != null && body.job_id !== "" && !safeId(body.job_id)) return json({ success: false, error: "Invalid job_id" }, 400);

  const order = await env.DB.prepare("SELECT order_id FROM orders WHERE order_id = ?").bind(body.order_id).first();
  if (!order) return json({ success: false, error: "Order not found" }, 404);

  if (body.job_id) {
    const job = await env.DB.prepare("SELECT job_id FROM job_context WHERE job_id = ? AND order_id = ?")
      .bind(body.job_id, body.order_id).first();
    if (!job) return json({ success: false, error: "Job not found for order" }, 404);
  }

  const rawToken = token(32);
  const tokenHash = await sha256Hex(rawToken);
  const ttlHours = Math.min(Math.max(Number(body.ttl_hours || DEFAULT_TOKEN_TTL_HOURS), 1), 168);
  const expiresAt = expiresAfterHours(ttlHours);
  const intakeType = typeof body.intake_type === "string" && body.intake_type ? body.intake_type.slice(0, 80) : "creative_brief";

  await env.DB.prepare(`
    INSERT INTO intake_tokens (token_hash, order_id, job_id, intake_type, active, created_at, expires_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
  `).bind(tokenHash, body.order_id, body.job_id || null, intakeType, expiresAt).run();

  return json({
    success: true,
    intake_token: rawToken,
    intake_type: intakeType,
    expires_at: expiresAt
  });
}

async function getTokenContext(env, rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 200) return null;
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(`
    SELECT token_hash, order_id, job_id, intake_type, active, expires_at, used_at
    FROM intake_tokens
    WHERE token_hash = ?
  `).bind(tokenHash).first();

  if (!row || Number(row.active) !== 1) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function resolveIntakeToken(request, env, rawToken) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  const row = await getTokenContext(env, rawToken);
  if (!row) return json({ success: false, error: "Invalid or expired intake token" }, 404);

  const jobs = row.job_id
    ? await env.DB.prepare("SELECT * FROM job_context WHERE job_id = ? AND order_id = ?").bind(row.job_id, row.order_id).all()
    : await env.DB.prepare("SELECT * FROM job_context WHERE order_id = ? ORDER BY sequence_index ASC").bind(row.order_id).all();

  return json({
    success: true,
    order_id: row.order_id,
    job_id: row.job_id || null,
    intake_type: row.intake_type,
    jobs: jobs.results || []
  });
}

export async function submitIntake(request, env, rawToken) {
  await ensureTables(env);
  const row = await getTokenContext(env, rawToken);
  if (!row) return json({ success: false, error: "Invalid or expired intake token" }, 404);

  const body = await readJson(request);
  if (!body) return json({ success: false, error: "Invalid JSON" }, 400);

  const payloadJson = JSON.stringify(body);
  if (payloadJson.length > 250000) return json({ success: false, error: "Intake payload is too large" }, 413);

  const submissionId = safeId(body.submission_id)
    ? body.submission_id
    : await stableId("intake", `${row.order_id}|${row.job_id || "order"}|${row.token_hash}`);

  await env.DB.prepare(`
    INSERT INTO intake_submissions (submission_id, token_hash, order_id, job_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(submission_id) DO UPDATE SET
      payload_json=excluded.payload_json
  `).bind(submissionId, row.token_hash, row.order_id, row.job_id || null, payloadJson).run();

  await env.DB.prepare("UPDATE intake_tokens SET active=0, used_at=datetime('now') WHERE token_hash=?")
    .bind(row.token_hash).run();

  if (row.job_id) {
    await env.DB.prepare(`
      UPDATE job_context
      SET intake_status='complete', status='production_ready', updated_at=datetime('now')
      WHERE job_id=?
    `).bind(row.job_id).run();

    const ctx = await env.DB.prepare("SELECT parent_job_id FROM job_context WHERE job_id=?").bind(row.job_id).first();
    if (!ctx?.parent_job_id) {
      await env.DB.prepare(`
        UPDATE job_context
        SET intake_status='shared_parent', status='production_ready', updated_at=datetime('now')
        WHERE parent_job_id=? AND intake_status='shared_parent'
      `).bind(row.job_id).run();
    }
  } else {
    await env.DB.prepare(`
      UPDATE job_context
      SET intake_status=CASE WHEN intake_status='shared_parent' THEN intake_status ELSE 'complete' END,
          status='production_ready',
          updated_at=datetime('now')
      WHERE order_id=?
    `).bind(row.order_id).run();
  }

  return json({ success: true, submission_id: submissionId, order_id: row.order_id, job_id: row.job_id || null });
}

export async function jobContext(request, env, jobId) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!safeId(jobId)) return json({ success: false, error: "Invalid job_id" }, 400);

  const job = await env.DB.prepare("SELECT * FROM job_context WHERE job_id = ?").bind(jobId).first();
  if (!job) return json({ success: false, error: "Job context not found" }, 404);

  const order = await env.DB.prepare(`
    SELECT order_id, customer_id, brand_id, customer_email, product_selected, status,
           expected_deliverables, completed_deliverables, delivery_email_sent_at
    FROM orders WHERE order_id = ?
  `).bind(job.order_id).first();

  const intake = await env.DB.prepare(`
    SELECT submission_id, payload_json, created_at
    FROM intake_submissions
    WHERE order_id = ? AND (job_id = ? OR job_id IS NULL)
    ORDER BY created_at DESC LIMIT 1
  `).bind(job.order_id, job.job_id).first();

  return json({
    success: true,
    job,
    order: order || null,
    intake: intake ? { ...intake, payload: JSON.parse(intake.payload_json) } : null
  });
}

export async function readyJobs(request, env) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 100);
  const role = url.searchParams.get("role") === "support" ? "support" : "primary";
  const componentType = url.searchParams.get("component_type");
  const productKey = url.searchParams.get("product_key");
  const requestedLane = url.searchParams.get("requested_lane");

  let sql = `
    SELECT * FROM job_context
    WHERE status='production_ready' AND job_role=?
  `;
  const params = [role];

  if (role === "support" && componentType) {
    if (!safeId(componentType)) return json({ success: false, error: "Invalid component_type" }, 400);
    sql += " AND component_type=?";
    params.push(componentType);
  }

  if (productKey) {
    if (!safeId(productKey)) return json({ success: false, error: "Invalid product_key" }, 400);
    sql += " AND product_key=?";
    params.push(productKey);
  }

  if (requestedLane) {
    if (!safeId(requestedLane)) return json({ success: false, error: "Invalid requested_lane" }, 400);
    sql += " AND requested_lane=?";
    params.push(requestedLane);
  }

  sql += " ORDER BY order_id ASC, sequence_index ASC LIMIT ?";
  params.push(limit);

  const result = await env.DB.prepare(sql).bind(...params).all();

  return json({
    success: true,
    job_role: role,
    component_type: role === "support" ? componentType || null : null,
    product_key: productKey || null,
    requested_lane: requestedLane || null,
    jobs: result.results || []
  });
}

export async function commerceStatus(request, env) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);

  const manifests = await env.DB.prepare(
    "SELECT product_key, display_name, manifest_version, active FROM product_manifests ORDER BY product_key"
  ).all();

  return json({
    success: true,
    manifests: manifests.results || [],
    contracts: {
      product_resolution: true,
      stripe_mapping: true,
      order_expansion: true,
      intake_tokens: true,
      intake_submission: true,
      production_job_context: true,
      ready_job_queue: true
    }
  });
}
