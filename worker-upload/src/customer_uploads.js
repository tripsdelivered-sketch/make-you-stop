const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const BASE_URL = "https://make-you-stop-upload.tripsdelivered.workers.dev";

const TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf"
};

function j(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

function h(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      "Content-Type":"text/html; charset=utf-8",
      "Cache-Control":"no-store",
      "X-Frame-Options":"DENY",
      "Referrer-Policy":"no-referrer"
    }
  });
}

function safeId(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v);
}

function randomToken(bytes) {
  const data = new Uint8Array(bytes || 32);
  crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

async function hash(v) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map(function(b){return b.toString(16).padStart(2,"0");}).join("");
}

function auth(request, env) {
  if (!env.UPLOAD_SECRET) return j({success:false,error:"Upload secret is not configured"},500);
  if ((request.headers.get("Authorization") || "") !== "Bearer " + env.UPLOAD_SECRET) {
    return j({success:false,error:"Unauthorized"},401);
  }
  return null;
}

async function ensure(env) {
  if (!env.DB) throw new Error("D1 binding is not configured");
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS upload_sessions (token_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL, job_id TEXT NOT NULL, customer_id TEXT, brand_id TEXT, max_files INTEGER NOT NULL DEFAULT 10, uploaded_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_upload_sessions_order ON upload_sessions(order_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS uploaded_assets (asset_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, job_id TEXT NOT NULL, customer_id TEXT, brand_id TEXT, original_name TEXT, r2_key TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER, reuse_permission TEXT NOT NULL DEFAULT 'current_order_only', source_type TEXT NOT NULL DEFAULT 'supplied', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_uploaded_assets_order ON uploaded_assets(order_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_uploaded_assets_brand ON uploaded_assets(brand_id)")
  ]);
}

async function session(env, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const tokenHash = await hash(token);
  const row = await env.DB.prepare("SELECT token_hash,order_id,job_id,customer_id,brand_id,max_files,uploaded_count,active,expires_at FROM upload_sessions WHERE token_hash=?").bind(tokenHash).first();
  if (!row || Number(row.active) !== 1) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function createUploadSession(request, env) {
  const e = auth(request, env);
  if (e) return e;
  await ensure(env);
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || !safeId(body.order_id) || !safeId(body.job_id)) return j({success:false,error:"Invalid order_id or job_id"},400);
  if (body.customer_id && !safeId(body.customer_id)) return j({success:false,error:"Invalid customer_id"},400);
  if (body.brand_id && !safeId(body.brand_id)) return j({success:false,error:"Invalid brand_id"},400);

  const maxFiles = Math.min(Math.max(Number(body.max_files || DEFAULT_MAX_FILES),1),20);
  const ttlHours = Math.min(Math.max(Number(body.ttl_hours || 48),1),168);
  const token = randomToken(32);
  const tokenHash = await hash(token);
  const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();

  await env.DB.prepare("INSERT INTO upload_sessions (token_hash,order_id,job_id,customer_id,brand_id,max_files,uploaded_count,active,created_at,expires_at) VALUES (?,?,?,?,?,?,0,1,datetime('now'),?)")
    .bind(tokenHash,body.order_id,body.job_id,body.customer_id || null,body.brand_id || null,maxFiles,expiresAt).run();

  return j({success:true,upload_url:BASE_URL + "/customer-upload/" + token,max_files:maxFiles,max_file_bytes:MAX_FILE_BYTES,expires_at:expiresAt});
}

export async function uploadPage(env, token) {
  await ensure(env);
  const s = await session(env, token);
  if (!s) return h("<h1>This upload link is unavailable or has expired.</h1>",404);
  const remaining = Math.max(0, Number(s.max_files)-Number(s.uploaded_count));
  const page = [
    "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
    "<title>Upload files — Make You Stop</title><style>",
    "body{margin:0;background:#0b0b0d;color:#fff;font-family:Arial,sans-serif}main{max-width:720px;margin:auto;padding:42px 20px}small{letter-spacing:.14em;color:#9ca3af}h1{font-size:42px}p{color:#d1d5db;line-height:1.6}.panel{padding:20px;border:1px solid #29292f;border-radius:18px;background:#151519}input,select,button{font:inherit}input{display:block;margin:16px 0}select{width:100%;padding:12px;background:#0b0b0d;color:#fff}button{padding:14px 18px;font-weight:700}.ok{color:#a7f3d0}.err{color:#fca5a5}",
    "</style></head><body><main><small>MAKE YOU STOP</small><h1>Upload your creative files.</h1>",
    "<p>Add the photos, video clips or PDFs you want us to use. Files go directly into private Make You Stop storage.</p><div class='panel'>",
    "<p><strong>" + remaining + "</strong> upload slots remaining.</p>",
    "<label>Can these files be reused for future work for the same brand?</label><select id='reuse'><option value='current_order_only'>No — this order only</option><option value='same_brand_allowed'>Yes — same brand future work</option></select>",
    "<input id='files' type='file' multiple accept='image/png,image/jpeg,image/webp,video/mp4,video/quicktime,application/pdf'>",
    "<button id='go'" + (remaining < 1 ? " disabled" : "") + ">Upload files</button><p id='status'></p>",
    "<p>Maximum 50 MB per file. Accepted: PNG, JPG/JPEG, WEBP, MP4, MOV and PDF.</p></div></main>",
    "<script>",
    "const token=" + JSON.stringify(token) + ",limit=" + remaining + ",max=" + MAX_FILE_BYTES + ";const f=document.getElementById('files'),b=document.getElementById('go'),s=document.getElementById('status');",
    "b&&b.addEventListener('click',async()=>{const files=[...f.files];if(!files.length){s.className='err';s.textContent='Choose at least one file.';return}if(files.length>limit){s.className='err';s.textContent='Choose no more than '+limit+' files.';return}for(const x of files){if(x.size>max){s.className='err';s.textContent=x.name+' is larger than 50 MB.';return}}b.disabled=true;let n=0;try{for(const x of files){s.className='';s.textContent='Uploading '+x.name+'…';const r=await fetch('/customer-upload/'+encodeURIComponent(token)+'/file',{method:'PUT',headers:{'Content-Type':x.type||'application/octet-stream','X-File-Name':encodeURIComponent(x.name),'X-File-Size':String(x.size),'X-Reuse-Permission':document.getElementById('reuse').value},body:x});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success)throw new Error(d.error||'Upload failed.');n++}s.className='ok';s.textContent=n+' file'+(n===1?'':'s')+' uploaded securely.';f.value=''}catch(err){s.className='err';s.textContent=err.message||'Upload failed.';b.disabled=false}});",
    "</script></body></html>"
  ].join("");
  return h(page,200);
}

export async function uploadFile(request, env, token) {
  await ensure(env);
  const s = await session(env, token);
  if (!s) return j({success:false,error:"Upload link unavailable or expired"},404);
  if (Number(s.uploaded_count) >= Number(s.max_files)) return j({success:false,error:"Upload limit reached"},409);

  const mime = request.headers.get("Content-Type") || "";
  const ext = TYPES[mime];
  if (!ext) return j({success:false,error:"Unsupported file type"},400);

  const size = Number(request.headers.get("Content-Length") || request.headers.get("X-File-Size") || 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return j({success:false,error:"Invalid or oversized file"},413);

  let name = "upload";
  try { name = decodeURIComponent(request.headers.get("X-File-Name") || "upload"); } catch {}
  const reuse = request.headers.get("X-Reuse-Permission") === "same_brand_allowed" ? "same_brand_allowed" : "current_order_only";
  const assetId = "asset_" + randomToken(18);
  const key = "assets/" + s.order_id + "/" + s.job_id + "/" + assetId + "." + ext;

  await env.BUCKET.put(key, request.body, {
    httpMetadata:{contentType:mime},
    customMetadata:{source:"customer_upload",reuse_permission:reuse}
  });

  await env.DB.batch([
    env.DB.prepare("INSERT INTO uploaded_assets (asset_id,order_id,job_id,customer_id,brand_id,original_name,r2_key,mime_type,size_bytes,reuse_permission,source_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'supplied',datetime('now'))")
      .bind(assetId,s.order_id,s.job_id,s.customer_id || null,s.brand_id || null,String(name).slice(0,300),key,mime,size,reuse),
    env.DB.prepare("UPDATE upload_sessions SET uploaded_count=uploaded_count+1,active=CASE WHEN uploaded_count+1>=max_files THEN 0 ELSE active END WHERE token_hash=? AND active=1 AND uploaded_count<max_files").bind(s.token_hash)
  ]);

  return j({success:true,asset_id:assetId,mime_type:mime,size_bytes:size,reuse_permission:reuse});
}

export async function orderAssets(request, env, orderId) {
  const e = auth(request, env);
  if (e) return e;
  await ensure(env);
  if (!safeId(orderId)) return j({success:false,error:"Invalid order_id"},400);
  const result = await env.DB.prepare("SELECT asset_id,order_id,job_id,customer_id,brand_id,original_name,r2_key,mime_type,size_bytes,reuse_permission,source_type,created_at FROM uploaded_assets WHERE order_id=? ORDER BY created_at ASC").bind(orderId).all();
  return j({success:true,assets:result.results || []});
}
