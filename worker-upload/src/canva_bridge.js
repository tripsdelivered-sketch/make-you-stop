const API = "https://api.canva.com/rest/v1";
const AUTHORIZE = "https://www.canva.com/api/oauth/authorize";
const REDIRECT_PATH = "/canva/oauth/callback";
const DEFAULT_SCOPES = [
  "asset:read",
  "asset:write",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "brandtemplate:meta:read",
  "brandtemplate:content:read"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY"}
  });
}

function authorised(request, env) {
  return Boolean(env.UPLOAD_SECRET) && (request.headers.get("Authorization") || "") === `Bearer ${env.UPLOAD_SECRET}`;
}

function needAuth(request, env) {
  if (!env.UPLOAD_SECRET) return json({success:false,error:"Backend secret is not configured"},500);
  if (!authorised(request, env)) return json({success:false,error:"Unauthorized"},401);
  return null;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

function randomToken(bytes = 48) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

async function sha256Base64url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function cryptoKey(env) {
  if (!env.UPLOAD_SECRET) throw new Error("Backend secret is not configured");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`canva:${env.UPLOAD_SECRET}`));
  return crypto.subtle.importKey("raw", raw, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
}

async function encrypt(value, env) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await cryptoKey(env);
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, new TextEncoder().encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}

function fromBase64url(value) {
  const padded = value.replace(/-/g,"+").replace(/_/g,"/") + "===".slice((value.length + 3) % 4);
  const s = atob(padded);
  return Uint8Array.from(s, c=>c.charCodeAt(0));
}

async function decrypt(value, env) {
  const [ivText,cipherText] = String(value || "").split(".");
  if (!ivText || !cipherText) throw new Error("Invalid encrypted value");
  const key = await cryptoKey(env);
  const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64url(ivText)}, key, fromBase64url(cipherText));
  return new TextDecoder().decode(plain);
}

