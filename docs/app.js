/* Ice Lap Exchange — front end. All game rules run in the database (supabase/schema.sql). */
"use strict";

/* ---------- constants ---------- */
const TIERS=[
  {name:"Common",sell:15,price:150},{name:"Uncommon",sell:40,price:400},{name:"Rare",sell:100,price:900},
  {name:"Epic",sell:260,price:2400},{name:"Legendary",sell:800,price:7000},{name:"Mythic",sell:2500,price:22000}];
const TIER_SHORT=["C","U","R","E","L","M"];
const LEAGUE_W={A:1,B:.65,C:.4,R:.2};
const TIER_MULT={A:1.5,B:1.2,C:1,R:.8};
const POS_TOKENS=[400,300,240,200,180,160,150,140,130,120];
const posTokens=p=>p<=10?POS_TOKENS[p-1]:p<=15?90:p<=20?70:50;
const raceReward=(pos,tier="C")=>Math.round(posTokens(pos)*(TIER_MULT[tier]||1)/5)*5;
const racePack=pos=>pos===1?"gold":pos<=3?"silver":pos<=10?"bronze":"finisher";
const trackReward=p=>!p?0:p===1?300:p===2?250:p===3?210:p<=5?170:p<=10?130:p<=15?90:p<=20?60:0;
const AUCTION_FEE=.05;
const DISCORD_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.7 19.7 0 0 0 6 3l1.3-2.1a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.6 19.6 0 0 0 6-3c.5-5.1-.8-9.5-3.6-13.6ZM8.1 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7.8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>Number(n||0).toLocaleString("en-US");
const today=()=>new Date().toISOString().slice(0,10);
const yesterday=()=>new Date(Date.now()-864e5).toISOString().slice(0,10);
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function dur(ms){if(ms<=0)return"Ended";const s=Math.floor(ms/1e3),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60;
  return d?`${d}d ${h}h`:h?`${h}h ${m}m`:m?`${m}m ${String(x).padStart(2,"0")}s`:`${x}s`}
let toastT;function toast(msg){const h=$("#toastHost");h.innerHTML=`<div class="toast" role="status">${esc(msg)}</div>`;clearTimeout(toastT);toastT=setTimeout(()=>h.innerHTML="",4200)}
const errMsg=e=>(e&&(e.message||e.error_description||e.details))||"Something went wrong. Try again.";

/* Pixel head fallback (used when a Minecraft skin can't load) */
const headCache={};
function head(name){
  name=String(name||"?");if(headCache[name])return headCache[name];
  const r=rng(hash(name.toLowerCase()));const c=document.createElement("canvas");c.width=c.height=8;const x=c.getContext("2d");
  const pick=a=>a[Math.floor(r()*a.length)];
  const skin=pick(["#f3c9a1","#e8b58c","#d9a07a","#c68642","#8d5524","#ffdbac","#b97a56"]);
  const hair=pick(["#2b1d14","#4a2f1a","#7a4a22","#a0522d","#e6c35c","#111","#7a7a7a","#b8322a","#3a6ea5","#efefef","#4b7d3a"]);
  const px=(i,j,col)=>{x.fillStyle=col;x.fillRect(i,j,1,1)};
  x.fillStyle=skin;x.fillRect(0,0,8,8);
  for(let i=0;i<8;i++){px(i,0,hair);px(i,1,hair)}
  const fr=r();for(let i=0;i<8;i++)if(i===0||i===7||r()<fr*.7)px(i,2,hair);
  const eye=pick(["#2f4fd0","#2f9e44","#5a3a1e","#1c7ed6","#3d3d3d","#6741d9"]);
  px(1,4,"#fff");px(2,4,eye);px(5,4,eye);px(6,4,"#fff");
  x.fillStyle="rgba(70,25,20,.6)";x.fillRect(2,6,4,1);
  return headCache[name]=c.toDataURL();
}
/* Real Minecraft skin face, falling back to the pixel head */
const skinSrc=n=>`https://mc-heads.net/avatar/${encodeURIComponent(String(n||"MHF_Steve"))}/64`;
const face=(n,cls="mini-head")=>`<img class="${cls}" alt="" loading="lazy" src="${skinSrc(n)}" data-fb="${esc(n)}">`;
document.addEventListener("error",e=>{const t=e.target;if(t&&t.tagName==="IMG"&&t.dataset.fb!=null){const n=t.dataset.fb;delete t.dataset.fb;t.src=head(n)}},true);

/* ---------- Supabase ---------- */
const CFG=window.ICE_CONFIG||{};
const configured=CFG.SUPABASE_URL&&!/YOUR-PROJECT/.test(CFG.SUPABASE_URL)&&CFG.SUPABASE_ANON_KEY&&!/YOUR-ANON/.test(CFG.SUPABASE_ANON_KEY);
const sb=configured&&window.supabase?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY):null;
async function rpc(fn,args){const {data,error}=await sb.rpc(fn,args||{});if(error)throw error;return data}
async function all(table,q){let req=sb.from(table).select(q?.select||"*");if(q?.order)req=req.order(q.order,{ascending:q.asc!==false});if(q?.eq)req=req.eq(q.eq[0],q.eq[1]);
  const {data,error}=await req.limit(q?.limit||10000);if(error)throw error;return data||[]}

/* ---------- state ---------- */
let session=null,me=null,myPacks={},myCards={},myRaceClaims={},myTrackClaims={},myReq=null,boardBought=[];
let ALL=[],BY_ID={},PACKS={},LEAGUES=[],races=[],tracks=[],auctions=[],profiles=[],allCards=[],board=[],teamOfWeek="",siteCfg={},ignReqs=[];
let tab=(location.hash||"#packs").slice(1);
const view={colTier:-1,colSort:"tier",rankTier:-1,rankQ:"",rankLeague:"all",raceLeague:"all",trackQ:"",trackMine:false};
const signedIn=()=>!!(session&&me);
const isAdmin=()=>!!me?.is_admin;
const myIgn=()=>me?.ign||"";
const pname=id=>{const p=profiles.find(x=>x.id===id);return p?(p.ign||p.discord_name||"Collector"):"Collector"};
const card=id=>BY_ID[id]||{id,name:id,team:"Retired",teams:[],tier:0,ovr:45,wins:0,pods:0,leagues:[],rank:"—",score:0};
const owned=()=>Object.entries(myCards).filter(([,n])=>n>0);
const collectionValue=c=>Object.entries(c||{}).reduce((s,[id,n])=>s+TIERS[card(id).tier].sell*n,0);

/* ---------- loading ---------- */
async function loadPublic(){
  const [cards,packs,lg,rc,tr,cfg]=await Promise.all([all("cards",{order:"rank"}),all("pack_types",{order:"sort"}),all("leagues"),all("races"),all("tracks",{order:"name"}),sb.from("site_config").select("*").eq("id",1).maybeSingle()]);
  ALL=cards.filter(c=>c.active);BY_ID=Object.fromEntries(cards.map(c=>[c.id,c]));
  PACKS=Object.fromEntries(packs.map(p=>[p.id,{...p,w:(p.weights||[]).map(Number),c:[p.c1,p.c2],desc:p.description}]));
  LEAGUES=lg.sort((a,b)=>"ABCR".indexOf(a.tier)-"ABCR".indexOf(b.tier)||String(a.name).localeCompare(b.name));
  races=rc;tracks=tr;siteCfg=cfg.data||{};
  try{board=await rpc("get_board")}catch{board=[]}
  try{teamOfWeek=await rpc("team_of_week")||""}catch{teamOfWeek=""}
  await Promise.all([loadAuctions(),loadPeople()]);
}
async function loadAuctions(){
  try{await rpc("settle_due")}catch{}
  auctions=await all("auctions",{order:"ends_at"});
}
async function loadPeople(){
  [profiles,allCards]=await Promise.all([all("profiles",{select:"id,discord_name,discord_handle,avatar_url,ign,coins,is_admin"}),all("user_cards",{select:"user_id,card_id,qty"})]);
}
async function loadMe(){
  if(!session){me=null;return}
  const uid=session.user.id;
  const [p,pk,cd,rcl,tcl,req,bb]=await Promise.all([
    sb.from("profiles").select("*").eq("id",uid).maybeSingle(),
    all("user_packs",{eq:["user_id",uid]}),all("user_cards",{eq:["user_id",uid]}),
    all("race_claims",{eq:["user_id",uid]}),all("track_claims",{eq:["user_id",uid]}),
    sb.from("ign_requests").select("*").eq("user_id",uid).maybeSingle(),
    all("board_buys",{eq:["user_id",uid]})]);
  me=p.data;
  myPacks=Object.fromEntries(pk.filter(x=>x.qty>0).map(x=>[x.pack,x.qty]));
  myCards=Object.fromEntries(cd.filter(x=>x.qty>0).map(x=>[x.card_id,x.qty]));
  myRaceClaims=Object.fromEntries(rcl.map(x=>[x.race_id,x.pos]));
  myTrackClaims=Object.fromEntries(tcl.map(x=>[x.track_id,x.pos]));
  myReq=req.data||null;boardBought=bb.filter(x=>x.day===today()).map(x=>x.card_id);
  if(me?.is_admin)ignReqs=await all("ign_requests",{order:"created_at"});
}

