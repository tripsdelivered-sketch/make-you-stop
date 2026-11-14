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

function publicJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
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

const PRODUCT_KEY_ALIASES = {
  hook: "hooks",
  hook_pack: "hooks",
  personalised_hook: "hooks",
  image_words_pack: "image_words",
  what_to_say: "what_to_say_guide",
  storyboard_pack: "storyboard",
  unboxing: "unboxing_product_reveal"
};

function canonicalProductKey(value) {
  if (!safeId(value)) return null;
  return PRODUCT_KEY_ALIASES[value] || value;
}

const SEEDED_STRIPE_MAPPINGS = [
  { mapping_key: "price:price_1UZ90pBG3Bv4a9NrwDdEYWgo", product_key: "hooks" },
  { mapping_key: "product:prod_VaJe6zShQaEYHG", product_key: "hooks" },
  { mapping_key: "payment_link:plink_1UZ9JZBG3Bv4a9NrTrwe8Hi4", product_key: "hooks" },
  { mapping_key: "price:price_1UZ94DBG3Bv4a9Nr4bM8aB6X", product_key: "image_words" },
  { mapping_key: "product:prod_VaJhqJY7VC3kug", product_key: "image_words" },
  { mapping_key: "price:price_1UZ96CBG3Bv4a9NrzvsxrxUK", product_key: "what_to_say_guide" },
  { mapping_key: "product:prod_VaJjS6v1FnzCe6", product_key: "what_to_say_guide" },
  { mapping_key: "price:price_1UZ97oBG3Bv4a9Nr48BGaQFc", product_key: "storyboard" },
  { mapping_key: "product:prod_VaJlrDGGKFy1w1", product_key: "storyboard" },
  { mapping_key: "price:price_1UZ99UBG3Bv4a9NrCWZ8hXXb", product_key: "storyboard_showcase" },
  { mapping_key: "product:prod_VaJnl9rPu4KRau", product_key: "storyboard_showcase" },
  { mapping_key: "price:price_1UZ9B0BG3Bv4a9Nrd7sVeDjD", product_key: "unboxing_product_reveal" },
  { mapping_key: "product:prod_VaJoG1WjYBlu6L", product_key: "unboxing_product_reveal" },
  { mapping_key: "price:price_1UZ9CiBG3Bv4a9NroH0bknz8", product_key: "video_reel" },
  { mapping_key: "product:prod_VaJqVDVdi4316S", product_key: "video_reel" },
  { mapping_key: "price:price_1UZ3dfBG3Bv4a9NrJILRsKTP", product_key: "guide_ebook" },
  { mapping_key: "product:prod_VaE5LXVqUxXRR1", product_key: "guide_ebook" }
];

