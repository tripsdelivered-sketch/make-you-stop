const TEMPLATE_KEY = "hook_pack_social_first_v1";
const TEMPLATE_VERSION = "1.0.0";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function authorised(request, env) {
  return Boolean(env.UPLOAD_SECRET) &&
    (request.headers.get("Authorization") || "") === `Bearer ${env.UPLOAD_SECRET}`;
}

function needAuth(request, env) {
  if (!env.UPLOAD_SECRET) return json({ success: false, error: "Backend secret is not configured" }, 500);
  if (!authorised(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  return null;
}

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((v) => v != null) : [];
}

function clamp(value, max = 500) {
  return text(value).slice(0, max);
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function normaliseHook(raw, index) {
  const rank = Number(raw?.rank || index + 1);
  return {
    rank,
    hook_text: clamp(raw?.hook_text, 700),
    hook_type: clamp(raw?.hook_type, 120),
    why_it_may_work: clamp(raw?.why_it_may_work, 900),
    opening_visual_suggestion: clamp(raw?.opening_visual_suggestion, 900),
    platform_note: clamp(raw?.platform_note, 700)
  };
}

function topThree(hooks, requested) {
  const ranks = list(requested).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
  const unique = [...new Set(ranks)];
  const selected = unique.length >= 3
    ? unique.slice(0, 3)
    : hooks.slice(0, 3).map((h) => h.rank);
  return selected.map((rank) => hooks.find((h) => h.rank === rank)).filter(Boolean);
}

function angleSummary(hooks) {
  const types = [...new Set(hooks.map((h) => h.hook_type).filter(Boolean))];
  return types.slice(0, 6);
}

function visualBrief(niche, subject, platforms) {
  const nicheText = niche || "creator";
  const subjectText = subject || "the customer's content";
  return {
    role: "supporting_hero_visual",
    purpose: "Make the personalised Hook Pack feel niche-specific and premium without implying the customer purchased a storyboard or finished image creative.",
    query: `${nicheText} creator, ${subjectText}, authentic social-first vertical content, mobile creator aesthetic, natural lighting, no logos, no unsupported product claims`,
    format: "portrait_9_16",
    platform_context: platforms
  };
}

function staticValuePages(niche, platforms, angles) {
  return [
    {
      page_key: "hook_formula",
      eyebrow: "WHY THESE HOOKS ARE BUILT THIS WAY",
      title: "Emotion + curiosity + tension.",
      body: [
        "A strong opening gives the viewer something to feel or recognise.",
        "It leaves one useful question unresolved so the next beat feels necessary.",
        "It creates enough tension, contrast or consequence to make the answer worth discovering."
      ]
    },
    {
      page_key: "first_seconds",
      eyebrow: "THE FIRST FEW SECONDS",
      title: "Make the next beat feel necessary.",
      body: [
        "Lead with the human tension before the feature, product or explanation.",
        "Use the visual to support the hook rather than repeat the exact same words.",
        "Reveal the practical payoff quickly enough that curiosity feels rewarded."
      ]
    },
    {
      page_key: "angles",
      eyebrow: "CREATIVE ANGLES IN THIS PACK",
      title: angles.length ? angles.join(" • ") : "Different ways into the same message.",
      body: [
        `These hooks are shaped for ${niche || "your niche"} content rather than generic viral wording.`,
        `Primary platforms: ${platforms.length ? platforms.join(" + ") : "short-form social"}.`,
        "Test different emotional entry points instead of changing everything at once."
      ]
    },
    {
      page_key: "test_plan",
      eyebrow: "QUICK TEST PLAN",
      title: "Test. Compare. Learn.",
      body: [
        "Start with the Top 3 highlighted hooks.",
        "Keep the core message similar so you can compare the opening itself.",
        "Look for stronger watch-through, saves, comments, profile visits or other signals relevant to your goal.",
        "Do not treat one result as a guarantee; use it as creative learning for the next test."
      ]
    }
  ];
}

export async function buildHookPackPresentation(request, env) {
  const authError = needAuth(request, env);
  if (authError) return authError;

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body) return json({ success: false, error: "Invalid JSON" }, 400);

  if (!safeId(body.order_id)) return json({ success: false, error: "Invalid order_id" }, 400);
  if (!safeId(body.job_id)) return json({ success: false, error: "Invalid job_id" }, 400);

  const hooks = list(body.hooks).map(normaliseHook).filter((h) => h.hook_text);
  if (hooks.length !== 10) {
    return json({
      success: false,
      error: "Hook Pack presentation requires exactly 10 approved hooks",
      received_hooks: hooks.length
    }, 422);
  }

  const niche = clamp(body.niche || body.creator_context?.niche, 160);
  const platforms = list(body.platforms || body.creator_context?.platforms).map((v) => clamp(v, 80)).filter(Boolean);
  const promotedSubject = clamp(body.promoted_subject || body.creator_context?.promoted_subject, 300);
  const brandSummary = clamp(body.brand_summary || body.creator_context?.brand_summary, 900);
  const keyMessage = clamp(body.key_message || body.creator_context?.key_message, 900);
  const contentStyle = clamp(body.content_style || body.creator_context?.content_style, 700);
  const creativeDirection = clamp(body.creative_direction || body.creator_context?.creative_direction, 700);
  const ctaStarters = list(body.cta_starters).map((v) => clamp(v, 350)).filter(Boolean).slice(0, 6);
  const usageNotes = list(body.usage_notes).map((v) => clamp(v, 500)).filter(Boolean).slice(0, 8);
  const top3 = topThree(hooks, body.top_3_ranks);
  const angles = angleSummary(hooks);

  const heroVisual = {
    ...visualBrief(niche, promotedSubject, platforms),
    asset_id: clamp(body.hero_visual?.asset_id, 100) || null,
    asset_url: clamp(body.hero_visual?.asset_url, 1200) || null,
    alt_text: clamp(body.hero_visual?.alt_text, 250) || `${niche || "Creator"} social content visual`
  };

  const pages = [
    {
      page_key: "cover",
      eyebrow: "PERSONALISED CREATIVE",
      title: "Your Hook Pack",
      subtitle: "10 personalised hooks built around your niche, message and goal.",
      niche,
      platforms,
      badges: ["10 hooks", "Top 3 highlighted", "CTA starters", "Usage direction"],
      hero_visual: heroVisual,
      footer_line: "Built to make someone feel something, wonder what happens next, and stay for the payoff."
    },
    {
      page_key: "brief",
      eyebrow: "YOUR BRIEF",
      title: "Built for your content.",
      niche,
      platforms,
      promoted_subject: promotedSubject,
      brand_summary: brandSummary,
      key_message: keyMessage,
      content_style: contentStyle,
      creative_direction: creativeDirection
    },
    ...staticValuePages(niche, platforms, angles),
    {
      page_key: "top_3",
      eyebrow: "TOP 3 TO TEST FIRST",
      title: `Start with ${top3.map((h) => h.rank).join(", ").replace(/, ([^,]*)$/, " and $1")}.`,
      hooks: top3
    },
    ...hooks.map((hook) => ({
      page_key: `hook_${String(hook.rank).padStart(2, "0")}`,
      eyebrow: `HOOK ${String(hook.rank).padStart(2, "0")}`,
      ...hook
    })),
    {
      page_key: "cta_starters",
      eyebrow: "CTA STARTERS",
      title: "Keep the ending natural.",
      items: ctaStarters
    },
    {
      page_key: "usage_direction",
      eyebrow: "USAGE DIRECTION",
      title: "How to use this pack.",
      items: usageNotes,
      closing: "The goal is not to sound viral. Give the viewer a reason to need the next beat."
    }
  ];

  const canvaData = {
    template_key: TEMPLATE_KEY,
    template_version: TEMPLATE_VERSION,
    order_id: body.order_id,
    job_id: body.job_id,
    niche,
    platform_line: platforms.join(" + "),
    promoted_subject: promotedSubject,
    brand_summary: brandSummary,
    key_message: keyMessage,
    content_style: contentStyle,
    creative_direction: creativeDirection,
    hero_visual_asset_id: heroVisual.asset_id,
    hero_visual_url: heroVisual.asset_url,
    hero_visual_alt_text: heroVisual.alt_text,
    top_3_ranks: top3.map((h) => h.rank).join(", "),
    creative_angles: angles.join(" • "),
    cta_1: ctaStarters[0] || "",
    cta_2: ctaStarters[1] || "",
    cta_3: ctaStarters[2] || "",
    usage_notes: usageNotes.join("\n"),
    ...Object.fromEntries(hooks.flatMap((hook) => {
      const n = String(hook.rank).padStart(2, "0");
      return [
        [`hook_${n}_text`, hook.hook_text],
        [`hook_${n}_type`, hook.hook_type],
        [`hook_${n}_why`, hook.why_it_may_work],
        [`hook_${n}_visual`, hook.opening_visual_suggestion],
        [`hook_${n}_platform`, hook.platform_note]
      ];
    }))
  };

  return json({
    success: true,
    product_key: "hooks",
    deliverable_type: "hooks",
    presentation: {
      template_key: TEMPLATE_KEY,
      template_version: TEMPLATE_VERSION,
      locked_brand_system: {
        palette: {
          ink: "#111111",
          cream: "#F4EEE5",
          coral: "#FF5F4A",
          soft_cream: "#FFF8F2"
        },
        aspect_ratio: "9:16",
        width: 1080,
        height: 1920,
        rule: "Presentation may adapt the niche visual and customer content, but must not rewrite approved hook content."
      },
      pages,
      canva_data: canvaData
    }
  });
}
