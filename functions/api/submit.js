const MAX_BODY_BYTES = 20000;
const ALLOWED_FORM_TYPES = new Set(["custom_quote", "order_support"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value, max = 4000) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function normaliseData(formType, raw) {
  const data = raw && typeof raw === "object" ? raw : {};

  if (formType === "custom_quote") {
    return {
      name: clean(data.name, 200),
      email: clean(data.email, 320),
      brief: clean(data.brief, 5000),
      assets: clean(data.assets, 1000)
    };
  }

  return {
    request_type: clean(data.request_type, 100),
    order_reference: clean(data.order_reference, 200),
    details: clean(data.details, 5000)
  };
}

function requiredFieldsPresent(formType, data) {
  if (formType === "custom_quote") {
    return Boolean(data.name && data.email && data.brief);
  }
  return Boolean(data.request_type && data.details);
}

async function verifyTurnstile(secret, token, request) {
  const ip = request.headers.get("CF-Connecting-IP") || undefined;

  const payload = new FormData();
  payload.append("secret", secret);
  payload.append("response", token);
  if (ip) payload.append("remoteip", ip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: payload }
  );

  if (!response.ok) {
    return { success: false, "error-codes": ["siteverify-unavailable"] };
  }
  return response.json();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.TURNSTILE_SECRET_KEY) {
    return json({ ok: false, message: "Form protection is not configured yet." }, 503);
  }
  if (!env.MAKE_FORM_WEBHOOK_URL) {
    return json({ ok: false, message: "Form delivery is not configured yet." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, message: "Submission is too large." }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Invalid submission." }, 400);
  }

  const formType = clean(body.form_type, 50);
  const token = clean(body.turnstile_token, 4096);

  if (!ALLOWED_FORM_TYPES.has(formType) || !token) {
    return json({ ok: false, message: "Please complete all required checks." }, 400);
  }

  const verification = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, request);
  if (!verification.success) {
    return json({ ok: false, message: "Anti-bot verification failed. Please try again." }, 400);
  }

  if (env.TURNSTILE_HOSTNAME && verification.hostname !== env.TURNSTILE_HOSTNAME) {
    return json({ ok: false, message: "Anti-bot verification failed." }, 400);
  }

  if (verification.action && verification.action !== formType) {
    return json({ ok: false, message: "Anti-bot verification failed." }, 400);
  }

  const data = normaliseData(formType, body.data);
  if (!requiredFieldsPresent(formType, data)) {
    return json({ ok: false, message: "Please complete the required fields." }, 400);
  }

  const forwardPayload = {
    source: "make-you-stop-website",
    form_type: formType,
    submitted_at: new Date().toISOString(),
    turnstile: {
      verified: true,
      hostname: verification.hostname || null,
      action: verification.action || null
    },
    data
  };

  const headers = { "Content-Type": "application/json" };
  if (env.FORM_FORWARD_SECRET) {
    headers["X-Make-You-Stop-Token"] = env.FORM_FORWARD_SECRET;
  }

  const forwarded = await fetch(env.MAKE_FORM_WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(forwardPayload)
  });

  if (!forwarded.ok) {
    return json({ ok: false, message: "We could not send your request. Please try again." }, 502);
  }

  return json({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ ok: false, message: "Method not allowed." }, 405);
  }
  return onRequestPost(context);
}