/* ---------- auth ---------- */
async function signIn(){
  const {error}=await sb.auth.signInWithOAuth({provider:"discord",options:{redirectTo:location.origin+location.pathname}});
  if(error)toast(errMsg(error));
}
async function signOut(){await sb.auth.signOut();session=null;me=null;myPacks={};myCards={};lastHTML="";render()}
function guard(){if(!signedIn()){showSignIn();return false}return true}
function showSignIn(){
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Sign in"><div class="sheet" style="width:min(520px,100%)">
    <div class="sheet-head"><span class="eyebrow">Sign in</span><button class="btn ghost sm" data-act="close">Close</button></div>
    <h3 style="font-size:22px">Sign in with Discord to start collecting</h3>
    <p class="muted" style="font-size:15px">New collectors get a Starter Kit and 1,000 tokens. Add your Minecraft IGN later to earn rewards from your race results.</p>
    <button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button></div></div>`;
}

/* ---------- actions ---------- */
async function act(fn,args,after){
  try{const r=await rpc(fn,args);await loadMe();if(after)await after(r);render();return r}
  catch(e){toast(errMsg(e));return null}
}
async function claimDaily(){if(!guard())return;await act("claim_daily",{},r=>toast(`Daily Pack added · +${fmt(r.bonus)} tokens (day ${r.streak} streak)`))}
async function openPack(t){if(!guard())return;const r=await act("open_pack",{p_type:t});if(r)showReveal(PACKS[t]?.name||"Pack",r)}
async function buyPack(t){if(!guard())return;const r=await act("buy_pack",{p_type:t});if(r)showReveal(PACKS[t]?.name||"Pack",r)}
async function buyTier(t){if(!guard())return;const r=await act("buy_tier",{p_tier:t});if(r)showReveal(`${TIERS[t].name} pull`,r)}
async function buyBoard(id){if(!guard())return;const r=await act("buy_board",{p_card:id});if(r)showReveal("Featured card",r)}
async function quickSell(id,n){if(!guard())return;const v=await act("quick_sell",{p_card:id,p_n:n});if(v!=null){toast(`Sold for ${fmt(v)} tokens`);closeOverlay();await loadPeople();render()}}
async function listAuction(id,start,buyNow,hours){
  if(!guard())return;const r=await act("list_auction",{p_card:id,p_start:Math.floor(start),p_buy_now:Math.floor(buyNow)||0,p_hours:hours},loadAuctions);
  if(r){toast("Listed on the auction house");closeOverlay();location.hash="#auctions"}
}
async function placeBid(aid,amount,buyNow){
  if(!guard())return;const r=await act("place_bid",{p_id:aid,p_amount:Math.floor(amount)||0,p_buy_now:!!buyNow},loadAuctions);
  if(r)toast(r==="bought"?"Bought! The card is in your collection.":`You're leading at ${fmt(amount)}`);
}
async function cancelAuction(aid){if(!guard())return;const r=await act("cancel_auction",{p_id:aid},loadAuctions);if(r!==null)toast("Listing cancelled. The card is back in your collection.")}
async function requestIgn(ign){if(!guard())return;const r=await act("request_ign",{p_ign:String(ign||"").trim()});if(r!==null)toast("Sent! The league admin will review your IGN.")}
async function claimRace(id){if(!guard())return;const r=await act("claim_race",{p_race:id});if(r)toast(`P${r.pos}: ${PACKS[r.pack]?.name||"Pack"} + ${fmt(r.coins)} tokens added`)}
async function claimTrack(id){if(!guard())return;const r=await act("claim_track",{p_track:id});if(r)toast(`P${r.pos}: +${fmt(r.coins)} tokens${r.pack?" and a Track Pack":""}`)}
async function claimAll(){if(!guard())return;const r=await act("claim_all");if(r)toast(`Claimed ${r.races} races and ${r.tracks} tracks · +${fmt(r.coins)} tokens`)}

/* ---------- admin ---------- */
function buildCatalog(){
  const D={};
  LEAGUES.forEach(L=>{
    const rows=Array.isArray(L.rows)?L.rows:[];if(!rows.length)return;
    const lead=Math.max(1,...rows.map(r=>+r[2]||0));const tw=LEAGUE_W[L.tier]??.4;
    rows.forEach((r,i)=>{const [name,team,pts,w,p]=r;if(!name)return;const k=String(name).toLowerCase();
      const d=D[k]||(D[k]={id:String(name),name:String(name),teams:[],wins:0,pods:0,score:0,leagues:[]});
      d.score+=((+pts||0)/lead*100+(+w||0)*8+(+p||0)*3)*tw;d.wins+=+w||0;d.pods+=+p||0;
      if(team&&!d.teams.includes(team))d.teams.push(team);
      d.leagues.push({id:L.id,short:L.short,name:L.name,tier:L.tier,pos:i+1,pts:+pts||0,team:team||""});});
  });
  const out=Object.values(D);const tws=l=>LEAGUE_W[l.tier]??.4;
  out.forEach(d=>{d.leagues.sort((a,b)=>tws(b)-tws(a)||a.pos-b.pos);d.best_tier=d.leagues[0]?.tier||"R";d.team=d.leagues.find(l=>l.team)?.team||"Independent"});
  out.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const n=out.length,top=out[0]?.score||1,cut=[.015,.06,.16,.35,.6].map(f=>Math.max(1,Math.round(n*f)));
  out.forEach((d,i)=>{d.rank=i+1;d.tier=i<cut[0]?5:i<cut[1]?4:i<cut[2]?3:i<cut[3]?2:i<cut[4]?1:0;d.ovr=Math.max(48,Math.round(50+49*Math.sqrt(d.score/top)))});
  return out;
}
async function rebuildCatalog(quiet){
  try{const n=await rpc("admin_set_catalog",{p_cards:buildCatalog()});await loadPublic();render();if(!quiet)toast(`Card pool rebuilt: ${n} drivers`)}catch(e){toast(errMsg(e))}
}
function parseStandings(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);const rows=[];
  if(lines.some(l=>l.includes("|")||l.includes("\t"))){
    lines.forEach(l=>{const p=l.split(/\s*[|\t]\s*/).filter((x,i,a)=>!(x===""&&(i===0||i===a.length-1)));
      if(p.length<2||/^-+$/.test(p[0])||/^pos/i.test(p[0]))return;
      if(/^\d+$/.test(p[0])&&p.length>2)p.shift();
      const isNum=x=>/^-?\d+(\.\d+)?$/.test(x)||x==="-";
      const nums=p.filter(isNum).map(x=>x==="-"?0:+x);const words=p.filter(x=>!isNum(x));
      const first=(words[0]||"").split(/\s+/)[0];const name=first.split("/").pop();if(!name)return;
      let team=words[1]!=null?words[1]:(words[0]||"").slice(first.length);
      team=team.replace(/Season details/i,"").replace(/-\d+ pts/,"").trim();
      let pts=0,w=0,pod=0;if(nums.length>=3){[w,pod,pts]=nums.slice(-3)}else if(nums.length)pts=nums[nums.length-1];
      rows.push([name,team,pts,w,pod])});
    return rows;
  }
  for(let i=0;i<lines.length;i++){
    if(!/^\d+$/.test(lines[i])||!lines[i+1]||/^\d+$/.test(lines[i+1]))continue;
    const name=lines[i+1].split("/").pop().trim();let j=i+2,team="",pts=0,w=0,pod=0;
    while(lines[j]&&(lines[j].split("/").pop().trim()===name||/^-?\d+ pts$/i.test(lines[j])))j++;
    if(lines[j]&&!/^\d+$/.test(lines[j])&&!/^Wins/i.test(lines[j])){team=lines[j];j++}
    if(lines[j]&&/^\d+(\.\d+)?$/.test(lines[j])){pts=+lines[j];j++}
    const m=(lines[j]||"").match(/Wins:\s*(\d+).*Podiums:\s*(\d+)/i);if(m){w=+m[1];pod=+m[2];j++}
    rows.push([name,team,pts,w,pod]);i=j-1;
  }
  return rows;
}
function parseTop(text){
  return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>l.split(/\s*[|\t,]\s*|\s{2,}/).filter(Boolean)).filter(p=>p.length>=2).map((p,i)=>
    /^\d+$/.test(p[0])&&p.length>=3?{pos:+p[0],mc:p[1],time:p[2]}:{pos:i+1,mc:p[0],time:p[1]||""}).slice(0,20);
}
async function adminDo(promise,msg,reload=true){
  const {error}=await promise;if(error)return toast(errMsg(error));
  if(reload){await loadPublic();await loadMe()}toast(msg);render();
}
async function saveLeague(form){
  const f=new FormData(form);const name=String(f.get("lname")).trim(),short=String(f.get("lshort")).trim().toUpperCase().slice(0,5);
  const rows=parseStandings(String(f.get("lrows")||""));
  if(!name||!short)return toast("Give the league a name and a short code.");
  if(!rows.length)return toast("Couldn't find any drivers in that paste.");
  const id=short.toLowerCase().replace(/[^a-z0-9]+/g,"-")+"-"+String(f.get("lseason")||"s").replace(/[^A-Za-z0-9]/g,"").toLowerCase();
  const {error}=await sb.from("leagues").upsert({id,name,short,server:String(f.get("lserver")||""),tier:String(f.get("ltier")),season:String(f.get("lseason")||""),url:String(f.get("lurl")||""),rows,updated_at:new Date().toISOString()});
  if(error)return toast(errMsg(error));
  form.reset();await loadPublic();await rebuildCatalog(true);toast(`Saved ${name}: ${rows.length} drivers. Card pool updated.`);
}
async function postRace(form){
  const f=new FormData(form);const name=String(f.get("rname")).trim();const lshort=String(f.get("rleague")||"");
  const results=String(f.get("rresults")||"").split(/\r?\n/).map(l=>l.trim().replace(/^(P?\d+[\.\):]?\s+)/i,"")).filter(Boolean).map((l,i)=>({pos:i+1,mc:l.split(/\s+/)[0]}));
  if(!name||!results.length)return toast("Add a race name and at least one finisher.");
  const tier=(LEAGUES.find(L=>L.short===lshort)||{}).tier||String(f.get("rtier")||"C");
  await adminDo(sb.from("races").insert({name,league:lshort,tier,date:String(f.get("rdate")||today()),results,source:"Posted by admin"}),`Posted ${name} with ${results.length} finishers`);
  form.reset();
}
async function saveTrack(form){
  const f=new FormData(form);const name=String(f.get("tname")||"").trim();const top=parseTop(String(f.get("ttop")||""));
  if(!name||!top.length)return toast("Add a track name and its leaderboard.");
  const id=name.replace(/[^A-Za-z0-9]+/g,"");
  await adminDo(sb.from("tracks").upsert({id,name,server:"BoatLabs",url:"https://boatlabs.net/tracks/"+id,top,updated_at:new Date().toISOString()}),`Saved ${name}: ${top.length} times`);
  form.reset();
}
async function decideIgn(uid,ok){
  const reason=document.getElementById("deny-"+uid)?.value||"";
  try{await rpc("decide_ign",{p_user:uid,p_ok:ok,p_reason:reason});await loadMe();await loadPeople();toast(ok?"IGN approved":"IGN denied");render()}catch(e){toast(errMsg(e))}
}

