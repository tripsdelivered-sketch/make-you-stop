function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
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
