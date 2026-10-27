function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function auth(request,env){if(!env.UPLOAD_SECRET)return json({success:false,error:"Backend secret is not configured"},500);if((request.headers.get("Authorization")||"")!==`Bearer ${env.UPLOAD_SECRET}`)return json({success:false,error:"Unauthorized"},401);return null}
function safeId(v){return typeof v==="string"&&/^[A-Za-z0-9_-]+$/.test(v)}
async function ensure(env){
  if(!env.DB)throw new Error("D1 binding is not configured");
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS visual_assets (visual_asset_id TEXT PRIMARY KEY, customer_id TEXT, brand_id TEXT, source_type TEXT NOT NULL, source_ref TEXT, r2_key TEXT, external_provider TEXT, external_asset_id TEXT, description TEXT, tags_json TEXT, orientation TEXT, intended_uses_json TEXT, reuse_permission TEXT NOT NULL DEFAULT 'current_order_only', use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visual_assets_brand ON visual_assets(brand_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS visual_usage (usage_id TEXT PRIMARY KEY, visual_asset_id TEXT NOT NULL, order_id TEXT NOT NULL, job_id TEXT, deliverable_id TEXT, scene_key TEXT, used_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visual_usage_asset ON visual_usage(visual_asset_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visual_usage_brand_order ON visual_usage(order_id,used_at)")
  ])
}
function randomId(prefix){const a=new Uint8Array(12);crypto.getRandomValues(a);return prefix+Array.from(a,b=>b.toString(16).padStart(2,"0")).join("")}
export async function registerVisual(request,env){
  const e=auth(request,env);if(e)return e;await ensure(env);
  let b;try{b=await request.json()}catch{b=null}
  if(!b||!b.source_type)return json({success:false,error:"source_type is required"},400);
  const id=safeId(b.visual_asset_id)?b.visual_asset_id:randomId("visual_");
  await env.DB.prepare(`INSERT INTO visual_assets (visual_asset_id,customer_id,brand_id,source_type,source_ref,r2_key,external_provider,external_asset_id,description,tags_json,orientation,intended_uses_json,reuse_permission,use_count,last_used_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,datetime('now'))
    ON CONFLICT(visual_asset_id) DO UPDATE SET customer_id=excluded.customer_id,brand_id=excluded.brand_id,source_type=excluded.source_type,source_ref=excluded.source_ref,r2_key=excluded.r2_key,external_provider=excluded.external_provider,external_asset_id=excluded.external_asset_id,description=excluded.description,tags_json=excluded.tags_json,orientation=excluded.orientation,intended_uses_json=excluded.intended_uses_json,reuse_permission=excluded.reuse_permission`)
    .bind(id,b.customer_id||null,b.brand_id||null,String(b.source_type),b.source_ref||null,b.r2_key||null,b.external_provider||null,b.external_asset_id||null,b.description||null,JSON.stringify(b.tags||[]),b.orientation||null,JSON.stringify(b.intended_uses||[]),b.reuse_permission==="same_brand_allowed"?"same_brand_allowed":"current_order_only").run();
  return json({success:true,visual_asset_id:id});
}
export async function markVisualUsed(request,env){
  const e=auth(request,env);if(e)return e;await ensure(env);
  let b;try{b=await request.json()}catch{b=null}
  if(!b||!safeId(b.visual_asset_id)||!safeId(b.order_id))return json({success:false,error:"visual_asset_id and order_id are required"},400);
  const usageId=randomId("use_");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO visual_usage (usage_id,visual_asset_id,order_id,job_id,deliverable_id,scene_key,used_at) VALUES (?,?,?,?,?,?,datetime('now'))").bind(usageId,b.visual_asset_id,b.order_id,b.job_id||null,b.deliverable_id||null,b.scene_key||null),
    env.DB.prepare("UPDATE visual_assets SET use_count=use_count+1,last_used_at=datetime('now') WHERE visual_asset_id=?").bind(b.visual_asset_id)
  ]);
  return json({success:true,usage_id:usageId});
}
export async function visualCandidates(request,env){
  const e=auth(request,env);if(e)return e;await ensure(env);
  const u=new URL(request.url);const brand=u.searchParams.get("brand_id");const customer=u.searchParams.get("customer_id");const limit=Math.min(Math.max(Number(u.searchParams.get("limit")||20),1),50);
  if(!brand&&!customer)return json({success:false,error:"brand_id or customer_id is required"},400);
  const where=brand?"brand_id = ?":"customer_id = ?";const value=brand||customer;
  const result=await env.DB.prepare(`SELECT visual_asset_id,customer_id,brand_id,source_type,source_ref,r2_key,external_provider,external_asset_id,description,tags_json,orientation,intended_uses_json,reuse_permission,use_count,last_used_at,created_at FROM visual_assets WHERE ${where} AND (reuse_permission='same_brand_allowed' OR use_count=0) ORDER BY CASE WHEN last_used_at IS NULL THEN 0 ELSE 1 END ASC,use_count ASC,last_used_at ASC,created_at DESC LIMIT ?`).bind(value,limit).all();
  return json({success:true,selection_policy:"unused_first_then_least_used_then_least_recent",candidates:result.results||[]});
}
export async function recentVisualUsage(request,env){
  const e=auth(request,env);if(e)return e;await ensure(env);
  const u=new URL(request.url);const brand=u.searchParams.get("brand_id");if(!brand)return json({success:false,error:"brand_id is required"},400);
  const limit=Math.min(Math.max(Number(u.searchParams.get("limit")||50),1),100);
  const result=await env.DB.prepare("SELECT v.visual_asset_id,v.source_type,v.description,v.r2_key,v.external_provider,v.external_asset_id,v.use_count,v.last_used_at,u.order_id,u.job_id,u.deliverable_id,u.scene_key,u.used_at FROM visual_usage u JOIN visual_assets v ON v.visual_asset_id=u.visual_asset_id WHERE v.brand_id=? ORDER BY u.used_at DESC LIMIT ?").bind(brand,limit).all();
  return json({success:true,usage:result.results||[]});
}