/* ---------- rendering ---------- */
function cardHTML(d,o={}){
  const L=(d.leagues||[]).slice(0,2);while(L.length<2)L.push(null);
  const tag=o.tag||"button";
  return `<${tag} ${tag==="button"?'type="button"':""} class="card t${d.tier}" data-card="${esc(d.id)}" aria-label="${esc(d.name)}, ${TIERS[d.tier].name}">
    <span class="c-top"><span class="ovr">${d.ovr}</span><span class="c-rar">${TIERS[d.tier].name}</span></span>
    ${face(d.name,"head")}
    <span class="c-name">${esc(d.name)}</span><span class="c-team">${esc(d.team)}</span>
    <span class="c-stats">
      ${L.map(l=>`<span><i>${l?esc(l.short):"—"}</i><b>${l?"P"+l.pos:"—"}</b></span>`).join("")}
      <span><i>WIN</i><b>${d.wins}</b></span><span><i>POD</i><b>${d.pods}</b></span>
    </span>
    ${o.count>1?`<span class="cnt">×${o.count}</span>`:""}${o.isNew?`<span class="new">NEW</span>`:""}
  </${tag}>`;
}
function oddsHTML(P){const tot=P.w.reduce((a,b)=>a+b,0)||1;
  return `<div class="odds">${P.w.map((x,t)=>x?`<span style="--tc:var(--t${t})">${TIER_SHORT[t]} ${(x/tot*100).toFixed(x/tot<.01?1:0)}%</span>`:"").join("")}</div>`}