const CORE_MANIFESTS = [
  {
    product_key: "hooks",
    display_name: "Hook Pack",
    manifest_version: 2,
    output_requirements: {
      quantity: 10,
      required_sections: ["top_3_highlights", "cta_starters", "usage_notes"]
    },
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
    display_name: "Storyboard Pack",
    manifest_version: 2,
    offer_contract: {
      currency: "USD",
      price: 19,
      promise: "Turn one idea into two possible social story directions before you film.",
      customer_outcome: "See two clear ways to turn the idea into content before filming.",
      deliverables: [
        "2 storyboard directions",
        "Hook + emotional angle",
        "5-stage story flow for each",
        "Shot / visual direction",
        "Payoff + CTA",
        "Simple filming notes"
      ],
      storyboard_direction_count: 2,
      stages_per_direction: 5,
      includes_showcase_frames: false
    },
    jobs: [
      { job_key: "storyboard", role: "primary", deliverable_type: "storyboard", requested_lane: "storyboard", counts_toward_expected: true, sequence_index: 1, delivery_order: 1, intake_type: "creative_brief" }
    ]
  },
  {
    product_key: "storyboard_showcase",
    display_name: "Storyboard + Showcase",
    manifest_version: 2,
    required_components: ["storyboard", "showcase"],
    offer_contract: {
      currency: "USD",
      price: 29,
      promise: "Plan the story and see the strongest beats visually before filming.",
      customer_outcome: "See how the selected story direction could actually be filmed.",
      deliverables: [
        "2 storyboard directions",
        "Selected strongest direction",
        "3–5 showcase frames",
        "Camera / shot guide",
        "Phone filming + framing tips",
        "Payoff + CTA direction"
      ],
      storyboard_direction_count: 2,
      select_strongest_direction: true,
      showcase_frame_min: 3,
      showcase_frame_max: 5,
      showcase_frames_must_map_to_story_beats: true,
      one_counted_primary_deliverable: true,
      component_counting: {
        storyboard: false,
        showcase: false
      }
    },
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
      production_claim_id TEXT,
      production_claimed_at TEXT,
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS shopping_intents (
      intent_id TEXT PRIMARY KEY,
      audience TEXT,
      niches_json TEXT NOT NULL DEFAULT '[]',
      needs_json TEXT NOT NULL DEFAULT '[]',
      goal TEXT,
      brief_json TEXT NOT NULL DEFAULT '{}',
      selected_product_key TEXT NOT NULL,
      source TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      order_id TEXT,
      checkout_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shopping_intents_order ON shopping_intents(order_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shopping_intents_checkout ON shopping_intents(checkout_session_id)"),
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
  if (!jobContextCols.has("production_claim_id")) {
    await env.DB.prepare("ALTER TABLE job_context ADD COLUMN production_claim_id TEXT").run();
  }
  if (!jobContextCols.has("production_claimed_at")) {
    await env.DB.prepare("ALTER TABLE job_context ADD COLUMN production_claimed_at TEXT").run();
  }

  const shoppingIntentCols = await tableColumns(env, "shopping_intents");
  const shoppingIntentMigrations = [
    ["audience", "TEXT"],
    ["niches_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["needs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["goal", "TEXT"],
    ["brief_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["selected_product_key", "TEXT"],
    ["source", "TEXT"],
    ["active", "INTEGER NOT NULL DEFAULT 1"],
    ["order_id", "TEXT"],
    ["checkout_session_id", "TEXT"],
    ["created_at", "TEXT"],
    ["expires_at", "TEXT"],
    ["consumed_at", "TEXT"]
  ];
  for (const [column, definition] of shoppingIntentMigrations) {
    if (!shoppingIntentCols.has(column)) {
      await env.DB.prepare(`ALTER TABLE shopping_intents ADD COLUMN ${column} ${definition}`).run();
    }
  }

  for (const mapping of SEEDED_STRIPE_MAPPINGS) {
    await env.DB.prepare(`
      INSERT INTO stripe_product_mappings (mapping_key, product_key, active, created_at, updated_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(mapping_key) DO UPDATE SET
        product_key = excluded.product_key,
        active = 1,
        updated_at = datetime('now')
    `).bind(mapping.mapping_key, mapping.product_key).run();
  }

  for (const manifest of CORE_MANIFESTS) {
    await env.DB.prepare(`
      INSERT INTO product_manifests (
        product_key, display_name, manifest_version, manifest_json, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(product_key) DO UPDATE SET
        display_name = CASE
          WHEN excluded.manifest_version > product_manifests.manifest_version THEN excluded.display_name
          ELSE product_manifests.display_name
        END,
        manifest_version = CASE
          WHEN excluded.manifest_version > product_manifests.manifest_version THEN excluded.manifest_version
          ELSE product_manifests.manifest_version
        END,
        manifest_json = CASE
          WHEN excluded.manifest_version > product_manifests.manifest_version THEN excluded.manifest_json
          ELSE product_manifests.manifest_json
        END,
        updated_at = CASE
          WHEN excluded.manifest_version > product_manifests.manifest_version THEN datetime('now')
          ELSE product_manifests.updated_at
        END
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
  let productKey = canonicalProductKey(body?.product_key);

  if (!productKey) {
    const candidates = extractStripePurchaseKeys(body);

    for (const mappingKey of candidates) {
      const mapping = await env.DB.prepare(
        "SELECT product_key FROM stripe_product_mappings WHERE mapping_key = ? AND active = 1"
      ).bind(mappingKey).first();
      if (mapping?.product_key) {
        productKey = canonicalProductKey(mapping.product_key);
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


function cleanText(value, max = 160) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function cleanTextList(value, maxItems = 8, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength)
    .slice(0, maxItems);
}

function cleanBrief(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  const textFields = [
    "promotion_subject",
    "brand_summary",
    "key_message",
    "cta",
    "destination_type",
    "destination_url",
    "action_instruction",
    "extra_notes",
    "audience_detail",
    "guide_outcome",
    "must_include",
    "filming_plan",
    "asset_status",
    "template_key"
  ];
  for (const key of textFields) {
    const cleaned = cleanText(input[key], key === "extra_notes" || key === "must_include" ? 2000 : 800);
    if (cleaned) out[key] = cleaned;
  }
  const platforms = cleanTextList(input.platforms, 8, 80);
  if (platforms.length) out.platforms = platforms;
  return out;
}

const MAKE_LANE_BY_CANONICAL = {
  hooks: "Hooks only",
  image_words: "Image",
  video_reel: "video_reel",
  guide_ebook: "Guide / eBook",
  storyboard: "storyboard",
  storyboard_showcase: "storyboard_showcase",
  what_to_say_guide: "What to Say Guide",
  unboxing_product_reveal: "Unboxing / Product Reveal",
  "Storyboard / Showcase": "Storyboard / Showcase"
};

function makeRequestedLane(value) {
  const lane = typeof value === "string" ? value.trim() : "";
  return MAKE_LANE_BY_CANONICAL[lane] || lane || null;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstListValue(value) {
  return Array.isArray(value) && value.length ? value[0] : null;
}

function makeExecutionContract({ job, order, manifest, shoppingIntent, intake, intakePayload, assets }) {
  const brief = shoppingIntent?.brief && typeof shoppingIntent.brief === "object"
    ? shoppingIntent.brief
    : {};
  const payload = intakePayload && typeof intakePayload === "object" && !Array.isArray(intakePayload)
    ? intakePayload
    : {};
  const platform = firstText(
    firstListValue(brief.platforms),
    firstListValue(payload.platforms),
    payload.platform
  );
  const promotedSubject = firstText(
    brief.promotion_subject,
    payload.promoted_subject,
    payload.promotion_subject
  );
  const briefText = firstText(
    brief.key_message,
    payload.brief,
    payload.key_message,
    brief.brand_summary
  );
  const audience = firstText(
    shoppingIntent?.audience,
    brief.audience_detail,
    payload.audience
  );
  const desiredOutcome = firstText(
    shoppingIntent?.goal,
    brief.guide_outcome,
    brief.cta,
    payload.desired_outcome,
    payload.cta
  );
  const additionalNotes = firstText(
    brief.extra_notes,
    payload.additional_notes,
    payload.extra_notes
  );
  const brandName = firstText(payload.brand_name, payload.name_or_brand_name);
  const brandContext = firstText(brief.brand_summary, payload.brand_summary, payload.brand_context);
  const customerName = firstText(payload.customer_name, payload.full_name);
  const assetUsePolicy = firstText(payload.asset_use_policy, payload.asset_policy);
  const approvedClaims = payload.approved_claims || null;
  const ctaAction = firstText(brief.cta, payload.cta);
  const ctaDestinationType = firstText(brief.destination_type, payload.destination_type);
  const ctaDestinationValue = firstText(brief.destination_url, payload.destination_url);
  const approvedPurchaseInstruction = firstText(brief.action_instruction, payload.action_instruction);
  const importantInclusions = payload.important_inclusions || brief.must_include || null;
  const thingsToAvoid = payload.things_to_avoid || null;
  const productionObjective = firstText(payload.production_objective, desiredOutcome);
  const productionDirection = firstText(payload.production_direction, brief.key_message, payload.key_message);
  const assetManifest = assets.map((asset) => ({
    asset_id: asset.asset_id,
    order_id: asset.order_id,
    job_id: asset.job_id,
    customer_id: asset.customer_id || null,
    brand_id: asset.brand_id || null,
    original_name: asset.original_name || null,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes == null ? null : Number(asset.size_bytes),
    reuse_permission: asset.reuse_permission,
    source_type: asset.source_type,
    created_at: asset.created_at
  }));

  return {
    contract: "make_execution_v1",
    job_id: job.job_id,
    order_id: job.order_id,
    parent_job_id: job.parent_job_id || null,
    deliverable_id: job.deliverable_id || null,
    product_key: job.product_key,
    deliverable_type: job.deliverable_type,
    component_type: job.component_type || null,
    job_role: job.job_role,
    sequence_index: Number(job.sequence_index || 1),
    delivery_order: Number(job.delivery_order || 1),
    canonical_requested_lane: job.requested_lane,
    requested_lane: makeRequestedLane(job.requested_lane),
    manifest,
    output_requirements: manifest?.output_requirements || null,

    customer_name: customerName,
    brand_name: brandName,
    product_selected: order?.product_selected || null,
    promoted_subject: promotedSubject,
    brief: briefText,
    platform,
    audience,
    desired_outcome: desiredOutcome,
    production_objective: productionObjective,
    production_direction: productionDirection,
    important_inclusions: importantInclusions,
    things_to_avoid: thingsToAvoid,
    additional_notes: additionalNotes,
    asset_manifest: assetManifest,
    supplied_assets: assetManifest,
    asset_use_policy: assetUsePolicy,

    cta: {
      desired_customer_action: ctaAction || desiredOutcome,
      destination_type: ctaDestinationType,
      destination_value: ctaDestinationValue,
      approved_purchase_instruction: approvedPurchaseInstruction,
      approved_claims: approvedClaims
    },

    assets: {
      manifest: assetManifest,
      supplied_assets: assetManifest,
      asset_use_policy: assetUsePolicy
    },

    customer_context: {
      customer_id: order?.customer_id || null,
      brand_id: order?.brand_id || null,
      customer_email: order?.customer_email || null,
      customer_name: customerName,
      brand_name: brandName,
      product_selected: order?.product_selected || null,
      promoted_subject: promotedSubject,
      brief: briefText,
      brand_context: brandContext,
      platform,
      audience,
      desired_outcome: desiredOutcome,
      important_inclusions: importantInclusions,
      things_to_avoid: thingsToAvoid,
      additional_notes: additionalNotes,
      asset_use_policy: assetUsePolicy,
      cta_action: ctaAction,
      cta_destination_type: ctaDestinationType,
      cta_destination_value: ctaDestinationValue,
      approved_purchase_instruction: approvedPurchaseInstruction,
      approved_claims: approvedClaims
    },
    shopping_intent: shoppingIntent,
    intake: intake ? {
      submission_id: intake.submission_id,
      created_at: intake.created_at,
      payload: intakePayload
    } : null
  };
}

async function ensureShoppingIntentTable(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shopping_intents (
    intent_id TEXT PRIMARY KEY,
    audience TEXT,
    niches_json TEXT NOT NULL DEFAULT '[]',
    needs_json TEXT NOT NULL DEFAULT '[]',
    goal TEXT,
    brief_json TEXT NOT NULL DEFAULT '{}',
    selected_product_key TEXT,
    source TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    order_id TEXT,
    checkout_session_id TEXT,
    created_at TEXT,
    expires_at TEXT,
    consumed_at TEXT
  )`).run();

  const cols = await tableColumns(env, "shopping_intents");
  const migrations = [
    ["audience", "TEXT"],
    ["niches_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["needs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["goal", "TEXT"],
    ["brief_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["selected_product_key", "TEXT"],
    ["source", "TEXT"],
    ["active", "INTEGER NOT NULL DEFAULT 1"],
    ["order_id", "TEXT"],
    ["checkout_session_id", "TEXT"],
    ["created_at", "TEXT"],
    ["expires_at", "TEXT"],
    ["consumed_at", "TEXT"]
  ];
  for (const [column, definition] of migrations) {
    if (!cols.has(column)) {
      await env.DB.prepare(`ALTER TABLE shopping_intents ADD COLUMN ${column} ${definition}`).run();
    }
  }
}

export async function createShoppingIntent(request, env) {
  try {
    await ensureShoppingIntentTable(env);

    const body = await readJson(request);
    if (!body || !safeId(body.product_key)) {
      return publicJson({ success: false, error: "Invalid product_key" }, 400);
    }

    const canonicalKey = canonicalProductKey(body.product_key);
    const coreManifest = CORE_MANIFESTS.find((item) => item.product_key === canonicalKey);
    if (!coreManifest) return publicJson({ success: false, error: "Unknown product_key" }, 404);

  const allowedAudiences = new Set(["creator", "small-business", "brand"]);
  const audience = allowedAudiences.has(body.audience) ? body.audience : null;
  const niches = cleanTextList(body.niches ?? (body.niche ? [body.niche] : []), 5, 80);
  const needs = cleanTextList(body.needs ?? (body.need ? [body.need] : []), 8, 120);
  const goal = cleanText(body.goal, 160);
  const brief = cleanBrief(body.brief);
  const source = cleanText(body.source, 80) || "website";

  const intentId = `intent_${token(18)}`;
  const expiresAt = expiresAfterHours(24);

  await env.DB.prepare(`
    INSERT INTO shopping_intents (
      intent_id, audience, niches_json, needs_json, goal, brief_json,
      selected_product_key, source, active, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)
  `).bind(
    intentId,
    audience,
    JSON.stringify(niches),
    JSON.stringify(needs),
    goal,
    JSON.stringify(brief),
    coreManifest.product_key,
    source,
    expiresAt
  ).run();

    return publicJson({
      success: true,
      intent_id: intentId,
      product_key: coreManifest.product_key,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error("createShoppingIntent failed", error);
    return publicJson({
      success: false,
      error: "Unable to prepare checkout",
      detail: String(error?.message || error || "Unknown error").slice(0, 240)
    }, 500);
  }
}

async function attachShoppingIntent(env, body, orderId, resolved) {
  const session = body?.checkout_session && typeof body.checkout_session === "object"
    ? body.checkout_session
    : body?.session && typeof body.session === "object"
      ? body.session
      : null;

  const intentId =
    (safeId(body?.shopping_intent_id) && body.shopping_intent_id) ||
    (safeId(body?.client_reference_id) && body.client_reference_id) ||
    (safeId(session?.client_reference_id) && session.client_reference_id) ||
    null;

  if (!intentId) return null;

  const row = await env.DB.prepare(`
    SELECT *
    FROM shopping_intents
    WHERE intent_id = ? AND active = 1
  `).bind(intentId).first();

  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.selected_product_key !== resolved.product_key) {
    throw new Error("Shopping intent product does not match purchased product");
  }

  const checkoutSessionId =
    cleanText(body?.checkout_session_id, 200) ||
    cleanText(session?.id, 200) ||
    null;

  await env.DB.prepare(`
    UPDATE shopping_intents
    SET order_id = ?,
        checkout_session_id = ?,
        consumed_at = COALESCE(consumed_at, datetime('now'))
    WHERE intent_id = ?
  `).bind(orderId, checkoutSessionId, intentId).run();

  return {
    intent_id: row.intent_id,
    audience: row.audience || null,
    niches: JSON.parse(row.niches_json || "[]"),
    needs: JSON.parse(row.needs_json || "[]"),
    goal: row.goal || null,
    brief: JSON.parse(row.brief_json || "{}"),
    selected_product_key: row.selected_product_key,
    source: row.source || null
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


function landingBriefCanStartProduction(productKey, brief) {
  if (!brief || typeof brief !== "object") return false;
  const hasCore = Boolean(brief.promotion_subject && brief.brand_summary && brief.key_message);
  if (!hasCore) return false;
  return new Set(["hooks", "what_to_say_guide"]).has(productKey);
}

async function applyLandingBriefAsIntake(env, orderId, jobs, shoppingIntent) {
  if (!shoppingIntent || !landingBriefCanStartProduction(shoppingIntent.selected_product_key, shoppingIntent.brief)) {
    return { applied: false };
  }

  const primary = (jobs || []).find((job) => job.job_role === "primary");
  if (!primary) return { applied: false };

  const submissionId = await stableId("intake", orderId + "|" + primary.job_id + "|storefront");
  const payload = {
    source: "storefront_pre_payment_brief",
    audience: shoppingIntent.audience || null,
    niches: shoppingIntent.niches || [],
    needs: shoppingIntent.needs || [],
    goal: shoppingIntent.goal || null,
    product_key: shoppingIntent.selected_product_key,
    brief: shoppingIntent.brief || {}
  };

  await env.DB.prepare(`
    INSERT INTO intake_submissions (submission_id, token_hash, order_id, job_id, payload_json, created_at)
    VALUES (?, 'storefront', ?, ?, ?, datetime('now'))
    ON CONFLICT(submission_id) DO UPDATE SET
      payload_json=excluded.payload_json
  `).bind(submissionId, orderId, primary.job_id, JSON.stringify(payload)).run();

  await env.DB.prepare(`
    UPDATE job_context
    SET intake_status='complete', status='production_ready', updated_at=datetime('now')
    WHERE job_id=?
  `).bind(primary.job_id).run();

  await env.DB.prepare(`
    UPDATE job_context
    SET status='production_ready', updated_at=datetime('now')
    WHERE parent_job_id=? AND intake_status='shared_parent'
  `).bind(primary.job_id).run();

  return { applied: true, submission_id: submissionId, job_id: primary.job_id };
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

  let shoppingIntent = null;
  try {
    shoppingIntent = await attachShoppingIntent(env, body, orderId, resolved);
  } catch (error) {
    return json({ success: false, error: error.message || "Invalid shopping intent" }, 409);
  }

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
      manifest: resolved.manifest,
      output_requirements: resolved.manifest?.output_requirements || null,
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

  const storefrontIntake = await applyLandingBriefAsIntake(env, orderId, created, shoppingIntent);
  const productionDispatch = await dispatchReadyJobsToMake(env, orderId);

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
    shopping_intent: shoppingIntent,
    storefront_intake: storefrontIntake,
    production_dispatch: productionDispatch,
    jobs: created
  });
}


export async function startIntakeFromCheckout(request, env, tallyBaseUrl) {
  await ensureTables(env);

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") || "";
  if (!/^cs_(test_)?[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 220) {
    return new Response("<h1>Invalid checkout session</h1>", {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const intent = await env.DB.prepare(`
    SELECT intent_id, order_id, selected_product_key
    FROM shopping_intents
    WHERE checkout_session_id = ? AND order_id IS NOT NULL
    ORDER BY consumed_at DESC
    LIMIT 1
  `).bind(sessionId).first();

  if (!intent?.order_id) {
    return new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>Preparing your creative brief</title></head>
<body style="font-family:Arial,sans-serif;max-width:620px;margin:80px auto;padding:0 20px">
<h1>Payment received.</h1>
<p>We’re preparing your creative brief now. This page will continue automatically.</p>
</body></html>`, {
      status: 202,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const job = await env.DB.prepare(`
    SELECT job_id, product_key, status, intake_status
    FROM job_context
    WHERE order_id = ? AND job_role = 'primary'
    ORDER BY sequence_index ASC
    LIMIT 1
  `).bind(intent.order_id).first();

  if (!job?.job_id) {
    return new Response("<h1>Your order exists, but the creative job is not ready yet.</h1>", {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  if (job.status === "production_ready" && job.intake_status === "complete") {
    return new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your creative is underway</title></head>
<body style="font-family:Arial,sans-serif;max-width:620px;margin:80px auto;padding:0 20px">
<h1>You’re all set.</h1>
<p>We have your payment and the brief needed to create your order. Make You Stop can now move it into production.</p>
<p>You do not need to complete another form.</p>
</body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  await env.DB.prepare(`
    UPDATE intake_tokens
    SET active = 0
    WHERE order_id = ? AND job_id = ? AND active = 1
  `).bind(intent.order_id, job.job_id).run();

  const rawToken = token(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = expiresAfterHours(DEFAULT_TOKEN_TTL_HOURS);

  await env.DB.prepare(`
    INSERT INTO intake_tokens (token_hash, order_id, job_id, intake_type, active, created_at, expires_at)
    VALUES (?, ?, ?, 'creative_brief', 1, datetime('now'), ?)
  `).bind(tokenHash, intent.order_id, job.job_id, expiresAt).run();

  const target = new URL(tallyBaseUrl);
  target.searchParams.set("intake_token", rawToken);
  target.searchParams.set("order_id", intent.order_id);
  target.searchParams.set("job_id", job.job_id);
  target.searchParams.set("product_key", job.product_key);

  return Response.redirect(target.toString(), 302);
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

  const productionDispatch = await dispatchReadyJobsToMake(env, row.order_id);

  return json({
    success: true,
    submission_id: submissionId,
    order_id: row.order_id,
    job_id: row.job_id || null,
    production_dispatch: productionDispatch
  });
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
           expected_deliverables, completed_deliverables, delivery_email_sent_at, expected_manifest_json
    FROM orders WHERE order_id = ?
  `).bind(job.order_id).first();

  const intake = await env.DB.prepare(`
    SELECT submission_id, payload_json, created_at
    FROM intake_submissions
    WHERE order_id = ? AND (job_id = ? OR job_id IS NULL)
    ORDER BY created_at DESC LIMIT 1
  `).bind(job.order_id, job.job_id).first();

  let manifest = null;
  try { manifest = order?.expected_manifest_json ? JSON.parse(order.expected_manifest_json) : null; } catch {}

  return json({
    success: true,
    job: { ...job, manifest, output_requirements: manifest?.output_requirements || null },
    order: order || null,
    manifest,
    intake: intake ? { ...intake, payload: JSON.parse(intake.payload_json) } : null
  });
}


export async function claimProductionJob(request, env, jobId) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!safeId(jobId)) return json({ success: false, error: "Invalid job_id" }, 400);

  const body = await readJson(request).catch(() => null);
  const requestedClaimId = body?.claim_id == null || body.claim_id === ""
    ? `production_${jobId}`
    : String(body.claim_id);

  if (!safeId(requestedClaimId)) {
    return json({ success: false, error: "Invalid claim_id" }, 400);
  }

  const existing = await env.DB.prepare(`
    SELECT job_id, order_id, deliverable_id, product_key, requested_lane, status,
           intake_status, production_claim_id, production_claimed_at
    FROM job_context
    WHERE job_id = ?
  `).bind(jobId).first();

  if (!existing) return json({ success: false, error: "Job context not found" }, 404);

  // A retry using the same deterministic claim is a safe replay, not a second production start.
  if (existing.status === "production_claimed" && existing.production_claim_id === requestedClaimId) {
    return json({
      success: true,
      claimed: true,
      claimed_now: false,
      idempotent_replay: true,
      claim_id: requestedClaimId,
      job: existing
    });
  }

  if (existing.status !== "production_ready") {
    return json({
      success: false,
      error: "Job is not available for production claim",
      current_status: existing.status,
      existing_claim_id: existing.production_claim_id || null
    }, 409);
  }

  const result = await env.DB.prepare(`
    UPDATE job_context
    SET status = 'production_claimed',
        production_claim_id = ?,
        production_claimed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE job_id = ?
      AND status = 'production_ready'
      AND (production_claim_id IS NULL OR production_claim_id = '')
  `).bind(requestedClaimId, jobId).run();

  if (Number(result.meta?.changes || 0) !== 1) {
    const raced = await env.DB.prepare(`
      SELECT job_id, order_id, deliverable_id, product_key, requested_lane, status,
             intake_status, production_claim_id, production_claimed_at
      FROM job_context
      WHERE job_id = ?
    `).bind(jobId).first();

    if (raced?.status === "production_claimed" && raced.production_claim_id === requestedClaimId) {
      return json({
        success: true,
        claimed: true,
        claimed_now: false,
        idempotent_replay: true,
        claim_id: requestedClaimId,
        job: raced
      });
    }

    return json({
      success: false,
      error: "Production claim conflict",
      current_status: raced?.status || null,
      existing_claim_id: raced?.production_claim_id || null
    }, 409);
  }

  const claimed = await env.DB.prepare(`
    SELECT job_id, order_id, parent_job_id, deliverable_id, product_key, deliverable_type,
           component_type, requested_lane, job_role, counts_toward_expected, request_type,
           sequence_index, delivery_order, manifest_version, status, intake_status,
           production_claim_id, production_claimed_at
    FROM job_context
    WHERE job_id = ?
  `).bind(jobId).first();

  return json({
    success: true,
    claimed: true,
    claimed_now: true,
    idempotent_replay: false,
    claim_id: requestedClaimId,
    job: claimed
  });
}


export async function productionContext(request, env, jobId) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!safeId(jobId)) return json({ success: false, error: "Invalid job_id" }, 400);

  const job = await env.DB.prepare("SELECT * FROM job_context WHERE job_id = ?").bind(jobId).first();
  if (!job) return json({ success: false, error: "Job context not found" }, 404);

  const order = await env.DB.prepare(`
    SELECT order_id, customer_id, brand_id, customer_email, product_selected, status,
           expected_deliverables, completed_deliverables, delivery_email_sent_at, expected_manifest_json
    FROM orders WHERE order_id = ?
  `).bind(job.order_id).first();

  const intake = await env.DB.prepare(`
    SELECT submission_id, payload_json, created_at
    FROM intake_submissions
    WHERE order_id = ? AND (job_id = ? OR job_id IS NULL)
    ORDER BY created_at DESC LIMIT 1
  `).bind(job.order_id, job.job_id).first();

  const uploadedAssetsTable = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='uploaded_assets'"
  ).first();

  let assets = [];
  if (uploadedAssetsTable) {
    const result = await env.DB.prepare(`
      SELECT asset_id, order_id, job_id, customer_id, brand_id, original_name,
             mime_type, size_bytes, reuse_permission, source_type, created_at
      FROM uploaded_assets
      WHERE order_id = ?
      ORDER BY created_at ASC
    `).bind(job.order_id).all();
    assets = result.results || [];
  }

  const intakePayload = intake ? JSON.parse(intake.payload_json) : null;

  const intent = await env.DB.prepare(`
    SELECT intent_id, audience, niches_json, needs_json, goal, brief_json, selected_product_key, source, created_at
    FROM shopping_intents
    WHERE order_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(job.order_id).first();

  const shoppingIntent = intent ? {
    intent_id: intent.intent_id,
    audience: intent.audience || null,
    niches: JSON.parse(intent.niches_json || "[]"),
    needs: JSON.parse(intent.needs_json || "[]"),
    goal: intent.goal || null,
    brief: JSON.parse(intent.brief_json || "{}"),
    selected_product_key: intent.selected_product_key,
    source: intent.source || null,
    created_at: intent.created_at
  } : null;

  let manifest = null;
  try { manifest = order?.expected_manifest_json ? JSON.parse(order.expected_manifest_json) : null; } catch {}

  const executionContract = makeExecutionContract({
    job,
    order,
    manifest,
    shoppingIntent,
    intake,
    intakePayload,
    assets
  });

  return json({
    success: true,
    contract: "production_context_v1",
    engine_contract: "make_execution_v1",
    execution_contract: executionContract,
    engine_context: executionContract,
    job: {
      job_id: job.job_id,
      order_id: job.order_id,
      parent_job_id: job.parent_job_id || null,
      deliverable_id: job.deliverable_id || null,
      product_key: job.product_key,
      deliverable_type: job.deliverable_type,
      component_type: job.component_type || null,
      requested_lane: job.requested_lane,
      job_role: job.job_role,
      counts_toward_expected: Number(job.counts_toward_expected || 0),
      request_type: job.request_type,
      sequence_index: Number(job.sequence_index || 1),
      delivery_order: Number(job.delivery_order || 1),
      manifest_version: Number(job.manifest_version || 1),
      manifest,
      output_requirements: manifest?.output_requirements || null,
      status: job.status,
      intake_status: job.intake_status
    },
    manifest,
    customer_context: {
      customer_id: order?.customer_id || null,
      brand_id: order?.brand_id || null,
      customer_email: order?.customer_email || null,
      product_selected: order?.product_selected || null
    },
    shopping_intent: shoppingIntent,
    intake: intake ? {
      submission_id: intake.submission_id,
      created_at: intake.created_at,
      payload: intakePayload
    } : null,
    asset_manifest: assets.map((asset) => ({
      asset_id: asset.asset_id,
      order_id: asset.order_id,
      job_id: asset.job_id,
      customer_id: asset.customer_id || null,
      brand_id: asset.brand_id || null,
      original_name: asset.original_name || null,
      mime_type: asset.mime_type,
      size_bytes: asset.size_bytes == null ? null : Number(asset.size_bytes),
      reuse_permission: asset.reuse_permission,
      source_type: asset.source_type,
      created_at: asset.created_at
    }))
  });
}


async function rollbackProductionClaim(env, jobId, claimId) {
  await env.DB.prepare(`
    UPDATE job_context
    SET status='production_ready',
        production_claim_id=NULL,
        production_claimed_at=NULL,
        updated_at=datetime('now')
    WHERE job_id=?
      AND status='production_claimed'
      AND production_claim_id=?
  `).bind(jobId, claimId).run();
}

async function dispatchProductionJobToMake(env, jobId) {
  if (!env.MAKE_PRODUCTION_INGRESS_URL || !env.MAKE_PRODUCTION_INGRESS_API_KEY) {
    return { job_id: jobId, dispatched: false, skipped: true, reason: "make_ingress_not_configured" };
  }

  const claimId = `production_${jobId}`;
  const internalHeaders = {
    "Authorization": `Bearer ${env.UPLOAD_SECRET}`,
    "Content-Type": "application/json"
  };

  const claimRequest = new Request(`https://internal.invalid/api/jobs/${jobId}/claim`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ claim_id: claimId })
  });
  const claimResponse = await claimProductionJob(claimRequest, env, jobId);
  const claimPayload = await claimResponse.json().catch(() => ({}));

  if (!claimResponse.ok || claimPayload?.claimed_now !== true) {
    return {
      job_id: jobId,
      dispatched: false,
      skipped: true,
      reason: claimPayload?.idempotent_replay ? "already_claimed" : "claim_not_acquired",
      claim_status: claimResponse.status
    };
  }

  try {
    const contextRequest = new Request(`https://internal.invalid/api/jobs/${jobId}/production-context`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${env.UPLOAD_SECRET}` }
    });
    const contextResponse = await productionContext(contextRequest, env, jobId);
    const productionPayload = await contextResponse.json().catch(() => null);

    if (!contextResponse.ok || !productionPayload || productionPayload.contract !== "production_context_v1") {
      await rollbackProductionClaim(env, jobId, claimId);
      return {
        job_id: jobId,
        dispatched: false,
        reason: "production_context_failed",
        context_status: contextResponse.status
      };
    }

    const makeResponse = await fetch(env.MAKE_PRODUCTION_INGRESS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": env.MAKE_PRODUCTION_INGRESS_API_KEY
      },
      body: JSON.stringify(productionPayload)
    });

    if (!makeResponse.ok) {
      await rollbackProductionClaim(env, jobId, claimId);
      return {
        job_id: jobId,
        dispatched: false,
        reason: "make_ingress_rejected",
        make_status: makeResponse.status
      };
    }

    return {
      job_id: jobId,
      dispatched: true,
      claim_id: claimId,
      make_status: makeResponse.status
    };
  } catch (error) {
    await rollbackProductionClaim(env, jobId, claimId);
    return {
      job_id: jobId,
      dispatched: false,
      reason: "make_ingress_error",
      error: error?.message || "Unknown Make ingress error"
    };
  }
}

export async function redispatchProductionJob(request, env, jobId) {
  const authError = auth(request, env);
  if (authError) return authError;
  await ensureTables(env);
  if (!safeId(jobId)) return json({ success: false, error: "Invalid job_id" }, 400);

  const body = await readJson(request).catch(() => ({}));
  const expectedClaimId = typeof body?.expected_claim_id === "string" && body.expected_claim_id
    ? body.expected_claim_id
    : `production_${jobId}`;

  const current = await env.DB.prepare(`
    SELECT job_id, order_id, status, production_claim_id
    FROM job_context
    WHERE job_id = ?
  `).bind(jobId).first();

  if (!current) return json({ success: false, error: "Job context not found" }, 404);

  if (current.status !== "production_claimed" || current.production_claim_id !== expectedClaimId) {
    return json({
      success: false,
      error: "Job is not in the expected claimed state",
      current_status: current.status || null,
      current_claim_id: current.production_claim_id || null,
      expected_claim_id: expectedClaimId
    }, 409);
  }

  await env.DB.prepare(`
    UPDATE job_context
    SET status='production_ready',
        production_claim_id=NULL,
        production_claimed_at=NULL,
        updated_at=datetime('now')
    WHERE job_id=?
      AND status='production_claimed'
      AND production_claim_id=?
  `).bind(jobId, expectedClaimId).run();

  const result = await dispatchProductionJobToMake(env, jobId);
  return json({
    success: Boolean(result?.dispatched),
    redispatch: true,
    job_id: jobId,
    previous_claim_id: expectedClaimId,
    dispatch: result
  }, result?.dispatched ? 200 : 409);
}


async function dispatchReadyJobsToMake(env, orderId) {
  if (!env.MAKE_PRODUCTION_INGRESS_URL || !env.MAKE_PRODUCTION_INGRESS_API_KEY) return [];

  const result = await env.DB.prepare(`
    SELECT job_id
    FROM job_context
    WHERE order_id=? AND status='production_ready'
    ORDER BY sequence_index ASC
  `).bind(orderId).all();

  const dispatches = [];
  for (const row of result.results || []) {
    dispatches.push(await dispatchProductionJobToMake(env, row.job_id));
  }
  return dispatches;
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
    SELECT jc.*, o.expected_manifest_json
    FROM job_context jc
    LEFT JOIN orders o ON o.order_id = jc.order_id
    WHERE jc.status='production_ready' AND jc.job_role=?
  `;
  const params = [role];

  if (role === "support" && componentType) {
    if (!safeId(componentType)) return json({ success: false, error: "Invalid component_type" }, 400);
    sql += " AND jc.component_type=?";
    params.push(componentType);
  }

  if (productKey) {
    if (!safeId(productKey)) return json({ success: false, error: "Invalid product_key" }, 400);
    sql += " AND jc.product_key=?";
    params.push(productKey);
  }

  if (requestedLane) {
    if (!safeId(requestedLane)) return json({ success: false, error: "Invalid requested_lane" }, 400);
    sql += " AND jc.requested_lane=?";
    params.push(requestedLane);
  }

  sql += " ORDER BY jc.order_id ASC, jc.sequence_index ASC LIMIT ?";
  params.push(limit);

  const result = await env.DB.prepare(sql).bind(...params).all();

  const jobs = (result.results || []).map((row) => {
    let manifest = null;
    try { manifest = row.expected_manifest_json ? JSON.parse(row.expected_manifest_json) : null; } catch {}
    const { expected_manifest_json, ...job } = row;
    return { ...job, manifest, output_requirements: manifest?.output_requirements || null };
  });

  return json({
    success: true,
    job_role: role,
    component_type: role === "support" ? componentType || null : null,
    product_key: productKey || null,
    requested_lane: requestedLane || null,
    jobs
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
      shopping_intent: true,
      order_expansion: true,
      intake_tokens: true,
      intake_submission: true,
      production_job_context: true,
      ready_job_queue: true
    }
  });
}
