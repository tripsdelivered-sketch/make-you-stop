const BRAND_SYSTEM = {
  palette: {
    ink: "#111111",
    cream: "#F4EEE5",
    coral: "#FF5F4A",
    soft_cream: "#FFF8F2"
  },
  aspect_ratio: "9:16",
  width: 1080,
  height: 1920,
  brand_rule: "Every customer presentation must feel recognisably Make You Stop while adapting its hero media, page hierarchy and value-add guidance to the purchased lane.",
  content_rule: "Presentation may frame, organise and visually explain approved engine output, but must not rewrite approved customer deliverables or invent claims."
};

export const PRESENTATION_TEMPLATES = {
  hooks: {
    canva_master_design_id: "DAHa1lyR0Yk",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "hook_pack_social_first_v1",
    display_name: "Hook Pack",
    hero_media: "niche_image_or_creator_mobile_visual",
    delivery_format: "pdf",
    value_pages: ["your_brief","why_hooks_work","first_seconds","creative_angles","top_3","quick_test_plan","cta_starters","usage_direction"],
    customer_promise: ["10 personalised hooks","Different creative angles","Emotion + curiosity + tension mix","Top 3 highlighted","CTA starters + usage direction"]
  },
  image_words: {
    canva_master_design_id: "DAHa1jnIYVw",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "image_words_social_first_v1",
    display_name: "Image / Words",
    hero_media: "finished_image_words_creative",
    delivery_format: "pdf_or_image",
    value_pages: ["your_brief","creative_thinking","message_hierarchy","how_to_use","platform_notes"],
    customer_promise: ["Finished Image / Words creative","On-image words as part of the concept/story","Platform-ready creative direction"]
  },
  video_reel: {
    canva_master_design_id: "DAHa1vhLOlo",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "video_reel_social_first_v1",
    display_name: "Video / Reel",
    hero_media: "finished_vertical_video_or_motion_preview",
    delivery_format: "mp4_plus_companion_pdf",
    value_pages: ["your_brief","opening_frame","story_progression","timing_pacing","on_screen_text","platform_notes","how_to_use"],
    customer_promise: ["Finished short-form Video / Reel","Text/caption-led visual story","No included voiceover, music or platform audio"]
  },
  what_to_say_guide: {
    canva_master_design_id: "DAHa1q-3GBI",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "what_to_say_social_first_v1",
    display_name: "What to Say Guide",
    hero_media: "niche_creator_or_speaking_visual",
    delivery_format: "pdf",
    value_pages: ["your_brief","message_structure","opening_options","talking_points","delivery_tips","platform_notes"],
    customer_promise: ["Practical speaking/message guidance shaped around the brief"]
  },
  storyboard: {
    canva_master_design_id: "DAHa1ouNp6M",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "storyboard_social_first_v1",
    display_name: "Storyboard Pack",
    hero_media: "storyboard_frames_or_niche_visual",
    delivery_format: "pdf",
    value_pages: ["your_brief","two_directions","hook_emotional_angle","story_flow","shot_direction","payoff_cta","filming_notes"],
    customer_promise: ["2 storyboard directions","Hook + emotional angle","5-stage story flow for each","Shot / visual direction","Payoff + CTA","Simple filming notes"]
  },
  storyboard_showcase: {
    canva_master_design_id: "DAHa1gFxZkk",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "storyboard_showcase_social_first_v1",
    display_name: "Storyboard + Showcase",
    hero_media: "showcase_frames",
    delivery_format: "pdf",
    value_pages: ["your_brief","two_directions","selected_direction","showcase_frames","camera_shot_guide","phone_framing","payoff_cta"],
    customer_promise: ["2 storyboard directions","Selected strongest direction","3–5 showcase frames","Camera / shot guide","Phone filming + framing tips","Payoff + CTA direction"]
  },
  guide_ebook: {
    canva_master_design_id: "DAHa1oXcIC4",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "guide_ebook_editorial_v1",
    display_name: "Guide / eBook",
    hero_media: "editorial_niche_cover_visual",
    delivery_format: "pdf",
    value_pages: ["cover","reader_outcome","contents","core_sections","key_takeaways","action_steps","closing"],
    customer_promise: ["Finished personalised guide / eBook shaped around the confirmed brief"]
  },
  unboxing_product_reveal: {
    canva_master_design_id: "DAHa1o9u2k8",
    canva_brand_template_id: null,
    canva_automation_ready: false,
    canva_source_type: "design_master",
    template_key: "unboxing_reveal_social_first_v1",
    display_name: "Unboxing / Product Reveal",
    hero_media: "product_reveal_visual_or_motion_preview",
    delivery_format: "pdf_or_video_companion",
    value_pages: ["your_brief","opening_reveal","product_entry","story_beats","shot_direction","payoff","platform_notes"],
    customer_promise: ["Product-reveal creative direction shaped around the confirmed brief"]
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
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
function safeId(v){return typeof v==="string"&&/^[A-Za-z0-9_-]+$/.test(v)}
function str(v,max=1000){return typeof v==="string"?v.trim().slice(0,max):""}
function arr(v){return Array.isArray(v)?v.filter(x=>x!=null):[]}
function normaliseHook(raw,index){
  return {
    rank:Number(raw?.rank||index+1),
    hook_text:str(raw?.hook_text,700),
    hook_type:str(raw?.hook_type,120),
    why_it_may_work:str(raw?.why_it_may_work,900),
    opening_visual_suggestion:str(raw?.opening_visual_suggestion,900),
    platform_note:str(raw?.platform_note,700)
  };
}
function visualBrief(productKey,niche,subject,platforms){
  const cfg=PRESENTATION_TEMPLATES[productKey];
  return {
    role:cfg.hero_media,
    purpose:"Support the purchased deliverable with a premium niche-relevant visual or media preview without implying an unpurchased deliverable.",
    query:`${niche||"creator"}; ${subject||"customer content"}; authentic social-first vertical aesthetic; platform-native; no unrelated logos; no unsupported claims`,
    format:"portrait_9_16",
    platform_context:platforms
  };
}
function genericValuePages(cfg,niche,platforms){
  return cfg.value_pages.map((key)=>({
    page_key:key,
    title:key.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase()),
    niche:niche||"",
    platforms
  }));
}
function hookValuePages(niche,platforms,hooks){
  const angles=[...new Set(hooks.map(h=>h.hook_type).filter(Boolean))].slice(0,6);
  return [
    {page_key:"why_hooks_work",eyebrow:"WHY THESE HOOKS ARE BUILT THIS WAY",title:"Emotion + curiosity + tension.",body:[
      "A strong opening gives the viewer something to feel or recognise.",
      "It leaves one useful question unresolved so the next beat feels necessary.",
      "It creates enough tension, contrast or consequence to make the answer worth discovering."
    ]},
    {page_key:"first_seconds",eyebrow:"THE FIRST FEW SECONDS",title:"Make the next beat feel necessary.",body:[
      "Lead with the human tension before the feature, product or explanation.",
      "Use the visual to support the hook rather than repeat the exact same words.",
      "Reveal the practical payoff quickly enough that curiosity feels rewarded."
    ]},
    {page_key:"creative_angles",eyebrow:"CREATIVE ANGLES IN THIS PACK",title:angles.length?angles.join(" • "):"Different ways into the same message.",body:[
      `These hooks are shaped for ${niche||"your niche"} content rather than generic viral wording.`,
      `Primary platforms: ${platforms.length?platforms.join(" + "):"short-form social"}.`,
      "Test different emotional entry points instead of changing everything at once."
    ]},
    {page_key:"quick_test_plan",eyebrow:"QUICK TEST PLAN",title:"Test. Compare. Learn.",body:[
      "Start with the Top 3 highlighted hooks.",
      "Keep the core message similar so you can compare the opening itself.",
      "Look for stronger watch-through, saves, comments, profile visits or other signals relevant to your goal.",
      "Use results as creative learning, not as a guarantee."
    ]}
  ];
}
function chooseTop3(hooks,ranks){
  const wanted=[...new Set(arr(ranks).map(Number).filter(n=>Number.isInteger(n)&&n>0))].slice(0,3);
  const selected=(wanted.length===3?wanted:hooks.slice(0,3).map(h=>h.rank));
  return selected.map(rank=>hooks.find(h=>h.rank===rank)).filter(Boolean);
}
function commonContext(body){
  const ctx=body.creator_context&&typeof body.creator_context==="object"?body.creator_context:{};
  return {
    niche:str(body.niche||ctx.niche,160),
    platforms:arr(body.platforms||ctx.platforms).map(v=>str(v,80)).filter(Boolean),
    promoted_subject:str(body.promoted_subject||ctx.promoted_subject,300),
    brand_summary:str(body.brand_summary||ctx.brand_summary,900),
    key_message:str(body.key_message||ctx.key_message,900),
    content_style:str(body.content_style||ctx.content_style,700),
    creative_direction:str(body.creative_direction||ctx.creative_direction,700)
  };
}
function buildHookPresentation(body,cfg,context){
  const hooks=arr(body.hooks).map(normaliseHook).filter(h=>h.hook_text);
  if(hooks.length!==10) return {error:"Hook Pack presentation requires exactly 10 approved hooks",received_hooks:hooks.length};
  const top3=chooseTop3(hooks,body.top_3_ranks);
  const ctas=arr(body.cta_starters).map(v=>str(v,350)).filter(Boolean).slice(0,6);
  const usage=arr(body.usage_notes).map(v=>str(v,500)).filter(Boolean).slice(0,8);
  const hero={...visualBrief("hooks",context.niche,context.promoted_subject,context.platforms),asset_id:str(body.hero_visual?.asset_id,100)||null,asset_url:str(body.hero_visual?.asset_url,1200)||null,alt_text:str(body.hero_visual?.alt_text,250)||`${context.niche||"Creator"} social content visual`};
  const pages=[
    {page_key:"cover",eyebrow:"PERSONALISED CREATIVE",title:"Your Hook Pack",subtitle:"10 personalised hooks built around your niche, message and goal.",...context,badges:["10 hooks","Top 3 highlighted","CTA starters","Usage direction"],hero_visual:hero,footer_line:"Built to make someone feel something, wonder what happens next, and stay for the payoff."},
    {page_key:"your_brief",eyebrow:"YOUR BRIEF",title:"Built for your content.",...context},
    ...hookValuePages(context.niche,context.platforms,hooks),
    {page_key:"top_3",eyebrow:"TOP 3 TO TEST FIRST",title:`Start with ${top3.map(h=>h.rank).join(", ").replace(/, ([^,]*)$/," and $1")}.`,hooks:top3},
    ...hooks.map(h=>({page_key:`hook_${String(h.rank).padStart(2,"0")}`,eyebrow:`HOOK ${String(h.rank).padStart(2,"0")}`,...h})),
    {page_key:"cta_starters",eyebrow:"CTA STARTERS",title:"Keep the ending natural.",items:ctas},
    {page_key:"usage_direction",eyebrow:"USAGE DIRECTION",title:"How to use this pack.",items:usage,closing:"The goal is not to sound viral. Give the viewer a reason to need the next beat."}
  ];
  return {pages,hero_visual:hero,canva_data:{...context,top_3_ranks:top3.map(h=>h.rank).join(", "),cta_1:ctas[0]||"",cta_2:ctas[1]||"",cta_3:ctas[2]||"",usage_notes:usage.join("\n"),...Object.fromEntries(hooks.flatMap(h=>{const n=String(h.rank).padStart(2,"0");return [[`hook_${n}_text`,h.hook_text],[`hook_${n}_type`,h.hook_type],[`hook_${n}_why`,h.why_it_may_work],[`hook_${n}_visual`,h.opening_visual_suggestion],[`hook_${n}_platform`,h.platform_note]]}))}};
}
function buildGenericPresentation(productKey,body,cfg,context){
  const hero={...visualBrief(productKey,context.niche,context.promoted_subject,context.platforms),asset_id:str(body.hero_media?.asset_id,100)||null,asset_url:str(body.hero_media?.asset_url,1200)||null,alt_text:str(body.hero_media?.alt_text,250)||`${cfg.display_name} preview`};
  const approvedOutput=body.approved_output??body.output??body.deliverable??null;
  return {
    pages:[
      {page_key:"cover",eyebrow:"PERSONALISED CREATIVE",title:`Your ${cfg.display_name}`,...context,hero_media:hero,customer_promise:cfg.customer_promise},
      {page_key:"your_brief",eyebrow:"YOUR BRIEF",title:"Built for your content.",...context},
      ...genericValuePages(cfg,context.niche,context.platforms).filter(p=>p.page_key!=="your_brief"),
      {page_key:"approved_output",eyebrow:"YOUR FINISHED CREATIVE",title:cfg.display_name,approved_output:approvedOutput,hero_media:hero}
    ],
    hero_media:hero,
    canva_data:{...context,hero_media_asset_id:hero.asset_id,hero_media_url:hero.asset_url,approved_output:approvedOutput}
  };
}
export async function buildPresentation(request, env, forcedProductKey=null) {
  const e=needAuth(request,env); if(e)return e;
  let body; try{body=await request.json()}catch{body=null}
  if(!body)return json({success:false,error:"Invalid JSON"},400);
  if(!safeId(body.order_id))return json({success:false,error:"Invalid order_id"},400);
  if(!safeId(body.job_id))return json({success:false,error:"Invalid job_id"},400);
  const productKey=forcedProductKey||str(body.product_key,100);
  const cfg=PRESENTATION_TEMPLATES[productKey];
  if(!cfg)return json({success:false,error:"Unsupported product_key",supported_product_keys:Object.keys(PRESENTATION_TEMPLATES)},422);
  const context=commonContext(body);
  const built=productKey==="hooks"?buildHookPresentation(body,cfg,context):buildGenericPresentation(productKey,body,cfg,context);
  if(built.error)return json({success:false,...built},422);
  return json({success:true,product_key:productKey,deliverable_type:productKey,presentation:{
    template_key:cfg.template_key,
    canva: {
      master_design_id: cfg.canva_master_design_id,
      brand_template_id: cfg.canva_brand_template_id,
      automation_ready: Boolean(cfg.canva_automation_ready && cfg.canva_brand_template_id),
      source_type: cfg.canva_source_type,
      handoff_mode: cfg.canva_automation_ready && cfg.canva_brand_template_id ? "autofill" : "blocked_pending_fillable_brand_template",
      rule: "Do not send a paid customer into Canva autofill until automation_ready is true."
    },
    template_version:"1.0.0",
    display_name:cfg.display_name,
    delivery_format:cfg.delivery_format,
    customer_promise:cfg.customer_promise,
    locked_brand_system:BRAND_SYSTEM,
    ...built
  }});
}
export async function buildHookPackPresentation(request, env){
  return buildPresentation(request,env,"hooks");
}
export async function presentationRegistry(request, env){
  const e=needAuth(request,env); if(e)return e;
  return json({success:true,brand_system:BRAND_SYSTEM,templates:PRESENTATION_TEMPLATES});
}