function packTile(id,{count=0,action}={}){
  const P=PACKS[id];if(!P)return"";
  return`<article class="pack" style="--pc1:${esc(P.c[0])};--pc2:${esc(P.c[1])}">
    <div class="pack-art">${count?`<span class="cnt-badge">×${count}</span>`:""}<h3>${esc(P.name)}</h3></div>
    <div class="pack-body"><p>${esc(id==="team"?`${teamOfWeek||"No team"} only. Rotates every Monday (UTC).`:P.desc)}</p>
      <p class="num" style="font-size:13px">${P.cards} cards${P.guar!=null?` · ${TIERS[P.guar].name}+ guaranteed`:""}</p>${oddsHTML(P)}
      <div class="pack-foot">${action}</div></div></article>`;
}
function renderWallet(){
  const packs=Object.values(myPacks).reduce((a,b)=>a+b,0);
  $("#wallet").innerHTML=!sb?"":!signedIn()?`<button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button>`:
    `<span class="chip"><span class="coin"></span><b>${fmt(me.coins)}</b></span><span class="chip">Packs <b>${packs}</b></span>
     <span class="chip">Cards <b>${owned().length}/${ALL.length}</b></span>
     <span class="chip me-chip">${me.avatar_url?`<img src="${esc(me.avatar_url)}" alt="">`:""}<b>${esc(me.ign||me.discord_name)}</b></span>
     <button class="btn ghost sm" data-act="signout">Sign out</button>`;
  const pendingRewards=signedIn()&&myIgn()&&(races.some(r=>myResult(r)&&!myRaceClaims[r.id])||tracks.some(t=>trackDue(t)>0));
  document.querySelectorAll("#tabs a").forEach(a=>{a.setAttribute("aria-current",a.dataset.tab===tab?"page":"false");
    a.querySelector(".dot")?.remove();
    if((a.dataset.tab==="races"&&pendingRewards)||(a.dataset.tab==="packs"&&signedIn()&&me.last_daily!==today())||(a.dataset.tab==="admin"&&ignReqs.some(r=>r.status==="pending")))
      a.insertAdjacentHTML("beforeend",'<span class="dot" aria-label="needs attention"></span>')});
  $("#adminTab").hidden=!isAdmin();
}
function banner(){
  if(!ALL.length)return`<div class="banner"><strong>No standings loaded yet.</strong> ${isAdmin()?"Import a league in League admin to fill the card pool.":"The league admin hasn't imported any standings yet."}</div>`;
  if(!signedIn())return`<section class="hero"><div><span class="eyebrow">Minecraft iceboat racing</span><h2>Collect the drivers. Earn packs on the ice.</h2>
    <p>Every card is a real racer, ranked from FrostHex, IceDrifters, BoatLabs and IBR results. Open packs, trade on the auction house, and claim rewards for your own race finishes and track times.</p>
    <button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button></div>
    <div class="hero-cards">${ALL.slice(0,3).map(d=>cardHTML(d)).join("")}</div></section>`;
  return"";
}
function vPacks(){
  const done=signedIn()&&me.last_daily===today();const st=signedIn()&&(me.last_daily===today()||me.last_daily===yesterday())?me.streak:0;
  const midnight=new Date();midnight.setUTCHours(24,0,0,0);
  const inv=Object.entries(myPacks).filter(([t,n])=>n>0&&PACKS[t]);
  const store=Object.values(PACKS).filter(p=>p.price!=null&&!p.special),special=Object.values(PACKS).filter(p=>p.price!=null&&p.special);
  const cant=p=>!signedIn()?"":me.coins<p.price?"disabled":"";
  return`${banner()}
  <section class="block"><div class="daily">
    <div><span class="eyebrow">Daily drop</span><h3>${done?"Today's pack is claimed":"Your Daily Pack is ready"}</h3>
      <p>${done?`Next drop in <span class="num" data-until="${midnight.getTime()}">${dur(midnight-Date.now())}</span>.`:"Claim a free pack plus tokens. Come back on consecutive days to raise the bonus."}</p>
      <div class="streak" aria-label="Streak ${st} of 7">${Array.from({length:7},(_,i)=>`<i class="${i<st?"on":""}"></i>`).join("")}</div></div>
    <button class="btn" data-act="daily" ${done?"disabled":""}>${done?"Claimed":"Claim daily"}</button></div></section>
  ${signedIn()?`<section class="block"><div class="sec-head"><h2>Your packs</h2><p>Packs from daily drops, race rewards and your welcome kit wait here until you open them.</p></div>
    ${inv.length?`<div class="packs">${inv.map(([t,n])=>packTile(t,{count:n,action:`<span class="muted" style="font-size:13px">Ready</span><button class="btn" data-act="open" data-type="${esc(t)}">Open</button>`})).join("")}</div>`
      :`<div class="empty"><b>No unopened packs</b>Claim your daily pack, buy one below, or earn one from a race result.</div>`}</section>`:""}
  <section class="block"><div class="sec-head"><h2>Pack store</h2><p>Buy and open on the spot.</p></div>
    <div class="packs">${store.map(p=>packTile(p.id,{action:`<span class="price"><span class="coin"></span>${fmt(p.price)}</span><button class="btn" data-act="buy" data-type="${esc(p.id)}" ${cant(p)}>Buy & open</button>`})).join("")}</div></section>
  <section class="block"><div class="sec-head"><h2>Special packs</h2><p>Narrow pools with better floors. The Team Pack changes every week.</p></div>
    <div class="packs">${special.map(p=>packTile(p.id,{action:`<span class="price"><span class="coin"></span>${fmt(p.price)}</span><button class="btn" data-act="buy" data-type="${esc(p.id)}" ${cant(p)}>Buy & open</button>`})).join("")}</div></section>`;
}
function vShop(){
  return`${banner()}<section class="block"><div class="sec-head"><h2>Rarity shop</h2><p>Pick the rarity, get a random driver from that tier. Prices are fixed.</p></div>
    <div class="packs">${TIERS.map((T,t)=>{const n=ALL.filter(d=>d.tier===t).length;return`<article class="pack" style="--pc1:var(--t${t});--pc2:color-mix(in srgb,var(--t${t}) 50%,#000)">
      <div class="pack-art"><h3>${T.name}</h3></div><div class="pack-body"><p>${n} drivers in this tier · quick-sells for ${fmt(T.sell)}</p>
      <div class="pack-foot"><span class="price"><span class="coin"></span>${fmt(T.price)}</span><button class="btn" data-act="tier" data-tier="${t}" ${!n||(signedIn()&&me.coins<T.price)?"disabled":""}>Buy</button></div></div></article>`}).join("")}</div></section>
  <section class="block"><div class="sec-head"><h2>Today's board</h2><p>Six named drivers, one per rarity, reshuffled at 00:00 UTC. One of each per collector per day.</p></div>
    ${board.length?`<div class="grid">${board.map(b=>{const d=card(b.card_id);const got=boardBought.includes(b.card_id);return`<div style="display:flex;flex-direction:column;gap:8px">${cardHTML(d)}
      <button class="btn sm ${got?"ghost":""}" data-act="board" data-id="${esc(b.card_id)}" ${got||(signedIn()&&me.coins<b.price)?"disabled":""}>${got?"Bought today":`<span class="coin"></span> ${fmt(b.price)}`}</button></div>`}).join("")}</div>`
      :`<div class="empty"><b>The board is empty</b>It fills once league standings are imported.</div>`}</section>`;
}
function vCollection(){
  if(!signedIn())return`${banner()}`;
  let list=owned().map(([id,n])=>({d:card(id),n}));
  if(view.colTier>=0)list=list.filter(x=>x.d.tier===view.colTier);
  list.sort(view.colSort==="name"?(a,b)=>a.d.name.localeCompare(b.d.name):view.colSort==="count"?(a,b)=>b.n-a.n:(a,b)=>b.d.tier-a.d.tier||b.d.ovr-a.d.ovr);
  const uniq=owned().length,pct=ALL.length?uniq/ALL.length*100:0,val=collectionValue(myCards);
  const perTier=TIERS.map((_,t)=>[owned().filter(([id])=>card(id).tier===t).length,ALL.filter(d=>d.tier===t).length]);
  return`<section class="block"><div class="sec-head"><h2>Collection</h2><p>${fmt(uniq)} of ${fmt(ALL.length)} drivers · quick-sell value <span class="num">${fmt(val)}</span> tokens. Tap a card to sell it or list it.</p></div>
    <div class="meter" style="margin-bottom:14px"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="filters"><button class="fchip" data-act="coltier" data-tier="-1" aria-pressed="${view.colTier<0}">All</button>
      ${TIERS.map((T,t)=>`<button class="fchip" style="--tc:var(--t${t})" data-act="coltier" data-tier="${t}" aria-pressed="${view.colTier===t}"><span class="sw"></span>${T.name} <span class="num">${perTier[t][0]}/${perTier[t][1]}</span></button>`).join("")}
      <span style="margin-left:auto"></span><label class="muted" style="font-size:13px" for="colSort">Sort</label>
      <select id="colSort" data-act="colsort"><option value="tier" ${view.colSort==="tier"?"selected":""}>Rarity</option><option value="name" ${view.colSort==="name"?"selected":""}>Name</option><option value="count" ${view.colSort==="count"?"selected":""}>Duplicates</option></select></div>
    ${list.length?`<div class="grid">${list.map(x=>cardHTML(x.d,{count:x.n})).join("")}</div>`:`<div class="empty"><b>Nothing here yet</b>Open a pack to add drivers.</div>`}</section>`;
}
const isEnded=a=>a.status!=="open"||Date.now()>=new Date(a.ends_at).getTime();
const minBid=a=>a.high_bid?Math.max(a.high_bid+1,Math.ceil(a.high_bid*1.05)):a.start_bid;
function vAuctions(){
  const uid=session?.user.id;
  const live=auctions.filter(a=>!isEnded(a)).sort((a,b)=>new Date(a.ends_at)-new Date(b.ends_at));
  const recent=auctions.filter(a=>a.status==="sold").sort((a,b)=>new Date(b.settled_at)-new Date(a.settled_at)).slice(0,8);
  const lot=a=>{const d=card(a.card_id);const ends=new Date(a.ends_at).getTime();const lead=a.high_bidder===uid,own=a.seller===uid;
    return`<article class="lot">${cardHTML(d)}<div class="lot-info">
      <div style="display:flex;gap:6px;flex-wrap:wrap">${own?'<span class="tag">Your listing</span>':""}${lead?'<span class="tag lead">You lead</span>':""}</div>
      <div class="kv"><span>${a.high_bid?"Top bid":"Starts at"}</span><b>${fmt(a.high_bid||a.start_bid)}</b></div>
      ${a.buy_now?`<div class="kv"><span>Buy now</span><b>${fmt(a.buy_now)}</b></div>`:""}
      <div class="kv"><span>Bids</span><b>${a.bid_count||0}</b></div>
      <div class="kv"><span>Seller</span><b>${esc(pname(a.seller))}</b></div>
      ${a.high_bidder?`<div class="kv"><span>Leader</span><b>${esc(pname(a.high_bidder))}</b></div>`:""}
      <div class="kv"><span>Ends in</span><span class="timer${ends-Date.now()<3e5?" late":""}" data-ends="${ends}">${dur(ends-Date.now())}</span></div>
      ${own?(a.high_bidder?`<p class="muted" style="font-size:13px;margin:0">Sells when the timer runs out.</p>`:`<button class="btn ghost sm" data-act="cancel" data-id="${a.id}">Cancel listing</button>`)
        :`<form data-form="bid" data-id="${a.id}"><input type="number" id="bid-${a.id}" name="amt" min="${minBid(a)}" value="${minBid(a)}" aria-label="Bid amount"><button class="btn sm">Bid</button></form>
          ${a.buy_now?`<button class="btn ghost sm" data-act="buynow" data-id="${a.id}">Buy now · ${fmt(a.buy_now)}</button>`:""}`}
    </div></article>`};
  return`${banner()}<section class="block"><div class="sec-head"><h2>Auction house</h2><p>Your bid is held until someone outbids you, then it comes straight back. Sellers pay a ${AUCTION_FEE*100}% fee. Bids in the last 30 seconds extend the timer. List a card from your Collection.</p></div>
    ${live.length?`<div class="auctions">${live.map(lot).join("")}</div>`:`<div class="empty"><b>No live auctions</b>Open your Collection, pick a card and choose “List on auction”.</div>`}</section>
    ${recent.length?`<section class="block"><div class="sec-head"><h2>Recent sales</h2></div><div class="tablewrap"><table><thead><tr><th>Card</th><th>Rarity</th><th class="r">Price</th><th>Buyer</th></tr></thead><tbody>
      ${recent.map(a=>{const d=card(a.card_id);return`<tr data-card="${esc(d.id)}" style="cursor:pointer"><td>${face(d.name)}${esc(d.name)}</td><td><span class="tpill" style="--tc:var(--t${d.tier})">${TIERS[d.tier].name}</span></td><td class="r num">${fmt(a.high_bid)}</td><td>${esc(pname(a.high_bidder))}</td></tr>`}).join("")}</tbody></table></div></section>`:""}`;
}
function myResult(r){const g=myIgn().toLowerCase();if(!g)return null;return(r.results||[]).find(x=>String(x.mc).toLowerCase()===g)||null}
function myTrackPos(t){const g=myIgn().toLowerCase();if(!g)return 0;const x=(t.top||[]).find(y=>String(y.mc).toLowerCase()===g);return x?x.pos:0}
function trackDue(t){const pos=myTrackPos(t);if(!pos)return 0;const prev=myTrackClaims[t.id]||0;return(!prev||pos<prev)?Math.max(0,trackReward(pos)-trackReward(prev)):0}
function ignPanel(){
  if(!signedIn())return`<p class="muted" style="margin:0;font-size:15px">Sign in with Discord, then add your Minecraft IGN here to claim race and track rewards.</p>`;
  const g=myIgn();const note=siteCfg.ign_note?`<p style="margin:8px 0 0;font-size:14px">${esc(siteCfg.ign_note)}</p>`:"";
  const inv=siteCfg.discord_invite?`<a href="${esc(siteCfg.discord_invite)}" target="_blank" rel="noopener">Join the league Discord</a>`:"";
  const form=(label,val,ghost)=>`<form data-form="ign" class="row" style="margin-top:10px"><label class="f" for="ignInput" style="flex:1">${label}<input type="text" id="ignInput" name="ign" value="${esc(val||"")}" maxlength="16" autocomplete="off" placeholder="Your Minecraft IGN"></label><button class="btn ${ghost?"ghost":""}">${ghost?"Request change":"Submit IGN"}</button></form>`;
  let h=`<p class="muted" style="margin:0 0 8px;font-size:14px">Signed in as <b style="color:var(--ink)">${esc(me.discord_name)}</b>${me.discord_handle?` <span class="muted">(${esc(me.discord_handle)})</span>`:""}</p>`;
  if(g)h+=`<p style="margin:0 0 8px"><span class="tag lead">IGN approved</span> <b class="num">${esc(g)}</b></p><p class="muted" style="margin:0;font-size:15px">Race results and track times under ${esc(g)} pay out to you.${ALL.some(d=>d.name.toLowerCase()===g.toLowerCase())?" You're in the standings, so you're in the card pool too.":""}</p>`;
  if(myReq&&myReq.status==="pending")h+=`<div class="panel" style="background:var(--sunk);margin-top:10px"><span class="eyebrow">Waiting for approval</span><p style="margin:6px 0 0">You asked for <b class="num">${esc(myReq.ign)}</b>. The league admin sees your Discord account next to the request.</p>${note}${inv}</div>`;
  else if(myReq&&myReq.status==="denied")h+=`<div class="panel" style="margin-top:10px;border-color:var(--signal)"><span class="tag out">IGN ${esc(myReq.ign)} denied</span>${myReq.reason?`<p style="margin:6px 0 0;font-size:14px">${esc(myReq.reason)}</p>`:""}</div>${form("Try again",myReq.ign)}`;
  else h+=g?form("Changed your IGN?","",true):form("Your Minecraft IGN","")+note;
  return h;
}
function vRaces(){
  const pending=races.filter(r=>myResult(r)&&!myRaceClaims[r.id]);const pendT=tracks.filter(t=>trackDue(t)>0);
  const shorts=[...new Set(races.map(r=>r.league).filter(Boolean))].sort((a,b)=>{const ta=(races.find(r=>r.league===a)||{}).tier,tb=(races.find(r=>r.league===b)||{}).tier;return"ABCR".indexOf(ta)-"ABCR".indexOf(tb)||a.localeCompare(b)});
  let list=[...races].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.league).localeCompare(String(b.league)));
  if(view.raceLeague==="mine")list=list.filter(r=>myResult(r));else if(view.raceLeague!=="all")list=list.filter(r=>r.league===view.raceLeague);
  const total=pending.reduce((s,r)=>s+raceReward(myResult(r).pos,r.tier),0)+pendT.reduce((s,t)=>s+trackDue(t),0);
  const g=myIgn();
  let tl=[...tracks];if(view.trackMine)tl=tl.filter(t=>myTrackPos(t));if(view.trackQ)tl=tl.filter(t=>t.name.toLowerCase().includes(view.trackQ.toLowerCase()));
  tl.sort((a,b)=>(myTrackPos(a)||99)-(myTrackPos(b)||99)||a.name.localeCompare(b.name));
  const shownT=tl.slice(0,60);
  return`${banner()}<section class="block two">
    <div class="panel"><span class="eyebrow">Your racer</span><h3 style="font-size:20px;margin:4px 0 8px">${signedIn()?esc(g||me.discord_name):"Not signed in"}</h3>
      ${ignPanel()}
      ${g&&(pending.length||pendT.length)?`<button class="btn" data-act="claimall" style="margin-top:12px">Claim everything · +${fmt(total)} tokens</button>`:""}
    </div>
    <div class="panel"><span class="eyebrow">Tokens per race</span>
      <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Finish</th><th>Pack</th>${["A","B","C","R"].map(t=>`<th class="r">Tier ${t}</th>`).join("")}</tr></thead><tbody>
      ${[[1,"P1"],[2,"P2"],[3,"P3"],[4,"P4"],[10,"P10"],[15,"P11–15"],[20,"P16–20"],[21,"P21+"]].map(([p,l])=>`<tr><td>${l}</td><td>${esc((PACKS[racePack(p)]?.name||"").replace(" Pack","").replace(" Race",""))}</td>${["A","B","C","R"].map(t=>`<td class="r num">${fmt(raceReward(p,t))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></div></section>
  <section class="block"><div class="sec-head"><h2>BoatLabs track times</h2><p>A top-20 time on a listed track pays ${fmt(trackReward(1))} tokens for P1 down to ${fmt(trackReward(20))} for P16–20, plus a Track Pack the first time you reach the top 3. Move up later and you collect the difference. ${tracks.length} tracks listed.</p></div>
    <div class="filters"><input type="text" id="trackQ" data-act="trackq" placeholder="Search tracks" value="${esc(view.trackQ)}" aria-label="Search tracks">
      ${g?`<button class="fchip" data-act="trackmine" aria-pressed="${view.trackMine}">Only tracks I'm on</button>`:""}</div>
    ${shownT.length?`<div class="races">${shownT.map(t=>{const pos=myTrackPos(t),due=g?trackDue(t):0,prev=myTrackClaims[t.id];
      return`<article class="race"><div><span class="eyebrow">${esc(t.server||"BoatLabs")}</span><h3>${t.url?`<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(t.name)}</a>`:esc(t.name)}</h3></div>
        <ol>${(t.top||[]).slice(0,5).map(x=>`<li class="${pos&&x.pos===pos?"me":""}"><span class="p">P${x.pos}</span>${face(x.mc)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.mc)}</span><span class="num muted" style="font-size:12px">${esc(x.time)}</span></li>`).join("")}
        ${pos>5?`<li class="me"><span class="p">P${pos}</span>${face(g)}<span style="flex:1">${esc(g)}</span><span class="num muted" style="font-size:12px">${esc((t.top||[]).find(x=>x.pos===pos)?.time||"")}</span></li>`:""}</ol>
        ${pos?(due?`<button class="btn" data-act="claimtrack" data-id="${esc(t.id)}">Claim P${pos} · +${fmt(due)} tokens</button>`:prev?`<span class="tag lead" style="align-self:flex-start">Claimed P${prev}</span>`:""):""}
      </article>`}).join("")}</div>${tl.length>shownT.length?`<p class="muted" style="font-size:14px">Showing 60 of ${tl.length}. Search to find a track.</p>`:""}`
      :`<div class="empty"><b>No tracks match</b>Try another search.</div>`}</section>
  <section class="block"><div class="sec-head"><h2>Race results</h2><p>Tokens scale with the league tier. Claim once per race.</p></div>
    <div class="filters"><button class="fchip" data-act="raceleague" data-l="all" aria-pressed="${view.raceLeague==="all"}">All</button>
      ${g?`<button class="fchip" data-act="raceleague" data-l="mine" aria-pressed="${view.raceLeague==="mine"}">My races</button>`:""}
      ${shorts.map(l=>`<button class="fchip" data-act="raceleague" data-l="${esc(l)}" aria-pressed="${view.raceLeague===l}">${esc(l)}</button>`).join("")}</div>
    ${list.length?`<div class="races">${list.map(r=>{const res=myResult(r),claimed=myRaceClaims[r.id];const shown=(r.results||[]).slice(0,10);
      return`<article class="race"><div><span class="eyebrow">${esc(r.league||"Race")} · Tier ${esc(r.tier)} · ${esc(r.date||"")}</span><h3>${esc(r.name)}</h3></div>
        <ol>${shown.map(x=>`<li class="${res&&x.pos===res.pos?"me":""}"><span class="p">P${x.pos}</span>${face(x.mc)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.mc)}</span>${x.pts!=null?`<span class="num muted" style="font-size:12px">${x.pts} pts</span>`:""}</li>`).join("")}
        ${(r.results||[]).length>10?`<li class="muted">${res&&res.pos>10?`You: P${res.pos} · `:""}+${r.results.length-10} more finishers</li>`:""}</ol>
        ${res?(claimed?`<span class="tag lead" style="align-self:flex-start">Claimed P${res.pos}</span>`:`<button class="btn" data-act="claim" data-id="${esc(r.id)}">Claim P${res.pos} · +${fmt(raceReward(res.pos,r.tier))} tokens</button>`):""}
      </article>`}).join("")}</div>`:`<div class="empty"><b>No races here yet</b>When results are posted, rewards show up here.</div>`}</section>`;
}
function vRankings(){
  let list=ALL;
  if(view.rankTier>=0)list=list.filter(d=>d.tier===view.rankTier);
  if(view.rankLeague!=="all")list=list.filter(d=>(d.leagues||[]).some(l=>l.id===view.rankLeague));
  if(view.rankQ)list=list.filter(d=>d.name.toLowerCase().includes(view.rankQ.toLowerCase())||String(d.team).toLowerCase().includes(view.rankQ.toLowerCase()));
  const byUser={};allCards.forEach(c=>{(byUser[c.user_id]=byUser[c.user_id]||{})[c.card_id]=c.qty});
  const collectors=profiles.map(p=>({p,uniq:Object.values(byUser[p.id]||{}).filter(n=>n>0).length,val:collectionValue(byUser[p.id])})).filter(c=>c.uniq).sort((a,b)=>b.val-a.val).slice(0,15);
  return`<section class="block"><div class="sec-head"><h2>Leagues in the pool</h2><p>Rarity comes from a driver's points share, wins and podiums in each league, weighted by league tier: A counts most, then B, then C, then R.</p></div>
    ${LEAGUES.length?`<div class="tablewrap"><table><thead><tr><th>League</th><th>Server</th><th>Tier</th><th>Season</th><th class="r">Drivers</th><th>Source</th></tr></thead><tbody>
      ${LEAGUES.map(L=>`<tr><td><span class="lg-pill">${esc(L.short)}</span>${esc(L.name)}</td><td>${esc(L.server||"—")}</td><td>${esc(L.tier)}</td><td>${esc(L.season||"")}</td><td class="r num">${(L.rows||[]).length}</td><td>${L.url?`<a href="${esc(L.url)}" target="_blank" rel="noopener">Standings</a>`:"—"}</td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty"><b>No leagues imported</b>Standings imported in League admin appear here.</div>`}</section>
  <section class="block"><div class="sec-head"><h2>Top collectors</h2><p>Ranked by quick-sell value of their collection.</p></div>
    ${collectors.length?`<div class="tablewrap"><table><thead><tr><th>#</th><th>Collector</th><th class="r">Drivers</th><th class="r">Value</th></tr></thead><tbody>
      ${collectors.map((c,i)=>`<tr><td class="num">${i+1}</td><td>${c.p.ign?face(c.p.ign):c.p.avatar_url?`<img class="mini-head" alt="" src="${esc(c.p.avatar_url)}" style="border-radius:50%">`:""}${esc(c.p.ign||c.p.discord_name)}${c.p.id===session?.user.id?' <span class="tag lead">You</span>':""}</td><td class="r num">${c.uniq}</td><td class="r num">${fmt(c.val)}</td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty"><b>No collectors yet</b>The first person to open a pack takes the top spot.</div>`}</section>
  <section class="block"><div class="sec-head"><h2>Driver rankings</h2><p>${fmt(ALL.length)} drivers. Tap one to see its card.</p></div>
    <div class="filters"><input type="text" id="rankQ" data-act="rankq" placeholder="Search driver or team" value="${esc(view.rankQ)}" aria-label="Search drivers">
      <select id="rankLeague" data-act="rankleague" aria-label="League"><option value="all">All leagues</option>${LEAGUES.map(L=>`<option value="${esc(L.id)}" ${view.rankLeague===L.id?"selected":""}>${esc(L.name)}</option>`).join("")}</select>
      <button class="fchip" data-act="ranktier" data-tier="-1" aria-pressed="${view.rankTier<0}">All</button>
      ${TIERS.map((T,t)=>`<button class="fchip" style="--tc:var(--t${t})" data-act="ranktier" data-tier="${t}" aria-pressed="${view.rankTier===t}"><span class="sw"></span>${T.name}</button>`).join("")}</div>
    <div class="tablewrap"><table><thead><tr><th class="r">#</th><th>Driver</th><th>Rarity</th><th class="r">OVR</th><th>Leagues</th><th class="r">Wins</th><th class="r">Pods</th><th class="r">Owned</th></tr></thead><tbody>
      ${list.slice(0,400).map(d=>`<tr data-card="${esc(d.id)}" style="cursor:pointer"><td class="r num">${d.rank}</td><td>${face(d.name)}${esc(d.name)} <span class="muted">${esc(d.team)}</span></td>
        <td><span class="tpill" style="--tc:var(--t${d.tier})">${TIERS[d.tier].name}</span></td><td class="r num">${d.ovr}</td>
        <td>${(d.leagues||[]).map(l=>`<span class="lg-pill">${esc(l.short)} P${l.pos}</span>`).join("")}</td><td class="r num">${d.wins}</td><td class="r num">${d.pods}</td><td class="r num">${myCards[d.id]||""}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function vAdmin(){
  if(!isAdmin())return`<div class="empty"><b>Admins only</b>League admin is for the league staff.</div>`;
  const pend=ignReqs.filter(r=>r.status==="pending"),denied=ignReqs.filter(r=>r.status==="denied");
  const prof=id=>profiles.find(p=>p.id===id)||{};
  const approved=profiles.filter(p=>p.ign).sort((a,b)=>a.ign.localeCompare(b.ign));
  return`<section class="block"><div class="sec-head"><h2>IGN requests</h2><p>Each request shows the Discord account that signed in and asked for the IGN. Accept it if that Discord user really owns the Minecraft account.</p></div>
    ${pend.length?`<div class="races">${pend.map(r=>{const p=prof(r.user_id);const clash=profiles.find(x=>x.ign&&x.ign.toLowerCase()===r.ign.toLowerCase()&&x.id!==r.user_id);
      return`<article class="race"><div><span class="eyebrow">${new Date(r.created_at).toISOString().slice(0,16).replace("T"," ")} UTC</span>
        <h3 style="display:flex;align-items:center;gap:8px">${p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="" style="width:28px;height:28px;border-radius:50%">`:""}${esc(p.discord_name||"Unknown")}</h3>
        ${p.discord_handle?`<span class="muted num" style="font-size:13px">Discord: ${esc(p.discord_handle)}</span>`:""}</div>
        <div class="kvs" style="margin:0"><dt>Wants IGN</dt><dd>${face(r.ign)}${esc(r.ign)}</dd>${p.ign?`<dt>Current IGN</dt><dd>${esc(p.ign)}</dd>`:""}</div>
        ${clash?`<span class="tag out">Already approved for ${esc(clash.discord_name)}</span>`:""}
        <input type="text" id="deny-${esc(r.user_id)}" placeholder="Reason if denying (optional)" aria-label="Deny reason">
        <div class="row"><button class="btn sm" data-act="ignok" data-id="${esc(r.user_id)}">Accept</button><button class="btn warn sm" data-act="ignno" data-id="${esc(r.user_id)}">Deny</button></div></article>`}).join("")}</div>`
      :`<div class="empty" style="padding:18px"><b>No requests waiting</b>Players submit their IGN from the Rewards tab.</div>`}
    ${denied.length?`<p class="muted" style="font-size:13px;margin:10px 0 0">${denied.length} denied request${denied.length>1?"s":""} waiting for the player to resubmit.</p>`:""}
    <div class="two" style="margin-top:16px">
      <form class="panel" data-form="cfg" style="display:flex;flex-direction:column;gap:8px"><b style="font-family:var(--f-display)">What players see on the IGN form</b>
        <label class="f" for="cfgInvite">Discord invite link<input type="text" id="cfgInvite" name="invite" value="${esc(siteCfg.discord_invite||"")}" placeholder="https://discord.gg/…"></label>
        <label class="f" for="cfgNote">Note<textarea id="cfgNote" name="note" style="min-height:70px;font-family:var(--f-body);font-size:14px" placeholder="Approvals usually take a day.">${esc(siteCfg.ign_note||"")}</textarea></label>
        <button class="btn ghost sm" style="align-self:flex-start">Save</button></form>
      <div class="panel" style="display:flex;flex-direction:column;gap:8px"><b style="font-family:var(--f-display)">Approved IGNs (${approved.length})</b>
        ${approved.length?approved.map(p=>`<div class="row" style="justify-content:space-between"><span>${face(p.ign)}${esc(p.ign)} <span class="muted">${esc(p.discord_name)}</span></span><button class="btn ghost sm" data-act="revoke" data-id="${esc(p.id)}">Revoke</button></div>`).join(""):'<p class="muted" style="margin:0">None yet.</p>'}</div></div></section>
  <section class="block"><div class="sec-head"><h2>Import standings</h2><p>Copy a league's driver standings (BoatStats drivers tab, IceDrifters standings, or your own sheet) and paste them here. Saving the same short code and season replaces it, and the card pool updates automatically.</p></div>
    <form class="panel" data-form="league" style="display:flex;flex-direction:column;gap:12px">
      <div class="row"><label class="f" for="lname" style="flex:2;min-width:180px">League name<input type="text" id="lname" name="lname" placeholder="BoatLabs League A"></label>
        <label class="f" for="lshort" style="width:110px">Short code<input type="text" id="lshort" name="lshort" maxlength="5" placeholder="BLA"></label>
        <label class="f" for="lserver">Server<select id="lserver" name="lserver"><option>FrostHex</option><option>BoatLabs</option><option>IceDrifters</option><option>IBR</option><option>Other</option></select></label>
        <label class="f" for="ltier">Tier<select id="ltier" name="ltier"><option value="A">A (highest)</option><option value="B">B</option><option value="C">C</option><option value="R">R (lowest)</option></select></label>
        <label class="f" for="lseason" style="width:110px">Season<input type="text" id="lseason" name="lseason" value="2026"></label></div>
      <label class="f" for="lurl">Standings link<input type="text" id="lurl" name="lurl" placeholder="https://…"></label>
      <label class="f" for="lrows">Standings<textarea id="lrows" name="lrows" placeholder="One driver per line:&#10;name | team | points | wins | podiums"></textarea></label>
      <div class="row"><button class="btn">Save league</button><button type="button" class="btn ghost" data-act="rebuild">Rebuild card pool</button><span class="muted" style="font-size:13px" id="parsePreview"></span></div></form></section>
  <section class="block"><div class="sec-head"><h2>Leagues</h2></div>
    ${LEAGUES.length?`<div class="tablewrap"><table><thead><tr><th>League</th><th>Tier</th><th class="r">Drivers</th><th></th></tr></thead><tbody>${LEAGUES.map(L=>`<tr><td><span class="lg-pill">${esc(L.short)}</span>${esc(L.name)} <span class="muted">${esc(L.server||"")} ${esc(L.season||"")}</span></td>
      <td><select data-act="settier" data-id="${esc(L.id)}" aria-label="Tier for ${esc(L.name)}">${["A","B","C","R"].map(t=>`<option ${L.tier===t?"selected":""}>${t}</option>`).join("")}</select></td>
      <td class="r num">${(L.rows||[]).length}</td><td class="r"><button class="btn ghost sm" data-act="delleague" data-id="${esc(L.id)}">Remove</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty"><b>No leagues yet</b>Import one above.</div>`}</section>
  <section class="block two">
    <form class="panel" data-form="race" style="display:flex;flex-direction:column;gap:12px"><h3 style="font-size:18px">Post race results</h3>
      <div class="row"><label class="f" for="rname" style="flex:1;min-width:160px">Race<input type="text" id="rname" name="rname" placeholder="R09 · SiegeoftheNorth"></label>
        <label class="f" for="rleague">League<select id="rleague" name="rleague">${LEAGUES.map(L=>`<option>${esc(L.short)}</option>`).join("")}<option value="">Other</option></select></label>
        <label class="f" for="rtier">Tier if Other<select id="rtier" name="rtier"><option>A</option><option>B</option><option selected>C</option><option>R</option></select></label>
        <label class="f" for="rdate">Date<input type="date" id="rdate" name="rdate" value="${today()}"></label></div>
      <label class="f" for="rresults">Finishing order, one IGN per line<textarea id="rresults" name="rresults" placeholder="1. mafi0z0&#10;2. PaperYoshii&#10;3. JHdash77"></textarea></label>
      <button class="btn" style="align-self:flex-start">Post race</button></form>
    <form class="panel" data-form="track" style="display:flex;flex-direction:column;gap:10px"><h3 style="font-size:18px">Add or update a BoatLabs track</h3>
      <p class="muted" style="margin:0;font-size:14px">${siteCfg.tracks_feed_url?`Nightly feed: <b style="color:var(--ink)">${esc(siteCfg.tracks_feed_status||"not checked yet")}</b>${siteCfg.tracks_feed_checked?` · checked ${esc(new Date(siteCfg.tracks_feed_checked).toLocaleString())}`:""}. <button type="button" class="btn ghost sm" data-act="syncfeed">Check now</button>`:"Run auto_tracks.sql to turn on nightly updates."}</p>
      <label class="f" for="tName">Track name<input type="text" id="tName" name="tname" placeholder="Luigi Circuit"></label>
      <label class="f" for="tTop">Top 20 (position | player | time)<textarea id="tTop" name="ttop" placeholder="1|Makkuusen|25.335&#10;2|Lapis_Lettuce|25.350"></textarea></label>
      <button class="btn" style="align-self:flex-start">Save track</button></form></section>
  <section class="block"><div class="sec-head"><h2>Posted races (${races.length})</h2></div>
    <div class="tablewrap"><table><thead><tr><th>Race</th><th>League</th><th>Date</th><th class="r">Finishers</th><th></th></tr></thead><tbody>
      ${[...races].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.league)} · ${esc(r.tier)}</td><td class="num">${esc(r.date)}</td><td class="r num">${(r.results||[]).length}</td><td class="r"><button class="btn ghost sm" data-act="delrace" data-id="${esc(r.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div></section>`;
}
const VIEWS={packs:vPacks,shop:vShop,collection:vCollection,auctions:vAuctions,races:vRaces,rankings:vRankings,admin:vAdmin};
let lastHTML="";
function render(){
  if(!sb){$("#main").innerHTML=`<div class="empty"><b>Almost there</b>Open <span class="num">config.js</span> and paste your Supabase URL and anon key. The setup guide explains where to find them.</div>`;return}
  if(!VIEWS[tab]||(tab==="admin"&&!isAdmin()))tab="packs";
  renderWallet();
  const ae=document.activeElement,aid=ae&&ae.id,sel=aid&&ae.selectionStart;
  const html=VIEWS[tab]();
  if(html!==lastHTML){
    const keep={};$("#main").querySelectorAll("input[id],textarea[id]").forEach(el=>{if(el.value!==el.defaultValue)keep[el.id]=el.value});
    $("#main").innerHTML=html;lastHTML=html;
    for(const [id,v] of Object.entries(keep)){const el=document.getElementById(id);if(el)el.value=v}
  }
  if(aid){const el=document.getElementById(aid);if(el&&el!==document.activeElement){el.focus();try{if(sel!=null)el.setSelectionRange(sel,sel)}catch{}}}
}

/* ---------- overlays ---------- */
function closeOverlay(){$("#overlay").innerHTML=""}
function showReveal(title,items){
  const sorted=[...items].sort((a,b)=>card(a.id).tier-card(b.id).tier);
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet">
    <div class="sheet-head"><div><span class="eyebrow">Opening</span><h2 style="font-size:22px">${esc(title)}</h2></div>
      <div class="row"><button class="btn ghost" data-act="flipall">Reveal all</button><button class="btn" data-act="close">Done</button></div></div>
    <div class="reveal-grid">${sorted.map((x,i)=>`<button type="button" class="flip" data-flip aria-label="Reveal card ${i+1}"><div class="flip-in"><div class="back">Ice Lap</div><div class="face">${cardHTML(card(x.id),{isNew:x.is_new,tag:"div"})}</div></div></button>`).join("")}</div>
    <p class="muted" style="margin:14px 0 0;font-size:14px">${sorted.filter(x=>x.is_new).length} new · best pull: ${esc(TIERS[Math.max(...sorted.map(x=>card(x.id).tier))].name)}</p></div></div>`;
}
function showDetail(id){
  const d=card(id),n=myCards[id]||0;
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(d.name)}"><div class="sheet">
    <div class="sheet-head"><h2 style="font-size:22px">${esc(d.name)}</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <div class="detail">${cardHTML(d,{tag:"div"})}<div>
      <dl class="kvs"><dt>Pool rank</dt><dd>#${d.rank} of ${ALL.length}</dd><dt>Rarity</dt><dd>${TIERS[d.tier].name}</dd><dt>Score</dt><dd>${Number(d.score).toFixed(1)}</dd>
        ${(d.leagues||[]).map(l=>`<dt>${esc(l.name)} <span class="muted">(${esc(l.tier)})</span></dt><dd>P${l.pos} · ${fmt(l.pts)} pts</dd>`).join("")}
        <dt>Wins / podiums</dt><dd>${d.wins} / ${d.pods}</dd><dt>You own</dt><dd>${n}</dd></dl>
      ${n?`<div style="display:flex;flex-direction:column;gap:12px">
        <div class="row"><button class="btn ghost" data-act="sell" data-id="${esc(id)}">Quick sell · ${fmt(TIERS[d.tier].sell)}</button>${n>1?`<button class="btn ghost" data-act="selldupes" data-id="${esc(id)}">Sell ${n-1} duplicates · ${fmt(TIERS[d.tier].sell*(n-1))}</button>`:""}</div>
        <form data-form="list" data-id="${esc(id)}" class="panel" style="display:flex;flex-direction:column;gap:10px"><b style="font-family:var(--f-display)">List on auction</b>
          <div class="row"><label class="f" for="aStart">Starting bid<input type="number" id="aStart" name="start" min="1" value="${TIERS[d.tier].sell*2}" style="width:120px"></label>
          <label class="f" for="aBuy">Buy now (optional)<input type="number" id="aBuy" name="buy" min="0" placeholder="—" style="width:130px"></label>
          <label class="f" for="aHours">Length<select id="aHours" name="hours"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option></select></label></div>
          <button class="btn" style="align-self:flex-start">List card</button></form></div>`:""}
    </div></div></div></div>`;
}

/* ---------- events ---------- */
document.addEventListener("click",async e=>{
  const flip=e.target.closest("[data-flip]");if(flip){flip.classList.add("open");return}
  const t=e.target.closest("[data-act]");
  if(!t){const c=e.target.closest("[data-card]");if(c&&!c.closest(".overlay"))showDetail(c.dataset.card);
    else if(e.target.classList.contains("overlay"))closeOverlay();return}
  if(t.tagName==="SELECT"||t.tagName==="INPUT")return;
  const a=t.dataset.act,id=t.dataset.id;
  const once=async fn=>{t.disabled=true;try{await fn()}finally{if(document.contains(t))t.disabled=false}};
  switch(a){
    case"signin":return signIn();
    case"signout":return signOut();
    case"close":return closeOverlay();
    case"daily":return once(claimDaily);
    case"open":return once(()=>openPack(t.dataset.type));
    case"buy":return once(()=>buyPack(t.dataset.type));
    case"tier":return once(()=>buyTier(+t.dataset.tier));
    case"board":return once(()=>buyBoard(id));
    case"coltier":view.colTier=+t.dataset.tier;return render();
    case"ranktier":view.rankTier=+t.dataset.tier;return render();
    case"raceleague":view.raceLeague=t.dataset.l;return render();
    case"trackmine":view.trackMine=!view.trackMine;return render();
    case"flipall":return document.querySelectorAll("[data-flip]").forEach((f,i)=>setTimeout(()=>f.classList.add("open"),i*160));
    case"sell":return once(()=>quickSell(id,1));
    case"selldupes":return once(()=>quickSell(id,(myCards[id]||1)-1));
    case"buynow":return once(()=>placeBid(id,0,true));
    case"cancel":return once(()=>cancelAuction(id));
    case"claim":return once(()=>claimRace(id));
    case"claimtrack":return once(()=>claimTrack(id));
    case"claimall":return once(claimAll);
    case"ignok":return once(()=>decideIgn(id,true));
    case"ignno":return once(()=>decideIgn(id,false));
    case"revoke":return once(async()=>{try{await rpc("revoke_ign",{p_user:id});await loadPeople();toast("IGN revoked");render()}catch(err){toast(errMsg(err))}});
    case"rebuild":return once(()=>rebuildCatalog(false));
    case"syncfeed":return once(async()=>{try{const m=await rpc("admin_sync_tracks");toast(m);await loadPublic();render()}catch(err){toast(errMsg(err))}});
    case"delrace":if(t.dataset.confirm)return once(()=>adminDo(sb.from("races").delete().eq("id",id),"Race deleted"));t.dataset.confirm=1;t.textContent="Confirm delete";t.classList.add("warn");return;
    case"delleague":if(t.dataset.confirm)return once(async()=>{const {error}=await sb.from("leagues").delete().eq("id",id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("League removed. Card pool updated.")});t.dataset.confirm=1;t.textContent="Confirm remove";t.classList.add("warn");return;
  }
});
document.addEventListener("change",async e=>{
  const t=e.target;
  if(t.dataset.act==="colsort"){view.colSort=t.value;render()}
  else if(t.dataset.act==="rankleague"){view.rankLeague=t.value;render()}
  else if(t.dataset.act==="settier"){const {error}=await sb.from("leagues").update({tier:t.value,updated_at:new Date().toISOString()}).eq("id",t.dataset.id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Tier changed. Card pool updated.")}
});
document.addEventListener("input",e=>{
  const t=e.target;
  if(t.dataset.act==="rankq"){view.rankQ=t.value;render()}
  else if(t.dataset.act==="trackq"){view.trackQ=t.value;render()}
  if(t.id==="lrows"){const n=parseStandings(t.value).length;const p=$("#parsePreview");if(p)p.textContent=n?`${n} drivers found`:""}
});
document.addEventListener("submit",async e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();const k=f.dataset.form;const d=new FormData(f);
  const btn=f.querySelector("button:not([type=button])");if(btn)btn.disabled=true;
  try{
    if(k==="bid")await placeBid(f.dataset.id,+d.get("amt"),false);
    else if(k==="list")await listAuction(f.dataset.id,+d.get("start"),+d.get("buy"),+d.get("hours"));
    else if(k==="ign")await requestIgn(d.get("ign"));
    else if(k==="league")await saveLeague(f);
    else if(k==="race")await postRace(f);
    else if(k==="track")await saveTrack(f);
    else if(k==="cfg")await adminDo(sb.from("site_config").update({discord_invite:String(d.get("invite")||"").trim(),ign_note:String(d.get("note")||"").trim()}).eq("id",1),"Saved");
  }finally{if(btn&&document.contains(btn))btn.disabled=false}
});
window.addEventListener("hashchange",()=>{tab=location.hash.slice(1)||"packs";lastHTML="";render();window.scrollTo(0,0)});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeOverlay()});
setInterval(()=>{
  let ended=false;
  document.querySelectorAll("[data-ends]").forEach(el=>{const ms=+el.dataset.ends-Date.now();el.textContent=dur(ms);el.classList.toggle("late",ms<3e5);if(ms<=0)ended=true});
  document.querySelectorAll("[data-until]").forEach(el=>{el.textContent=dur(+el.dataset.until-Date.now())});
  if(ended&&sb){loadAuctions().then(()=>loadMe()).then(()=>{lastHTML="";render()})}
},1000);

/* ---------- boot ---------- */
async function boot(){
  render();if(!sb)return;
  const {data}=await sb.auth.getSession();session=data.session;
  try{await loadPublic();await loadMe()}catch(e){toast(errMsg(e))}
  if(location.hash.includes("access_token")||location.search.includes("code="))history.replaceState(null,"",location.pathname+"#packs");
  render();
  sb.auth.onAuthStateChange(async(ev,s)=>{
    const changed=(s?.user?.id||null)!==(session?.user?.id||null);session=s;
    if(changed){await loadMe();await loadPeople();lastHTML="";render();if(ev==="SIGNED_IN"&&me&&me.opened===0)toast(`Welcome, ${me.discord_name}! Your Starter Kit and 1,000 tokens are under Packs.`)}
  });
  sb.channel("live").on("postgres_changes",{event:"*",schema:"public",table:"auctions"},async()=>{await loadAuctions();if(session)await loadMe();render()})
    .on("postgres_changes",{event:"*",schema:"public",table:"ign_requests"},async()=>{if(session)await loadMe();render()})
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"profiles"},async p=>{if(session&&p.new?.id===session.user.id){await loadMe();render()}})
    .subscribe();
  setInterval(async()=>{try{await loadAuctions();render()}catch{}},60000);
}
boot();