async function ensureTables(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS canva_oauth_states (state_hash TEXT PRIMARY KEY, verifier_encrypted TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS canva_connection (connection_id TEXT PRIMARY KEY, access_token_encrypted TEXT, refresh_token_encrypted TEXT, expires_at TEXT, scopes TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS canva_jobs (job_key TEXT PRIMARY KEY, job_type TEXT NOT NULL, canva_job_id TEXT, canva_design_id TEXT, status TEXT, payload_json TEXT, result_json TEXT, order_id TEXT, job_id TEXT, deliverable_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_canva_jobs_order ON canva_jobs(order_id)")
  ]);
}

function configured(env) {
  return Boolean(env.CANVA_CLIENT_ID && env.CANVA_CLIENT_SECRET);
}

function redirectUri(request) {
  return new URL(request.url).origin + REDIRECT_PATH;
}

async function tokenRequest(env, params) {
  const credentials = btoa(`${env.CANVA_CLIENT_ID}:${env.CANVA_CLIENT_SECRET}`);
  const response = await fetch(`${API}/oauth/token`, {
    method:"POST",
    headers:{"Authorization":`Basic ${credentials}`,"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams(params)
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.message || data.error || `Canva token request failed (${response.status})`);
  return data;
}

async function saveTokens(env, data) {
  const expires = new Date(Date.now() + Number(data.expires_in || 14400) * 1000).toISOString();
  const access = await encrypt(data.access_token, env);
  const refresh = data.refresh_token ? await encrypt(data.refresh_token, env) : null;
  await env.DB.prepare(`INSERT INTO canva_connection (connection_id,access_token_encrypted,refresh_token_encrypted,expires_at,scopes,updated_at)
    VALUES ('primary',?,?,?,?,datetime('now'))
    ON CONFLICT(connection_id) DO UPDATE SET access_token_encrypted=excluded.access_token_encrypted,refresh_token_encrypted=COALESCE(excluded.refresh_token_encrypted,canva_connection.refresh_token_encrypted),expires_at=excluded.expires_at,scopes=excluded.scopes,updated_at=datetime('now')`)
    .bind(access,refresh,expires,String(data.scope || "")).run();
}

async function accessToken(env) {
  await ensureTables(env);
  const row = await env.DB.prepare("SELECT * FROM canva_connection WHERE connection_id='primary'").first();
  if (!row || !row.access_token_encrypted) throw new Error("Canva is not connected");
  const stillValid = row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60000;
  if (stillValid) return decrypt(row.access_token_encrypted, env);
  if (!row.refresh_token_encrypted) throw new Error("Canva connection needs reauthorization");
  const refresh = await decrypt(row.refresh_token_encrypted, env);
  const data = await tokenRequest(env,{grant_type:"refresh_token",refresh_token:refresh});
  await saveTokens(env,data);
  return data.access_token;
}

async function canvaFetch(env, path, options = {}) {
  const token = await accessToken(env);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization",`Bearer ${token}`);
  if (options.body && !(options.body instanceof ArrayBuffer) && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
  const response = await fetch(`${API}${path}`, {...options,headers});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.message || data.error || `Canva API failed (${response.status})`);
  return data;
}

export async function canvaStatus(request, env) {
  const e = needAuth(request,env); if (e) return e;
  await ensureTables(env);
  const row = await env.DB.prepare("SELECT connection_id,expires_at,scopes,updated_at FROM canva_connection WHERE connection_id='primary'").first();
  return json({success:true,configured:configured(env),connected:Boolean(row),connection:row || null});
}

export async function canvaAuthStart(request, env) {
  const e = needAuth(request,env); if (e) return e;
  await ensureTables(env);
  if (!configured(env)) return json({success:false,error:"Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET as Worker secrets first"},409);
  const verifier = randomToken(72);
  const challenge = await sha256Base64url(verifier);
  const state = randomToken(48);
  const stateHash = await sha256Hex(state);
  const encrypted = await encrypt(verifier,env);
  const expires = new Date(Date.now()+15*60*1000).toISOString();
  await env.DB.prepare("INSERT INTO canva_oauth_states (state_hash,verifier_encrypted,created_at,expires_at) VALUES (?,?,datetime('now'),?)")
    .bind(stateHash,encrypted,expires).run();
  const url = new URL(AUTHORIZE);
  url.searchParams.set("code_challenge",challenge);
  url.searchParams.set("code_challenge_method","S256");
  url.searchParams.set("scope",DEFAULT_SCOPES.join(" "));
  url.searchParams.set("response_type","code");
  url.searchParams.set("client_id",env.CANVA_CLIENT_ID);
  url.searchParams.set("state",state);
  url.searchParams.set("redirect_uri",redirectUri(request));
  return json({success:true,authorize_url:url.toString(),redirect_uri:redirectUri(request),scopes:DEFAULT_SCOPES});
}

export async function canvaCallback(request, env) {
  await ensureTables(env);
  if (!configured(env)) return html("<h1>Canva is not configured.</h1>",500);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return html("<h1>Canva authorization was not completed.</h1>",400);
  const stateHash = await sha256Hex(state);
  const row = await env.DB.prepare("SELECT verifier_encrypted,expires_at FROM canva_oauth_states WHERE state_hash=?").bind(stateHash).first();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return html("<h1>This Canva authorization session is invalid or expired.</h1>",400);
  const verifier = await decrypt(row.verifier_encrypted,env);
  const data = await tokenRequest(env,{grant_type:"authorization_code",code,code_verifier:verifier,redirect_uri:redirectUri(request)});
  await saveTokens(env,data);
  await env.DB.prepare("DELETE FROM canva_oauth_states WHERE state_hash=?").bind(stateHash).run();
  return html("<!doctype html><html><body style='font-family:Arial;padding:40px'><h1>Canva connected to Make You Stop.</h1><p>You can close this tab.</p></body></html>");
}

export async function canvaCreateDesign(request, env) {
  const e = needAuth(request,env); if (e) return e;
  let body; try { body=await request.json(); } catch { body=null; }
  if (!body) return json({success:false,error:"Invalid JSON"},400);
  const payload = {type:"type_and_asset"};
  if (body.design_type) payload.design_type = body.design_type;
  if (body.asset_id) payload.asset_id = body.asset_id;
  if (body.title) payload.title = String(body.title).slice(0,200);
  const result = await canvaFetch(env,"/designs",{method:"POST",body:JSON.stringify(payload)});
  return json({success:true,result});
}

export async function canvaBrandTemplates(request, env) {
  const e = needAuth(request,env); if (e) return e;
  const result = await canvaFetch(env,"/brand-templates?limit=100",{method:"GET"});
  return json({success:true,result});
}

export async function canvaTemplateDataset(request, env, templateId) {
  const e = needAuth(request,env); if (e) return e;
  const result = await canvaFetch(env,`/brand-templates/${encodeURIComponent(templateId)}/dataset`,{method:"GET"});
  return json({success:true,result});
}

export async function canvaAutofill(request, env) {
  const e = needAuth(request,env); if (e) return e;
  let body; try { body=await request.json(); } catch { body=null; }
  if (!body || !body.brand_template_id || !body.data) return json({success:false,error:"brand_template_id and data are required"},400);
  const payload = {brand_template_id:body.brand_template_id,data:body.data};
  if (body.title) payload.title=String(body.title).slice(0,200);
  const result = await canvaFetch(env,"/autofills",{method:"POST",body:JSON.stringify(payload)});
  return json({success:true,result});
}

export async function canvaExport(request, env) {
  const e = needAuth(request,env); if (e) return e;
  let body; try { body=await request.json(); } catch { body=null; }
  if (!body || !body.design_id || !body.format) return json({success:false,error:"design_id and format are required"},400);
  const allowed = new Set(["pdf","png","jpg","gif","pptx","mp4","html_bundle","html_standalone"]);
  if (!allowed.has(body.format)) return json({success:false,error:"Unsupported export format"},400);
  const payload = {design_id:body.design_id,format:{type:body.format}};
  if (Array.isArray(body.pages) && body.pages.length) payload.format.pages=body.pages;
  const result = await canvaFetch(env,"/exports",{method:"POST",body:JSON.stringify(payload)});
  return json({success:true,result});
}

export async function canvaExportStatus(request, env, exportId) {
  const e = needAuth(request,env); if (e) return e;
  const result = await canvaFetch(env,`/exports/${encodeURIComponent(exportId)}`,{method:"GET"});
  return json({success:true,result});
}

export async function canvaExportWait(request, env, exportId) {
  const e = needAuth(request,env); if (e) return e;

  const url = new URL(request.url);
  const requestedAttempts = Number(url.searchParams.get("max_attempts") || 12);
  const requestedIntervalMs = Number(url.searchParams.get("interval_ms") || 1500);
  const maxAttempts = Math.min(Math.max(Number.isFinite(requestedAttempts) ? Math.trunc(requestedAttempts) : 12, 1), 20);
  const intervalMs = Math.min(Math.max(Number.isFinite(requestedIntervalMs) ? Math.trunc(requestedIntervalMs) : 1500, 500), 5000);

  let result = null;
  const statuses = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await canvaFetch(env,`/exports/${encodeURIComponent(exportId)}`,{method:"GET"});
    const status = result?.job?.status || "unknown";
    statuses.push(status);

    if (status === "success" || status === "failed") {
      return json({
        success: true,
        completed: true,
        final_status: status,
        attempts: attempt,
        interval_ms: intervalMs,
        statuses,
        result
      });
    }

    if (status !== "in_progress") {
      return json({
        success: false,
        completed: false,
        final_status: status,
        attempts: attempt,
        interval_ms: intervalMs,
        statuses,
        result,
        error: "Unexpected Canva export status"
      }, 502);
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return json({
    success: true,
    completed: false,
    final_status: "timeout",
    attempts: maxAttempts,
    interval_ms: intervalMs,
    statuses,
    result
  });
}
