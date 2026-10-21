/* IBR Trading Cards — front end. All game rules run in the database (supabase/schema.sql). */
"use strict";

/* ---------- constants ---------- */
const TIERS=[
  {name:"Common",sell:15,price:150},{name:"Uncommon",sell:40,price:400},{name:"Rare",sell:100,price:700},
  {name:"Epic",sell:260,price:4000},{name:"Legendary",sell:800,price:18000},{name:"Mythic",sell:2500,price:60000}];
const TIER_SHORT=["C","U","R","E","L","M"];
const LEAGUE_W={A:1,B:.65,C:.4,R:.2};
const TIER_MULT={A:1.5,B:1.2,C:1,R:.8};
const POS_TOKENS=[100,75,60,50,45,40,35,30,28,25];
const posTokens=p=>p<=10?POS_TOKENS[p-1]:p<=15?18:p<=20?12:8;
/* order inside a tier: each step below the top league is worth 10% less */
const tierRankFactor=r=>Math.max(.7,1-.1*((+r||1)-1));
const leagueFactor=short=>{const L=LEAGUES.filter(x=>x.short===short);return L.length?tierRankFactor(Math.min(...L.map(x=>x.tier_rank||1))):1};
const leagueWeight=L=>(LEAGUE_W[L.tier]??.4)*tierRankFactor(L.tier_rank);
const raceReward=(pos,tier="C",league)=>{const base=Math.round(posTokens(pos)*(TIER_MULT[tier]||1)/5)*5;return league?Math.round(base*leagueFactor(league)/5)*5:base};
const racePack=pos=>pos===1?"gold":pos<=3?"silver":null;
const trackReward=p=>!p?0:p===1?40:p===2?30:p===3?25:p<=5?20:p<=10?12:p<=15?8:p<=20?5:0;
const AUCTION_FEE=.05;
const MYTHIC_COUNT=6;
const DISCORD_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.7 19.7 0 0 0 6 3l1.3-2.1a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.6 19.6 0 0 0 6-3c.5-5.1-.8-9.5-3.6-13.6ZM8.1 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7.8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>Number(n||0).toLocaleString("en-US");
const today=()=>new Date().toISOString().slice(0,10);
const yesterday=()=>new Date(Date.now()-864e5).toISOString().slice(0,10);
/* daily pack resets at midnight in the player's own time zone */
const myTz=()=>me?.tz||"UTC";
const dayIn=(tz,ms)=>{try{return new Date(ms).toLocaleDateString("en-CA",{timeZone:tz})}catch{return new Date(ms).toISOString().slice(0,10)}};
const localToday=()=>dayIn(myTz(),Date.now());
const dailyNext=()=>me&&me.last_daily_at?Date.parse(me.last_daily_at)+864e5:0;
const dailyReady=()=>signedIn()&&Date.now()>=dailyNext();
const localYesterday=()=>new Date(Date.parse(localToday()+"T12:00:00Z")-864e5).toISOString().slice(0,10);
function nextLocalMidnight(){const t=localToday();let lo=Date.now(),hi=lo+26*36e5;while(hi-lo>1000){const m=Math.floor((lo+hi)/2);if(dayIn(myTz(),m)===t)lo=m;else hi=m}return hi}
let tzTried=false;
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
let ECON=null,mySets={},allSetClaims=[],PULLS=[],SALES=[],NOTICES=[],pendingOpen=null;
/* links: #packs #collection #collection/sets #auctions #races #rankings/collectors #rankings/pulls #help #card/<id> #player/<name> */
function parseHash(){
  const h=decodeURIComponent((location.hash||"#packs").slice(1));const [a,b]=h.split("/");
  const alias={shop:"packs",guide:"help",auction:"auctions",rewards:"races"};
  if(a==="sets"){view.colSub="sets";return"collection"}
  if(a==="card"&&b){pendingOpen={card:b};return"rankings"}
  if(a==="player"&&b){view.rankSub="collectors";pendingOpen={player:b};return"rankings"}
  const t=alias[a]||a||"packs";
  if(t==="rankings"&&b)view.rankSub=b;if(t==="collection")view.colSub=b==="sets"?"sets":"cards";
  return t;
}
const ago=ts=>{const s=Math.max(0,(Date.now()-new Date(ts).getTime())/1e3);return s<60?"just now":s<3600?`${Math.floor(s/60)}m ago`:s<86400?`${Math.floor(s/3600)}h ago`:`${Math.floor(s/86400)}d ago`};
const seg=(key,opts,base)=>`<div class="seg" role="tablist">${opts.map(([v,l])=>`<a class="seg-b" href="#${base}/${v}" aria-pressed="${view[key]===v}">${l}</a>`).join("")}</div>`;
async function loadSales(){try{SALES=await all("sales",{order:"at",asc:false,limit:2000})}catch{SALES=[]}}
async function loadNotices(){if(!session){NOTICES=[];return}try{NOTICES=await all("notices",{eq:["user_id",session.user.id],order:"at",asc:false,limit:40})}catch{NOTICES=[]}}
async function loadPulls(){try{PULLS=await all("pull_log",{order:"at",asc:false,limit:40})}catch{PULLS=[]}}
let session=null,me=null,myPacks={},myCards={},myRaceClaims={},myTrackClaims={},myReq=null,boardBought=[];
let VARIANTS=[],VBY={},SPECIALS=[],NAMEMAP=[],PLAYERS=[],STARS=[],TEAMALIAS=[],DTEAMS=[],REMOVED=[];let REMSET=new Set();
const canonTeam=t=>{const x=String(t||"").trim();const a=TEAMALIAS.find(r=>r.alias===x.toLowerCase());return a?a.team:x};
let myPick=null,MYBUGS=[],BUGS=[],IS_OWNER=false;let ALL=[],BY_ID={},PACKS={},LEAGUES=[],races=[],tracks=[],auctions=[],profiles=[],allCards=[],board=[],teamOfWeek="",siteCfg={},ignReqs=[];
const view={colN:24,spN:12,raceN:12,trackN:12,setsAll:false,rankAll:false,colSub:"cards",rankSub:"drivers",collSort:"val",colTier:-1,colSort:"tier",rankTier:-1,rankQ:"",rankLeague:"all",raceLeague:"all",trackQ:"",trackMine:false};
let tab=parseHash();
const signedIn=()=>!!(session&&me);
const isAdmin=()=>!!me?.is_admin;
const myIgn=()=>me?.ign||"";
const pname=id=>{const p=profiles.find(x=>x.id===id);return p?(p.ign||p.discord_name||"Collector"):"Collector"};
const card=id=>BY_ID[id]||{id,name:id,team:"Retired",teams:[],tier:0,ovr:45,wins:0,pods:0,leagues:[],rank:"—",score:0};
const owned=()=>Object.entries(myCards).filter(([,n])=>n>0);
const VCOL={base:"#5b6670",holo:"linear-gradient(90deg,#ff6b8b,#ffb84d,#5ad79a,#4aa8ff,#a477ff)",frost:"#3b8db5",gold:"linear-gradient(90deg,#8a5d00,#d9a21b,#8a5d00)",
  aurora:"linear-gradient(90deg,#1c8f6a,#5c4fd6)",blackice:"#0a0f14",diamond:"linear-gradient(90deg,#4cc9f0,#f72585,#ffd60a)"};
const vinfo=v=>VBY[v]||{id:v,name:v,sell_mult:1,sort:0};
const serialTxt=s=>s.serial?`${String(s.serial).padStart(String(s.print_run).length,"0")}/${s.print_run}`:"";
const vpill=(v,s)=>`<span class="vpill" style="--vc:${VCOL[v]||"#555"}">${esc(vinfo(v).name)}${s&&s.serial?` <b>${serialTxt(s)}</b>`:""}</span>`;
const spSell=s=>Math.round(TIERS[card(s.card_id).tier].sell*Number(vinfo(s.variant).sell_mult||1));
const spOf=s=>({sid:s.id,variant:s.variant,serial:s.serial,print_run:s.print_run});
const mySpecials=()=>{const u=session?.user.id;return u?SPECIALS.filter(s=>s.owner===u&&s.status!=="retired"):[]};
const ownedIds=()=>new Set([...owned().map(([id])=>id),...mySpecials().map(s=>s.card_id)]);
const collectionValue=(c,uid)=>Object.entries(c||{}).reduce((s,[id,n])=>s+TIERS[card(id).tier].sell*n,0)+
  (uid?SPECIALS.filter(s=>s.owner===uid&&s.status!=="retired").reduce((a,s)=>a+spSell(s),0):0);
/* names this racer has used (renamed players keep their results) */
function namesFor(ign){
  const g=String(ign||"").toLowerCase();if(!g)return new Set();
  const cur=PLAYERS.find(p=>p.current.toLowerCase()===g);
  const ids=cur?[cur.uuid]:NAMEMAP.filter(n=>n.league==="*"&&n.name===g).map(n=>n.uuid);
  const out=new Set([g]);NAMEMAP.filter(n=>ids.includes(n.uuid)).forEach(n=>out.add(n.name));
  PLAYERS.filter(p=>ids.includes(p.uuid)).forEach(p=>out.add(p.current.toLowerCase()));return out;
}
let myNamesCache={k:null,v:new Set()};
const myNames=()=>{const g=myIgn();if(myNamesCache.k!==g)myNamesCache={k:g,v:namesFor(g)};return myNamesCache.v};

/* ---------- loading ---------- */
async function loadPublic(){
  const [cards,packs,lg,rc,tr,cfg,vr,pl,pn,st,ta,dt,rm]=await Promise.all([all("cards",{order:"rank"}),all("pack_types",{order:"sort"}),all("leagues"),all("races"),all("tracks",{order:"name"}),sb.from("site_config").select("*").eq("id",1).maybeSingle(),
    all("variants",{order:"sort"}).catch(()=>[]),all("players").catch(()=>[]),all("player_names").catch(()=>[]),all("driver_overrides",{order:"display"}).catch(()=>[]),all("team_aliases").catch(()=>[]),all("driver_teams",{order:"display"}).catch(()=>[]),all("removed_players",{order:"name"}).catch(()=>[])]);
  VARIANTS=vr;VBY=Object.fromEntries(vr.map(v=>[v.id,v]));PLAYERS=pl;NAMEMAP=pn;STARS=st;TEAMALIAS=ta;DTEAMS=dt||[];REMOVED=rm||[];REMSET=new Set(REMOVED.map(r=>String(r.name).toLowerCase()));myNamesCache.k=null;
  ALL=cards.filter(c=>c.active);BY_ID=Object.fromEntries(cards.map(c=>[c.id,c]));
  PACKS=Object.fromEntries(packs.map(p=>[p.id,{...p,w:(p.weights||[]).map(Number),c:[p.c1,p.c2],desc:p.description}]));
  LEAGUES=lg.sort((a,b)=>"ABCR".indexOf(a.tier)-"ABCR".indexOf(b.tier)||(a.tier_rank||1)-(b.tier_rank||1)||String(a.name).localeCompare(b.name));
  /* removed players are hidden from results and track times (their positions stay as they were) */
  const keep=x=>!REMSET.has(String(x.mc||"").toLowerCase());
  races=rc.map(r=>({...r,results:(r.results||[]).filter(keep)}));tracks=tr.map(t=>({...t,top:(t.top||[]).filter(keep)}));siteCfg=cfg.data||{};
  board=[];
  try{teamOfWeek=await rpc("team_of_week")||""}catch{teamOfWeek=""}
  await Promise.all([loadAuctions(),loadPeople(),loadPulls(),loadSales()]);
}
async function loadAuctions(){
  try{await rpc("settle_due")}catch{}
  auctions=await all("auctions",{order:"ends_at"});
}
async function loadPeople(){
  [profiles,allCards,SPECIALS]=await Promise.all([all("profiles",{select:"id,discord_name,discord_handle,avatar_url,ign,coins,is_admin,showcase,locked,created_at"}),all("user_cards",{select:"user_id,card_id,qty"}),all("special_cards",{order:"id"}).catch(()=>[])]);
  try{allSetClaims=await all("set_claims",{select:"user_id,set_id"})}catch{allSetClaims=[]}
}
async function loadSpecials(){try{SPECIALS=await all("special_cards",{order:"id"})}catch{}}
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
  try{mySets=Object.fromEntries((await all("set_claims",{eq:["user_id",uid]})).map(x=>[x.set_id,x.coins]))}catch{mySets={}}
  try{const pp=await sb.from("pending_picks").select("*").eq("user_id",uid).is("picked_at",null).maybeSingle();myPick=pp.data||null}catch{myPick=null}
  try{MYBUGS=await all("bug_reports",{eq:["user_id",uid],order:"created_at"});MYBUGS.reverse()}catch{MYBUGS=[]}
  myReq=req.data||null;boardBought=bb.filter(x=>x.day===today()).map(x=>x.card_id);
  const bt=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone}catch{return""}})();
  if(me&&bt&&me.tz!==bt&&!tzTried){tzTried=true;try{me.tz=await rpc("set_timezone",{p_tz:bt})||me.tz}catch{}}
  if(me?.is_admin){try{const dm=await sb.from("diamond_meter").select("*").eq("id",1).maybeSingle();if(dm.data)DMETER=dm.data}catch{}try{IS_OWNER=!!(await rpc("is_owner"))}catch{IS_OWNER=false}try{BUGS=(await all("bug_reports",{order:"created_at"})).reverse()}catch{BUGS=[]}ignReqs=await all("ign_requests",{order:"created_at"});try{ECON=await rpc("admin_economy")}catch{ECON=null}}
  myNamesCache.k=null;
  await loadNotices();
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
    <p class="muted" style="font-size:15px">New collectors get a Starter Kit and 250 tokens. Add your Minecraft IGN later to earn rewards from your race results.</p>
    <button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button></div></div>`;
}

/* ---------- actions ---------- */
async function act(fn,args,after){
  try{const r=await rpc(fn,args);await Promise.all([loadMe(),loadSpecials()]);if(after)await after(r);render();return r}
  catch(e){toast(errMsg(e));return null}
}
async function claimDaily(){if(!guard())return;await act("claim_daily",{},r=>toast(r.streak>1?`Daily Pack added · ${r.streak}-day streak`:"Daily Pack added"))}
const packResult=(t,r)=>{if(!r)return;if(r.pick){myPick={pack:r.pack,cards:r.cards};showPicker()}else showReveal(PACKS[t]?.name||"Pack",r)};
async function openPack(t){if(!guard())return;if(PACKS[t]?.pick_one&&myPick)return showPicker();packResult(t,await act("open_pack",{p_type:t}))}
async function buyPack(t){if(!guard())return;if(PACKS[t]?.pick_one&&myPick){toast("Pick your card from your last special pack first.");return showPicker()}packResult(t,await act("buy_pack",{p_type:t}))}
async function keepCard(i){if(!guard()||!myPick)return;const r=await act("pick_card",{p_i:i});
  if(r){const d=card(r.id);myPick=null;closeOverlay();toast(`Kept ${d.name}${r.variant&&r.variant!=="base"?` · ${vinfo(r.variant).name}${r.serial?" "+serialTxt(r):""}`:""}`);render()}}
async function buyTier(t){if(!guard())return;const r=await act("buy_tier",{p_tier:t});if(r)showReveal(`${TIERS[t].name} pull`,r)}
async function buyBoard(id){if(!guard())return;const r=await act("buy_board",{p_card:id});if(r)showReveal("Featured card",r)}
async function quickSell(id,n){if(!guard())return;const v=await act("quick_sell",{p_card:id,p_n:n});if(v!=null){toast(`Sold for ${fmt(v)} tokens`);closeOverlay();await loadPeople();render()}}
async function quickSellSpecial(sid){if(!guard())return;const v=await act("quick_sell_special",{p_id:+sid});if(v!=null){toast(`Sold for ${fmt(v)} tokens. That serial is retired for good.`);closeOverlay();await loadPeople();render()}}
async function listSpecial(sid,start,buyNow,hours){
  if(!guard())return;const r=await act("list_special",{p_id:+sid,p_start:Math.floor(start),p_buy_now:Math.floor(buyNow)||0,p_hours:hours},loadAuctions);
  if(r){toast("Listed on the auction house");closeOverlay();location.hash="#auctions"}
}
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
async function claimTrack(id){if(!guard())return;const r=await act("claim_track",{p_track:id});if(r)toast(`P${r.pos}: +${fmt(r.coins)} tokens`)}
async function claimAll(){if(!guard())return;const r=await act("claim_all");if(r)toast(`Claimed ${r.races} races and ${r.tracks} tracks · +${fmt(r.coins)} tokens`)}

/* ---------- admin ---------- */
function buildCatalog(){
  const D={};
  const nm={};NAMEMAP.forEach(n=>nm[n.league+"|"+n.name]=n.uuid);const cur=Object.fromEntries(PLAYERS.map(p=>[p.uuid,p.current]));
  const who=(lid,name)=>{const l=String(name).toLowerCase();const u=nm[lid+"|"+l]||nm["*|"+l];return u?{k:"u:"+u,uuid:u,name:cur[u]||String(name)}:{k:"n:"+l,uuid:"",name:String(name)}};
  LEAGUES.forEach(L=>{
    const rows=Array.isArray(L.rows)?L.rows:[];if(!rows.length)return;
    const lead=Math.max(1,...rows.map(r=>+r[2]||0));const tw=leagueWeight(L);
    rows.forEach((r,i)=>{const [name,team0,pts,w,p]=r;const team=canonTeam(team0);if(!name)return;const P=who(L.id,name);const k=P.k;
      const d=D[k]||(D[k]={id:P.name,name:P.name,uuid:P.uuid.startsWith("manual:")?"":P.uuid,aliases:[],teams:[],wins:0,pods:0,score:0,leagues:[]});
      const al=String(name).toLowerCase();if(al!==d.name.toLowerCase()&&!d.aliases.includes(al))d.aliases.push(al);
      /* leagues in the same series (FC1 + FC2) don't stack: only the driver's best one counts */
      const ser=String(L.series||L.id).toLowerCase(),sc=((+pts||0)/lead*100+(+w||0)*8+(+p||0)*3)*tw;
      d.by=d.by||{};if(!d.by[ser]||sc>d.by[ser].sc)d.by[ser]={sc,w:+w||0,p:+p||0};
      if(team&&!d.teams.includes(team))d.teams.push(team);
      d.leagues.push({id:L.id,short:L.short,name:L.name,tier:L.tier,pos:i+1,pts:+pts||0,team:team||""});});
  });
  /* best league counts fully, then 50%, 25%, 15%, 10%... so missing a league doesn't sink anyone */
  const STACK=[1,.5,.25,.15,.1];
  Object.values(D).forEach(d=>{const b=Object.values(d.by||{});d.score=b.map(x=>x.sc).sort((x,y)=>y-x).reduce((a,v,i)=>a+v*(STACK[i]??.1),0);d.wins=b.reduce((a,x)=>a+x.w,0);d.pods=b.reduce((a,x)=>a+x.p,0);delete d.by});
  STARS.forEach(o=>{const P=who("*",o.display);if(!D[P.k])D[P.k]={id:P.name,name:P.name,uuid:P.uuid.startsWith("manual:")?"":P.uuid,aliases:[],teams:o.team?[o.team]:[],wins:0,pods:0,score:0,leagues:[]}});
  const isGone=d=>REMSET.has(d.name.toLowerCase())||d.aliases.some(a=>REMSET.has(a));
  const out=Object.values(D).filter(d=>{const u=d.uuid||"";if(u)NAMEMAP.filter(n=>n.uuid===u).forEach(n=>{if(!d.aliases.includes(n.name)&&n.name!==d.name.toLowerCase())d.aliases.push(n.name)});return!isGone(d)});const tws=l=>leagueWeight(LEAGUES.find(x=>x.id===l.id)||l);
  out.forEach(d=>{const u=d.uuid||"";if(u)NAMEMAP.filter(n=>n.uuid===u&&n.name!==d.name.toLowerCase()&&!d.aliases.includes(n.name)).forEach(n=>d.aliases.push(n.name));
    d.leagues.sort((a,b)=>tws(b)-tws(a)||a.pos-b.pos);d.best_tier=d.leagues[0]?.tier||"R";d.team=d.leagues.find(l=>l.team)?.team||"Independent";
    /* admin-set team replaces whatever the standings say */
    const ov=DTEAMS.find(x=>x.name===d.name.toLowerCase()||d.aliases.includes(x.name));if(ov&&ov.team){d.team=canonTeam(ov.team);d.teams=[d.team]}});
  out.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const n=out.length,top=out[0]?.score||1,cut=[.015,.06,.13,.29,.6].map(f=>Math.max(1,Math.round(n*f)));
  out.forEach((d,i)=>{d.rank=i+1;d.tier=i<cut[0]?5:i<cut[1]?4:i<cut[2]?3:i<cut[3]?2:i<cut[4]?1:0;d.ovr=Math.max(48,Math.round(50+49*Math.sqrt(d.score/top)))});
  /* star drivers: admin-set rarity floor and OVR for elite racers with few league races */
  const star={};STARS.forEach(o=>{const P=who("*",o.display);star[P.name.toLowerCase()]=o});
  out.forEach(d=>{const o=star[d.name.toLowerCase()];if(!o)return;d.tier=Math.max(d.tier,o.min_tier);if(o.ovr)d.ovr=Math.max(d.ovr,o.ovr);if(o.team&&(!d.team||d.team==="Independent"))d.team=o.team;d.star=true});
  /* exactly MYTHIC_COUNT Mythics: the top drivers by OVR (star drivers included); anyone else drops to Legendary */
  out.sort((a,b)=>b.ovr-a.ovr||b.score-a.score);
  out.forEach((d,i)=>{if(i<MYTHIC_COUNT)d.tier=5;else if(d.tier>4)d.tier=4});
  out.sort((a,b)=>b.tier-a.tier||b.ovr-a.ovr||b.score-a.score);out.forEach((d,i)=>d.rank=i+1);
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
  const tag=o.tag||"button";const sp=o.sp;const v=sp&&sp.variant&&sp.variant!=="base"?sp.variant:"";
  const data=sp&&sp.sid?`data-special="${esc(sp.sid)}"`:`data-card="${esc(d.id)}"`;
  return `<${tag} ${tag==="button"?'type="button"':""} class="card t${d.tier}${v?" v-"+esc(v):""}" ${data} aria-label="${esc(d.name)}, ${TIERS[d.tier].name}${v?", "+esc(vinfo(v).name)+(sp.serial?" "+serialTxt(sp):""):""}">
    <span class="c-top"><span class="ovr">${v?Math.min(99,d.ovr+(+vinfo(v).ovr_boost||0)):d.ovr}${v&&+vinfo(v).ovr_boost&&d.ovr<99?`<sup class="boost">+${Math.min(99,d.ovr+(+vinfo(v).ovr_boost))-d.ovr}</sup>`:""}</span><span class="c-rar">${TIERS[d.tier].name}</span></span>
    ${face(d.name,"head")}
    <span class="c-name">${esc(d.name)}</span><span class="c-team">${esc(d.team)}</span>
    <span class="c-stats">
      ${L.map(l=>`<span><i>${l?esc(l.short):"—"}</i><b>${l?"P"+l.pos:"—"}</b></span>`).join("")}
      <span><i>WIN</i><b>${d.wins}</b></span><span><i>POD</i><b>${d.pods}</b></span>
    </span>
    ${v?`<span class="vtag"><span>${esc(vinfo(v).name)}</span>${sp.serial?`<b>${serialTxt(sp)}</b>`:""}</span>`:""}
    ${o.count>1?`<span class="cnt">×${o.count}</span>`:""}${o.isNew?`<span class="new">NEW</span>`:""}
  </${tag}>`;
}
/* ---------- pack odds (mirrors _roll / _pool / roll_variant on the server) ---------- */
function poolOf(P){
  return ALL.filter(d=>P.pool==="tierA"?d.best_tier==="A":P.pool==="team"?(d.teams||[]).includes(teamOfWeek)||d.team===teamOfWeek:P.pool==="podium"?d.pods>0:true);
}
function slotDist(P,mn,cnt){
  const w=[0,0,0,0,0,0];let tot=0;
  for(let t=0;t<6;t++)if(t>=mn&&P.w[t]>0&&cnt[t]){w[t]=P.w[t];tot+=w[t]}
  if(!tot){let t=-1;for(let i=5;i>=mn;i--)if(cnt[i]){t=i;break}if(t<0)for(let i=5;i>=0;i--)if(cnt[i]){t=i;break}if(t>=0)w[t]=tot=1}
  return w.map(x=>tot?x/tot:0);
}
let DMETER={cards:0,since:null};
const diamondMult=()=>Math.min(200,1+((+DMETER.cards||0)/1500)**2);
const vch=v=>Number(v.chance);
const VCHANCE=()=>VARIANTS.filter(v=>v.id!=="base").sort((a,b)=>(b.sort??0)-(a.sort??0));
function packOdds(P){
  const pool=poolOf(P),cnt=[0,0,0,0,0,0];pool.forEach(d=>cnt[d.tier]++);
  const g=P.guar!=null?+P.guar:null,n=P.cards;
  const normal=slotDist(P,0,cnt),last=g!=null?slotDist(P,g,cnt):normal;
  const slots=[...Array(Math.max(0,n-1)).fill(normal),last];
  const atLeast=TIERS.map((_,X)=>1-slots.reduce((m,s)=>m*(1-s.slice(X).reduce((a,b)=>a+b,0)),1));
  const exactly=TIERS.map((_,t)=>1-slots.reduce((m,s)=>m*(1-s[t]),1));
  const perDriver=TIERS.map((_,t)=>cnt[t]?1-slots.reduce((m,s)=>m*(1-s[t]/cnt[t]),1):0);
  const b=Number(P.variant_boost)||1;
  const vers=VCHANCE().map(v=>({v,card:Math.min(1,vch(v)*b),pack:1-Math.pow(1-Math.min(1,vch(v)*b),n)}));
  const anyV=1-Math.pow(1-Math.min(1,vers.reduce((a,x)=>a+x.card,0)),n);
  return{pool,cnt,normal,last,g,n,atLeast,exactly,perDriver,vers,anyV,b};
}
function pct(p){if(!p)return"—";if(p>=.995)return"100%";const x=p*100;return(x>=10?x.toFixed(0):x>=1?x.toFixed(1):x>=.1?x.toFixed(2):x.toFixed(3))+"%"}
function oneIn(p){if(!p)return"—";if(p>=.5)return pct(p);const k=1/p;return"1 in "+(k<10?k.toFixed(1):fmt(Math.round(k)))}
function oddsHTML(P){const O=packOdds(P);
  return `<div class="odds">${[2,3,4,5].map(t=>O.cnt[t]&&O.atLeast[t]>0&&O.atLeast[t]<.995?`<span style="--tc:var(--t${t})">${TIER_SHORT[t]}${t<5?"+":""} ${oneIn(O.atLeast[t])}</span>`:"").join("")}</div>
  <button class="linkbtn" data-act="odds" data-type="${esc(P.id)}">Full odds per pack →</button>`}
function showOdds(id){
  const P=PACKS[id];if(!P)return;const O=packOdds(P);
  const poolTxt=P.pool==="tierA"?"Only drivers who race in a Tier A league":P.pool==="team"?`Only ${teamOfWeek||"this week's team"} drivers (rotates every Monday)`:P.pool==="podium"?"Only drivers with at least one podium":"Every driver in the pool";
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(P.name)} odds"><div class="sheet" style="width:min(640px,100%)">
    <div class="sheet-head"><h2 style="font-size:22px">${esc(P.name)} odds</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <p class="muted" style="margin:0 0 12px;font-size:14px">${P.pick_one?`You see ${O.n} cards and keep 1. `:`${O.n} cards. `}${poolTxt} (${O.pool.length} drivers).${O.g!=null?` The last card is always ${TIERS[O.g].name} or better.`:""}</p>
    <h3 style="font-size:16px;margin:0 0 6px">Rarity</h3>
    <div class="tablewrap"><table class="oddst"><thead><tr><th>Rarity</th><th class="r">Card</th>${O.g!=null?`<th class="r">Last</th>`:""}<th class="r">Pack</th><th class="r">1 driver</th></tr></thead><tbody>
    ${TIERS.map((T,t)=>O.cnt[t]&&O.exactly[t]>0?`<tr><td><span class="tpill" style="--tc:var(--t${t})">${TIER_SHORT[t]}</span><span class="hide-sm"> ${T.name}</span> <span class="muted num" style="font-size:12px">${O.cnt[t]}</span></td><td class="r num">${pct(O.normal[t])}</td>${O.g!=null?`<td class="r num">${pct(O.last[t])}</td>`:""}<td class="r num">${oneIn(O.exactly[t])}</td><td class="r num">${oneIn(O.perDriver[t])}</td></tr>`:"").join("")}
    </tbody></table></div>
    <p class="muted" style="font-size:12px;margin:6px 0 14px"><b>Card</b>: each card${O.g!=null?" (except the last)":""}. ${O.g!=null?"<b>Last</b>: the guaranteed last card. ":""}<b>Pack</b>: at least one of that rarity in the whole pack${P.pick_one?" (so it's there for you to pick)":""}. <b>1 driver</b>: one specific driver of that rarity, e.g. one particular Mythic. The number next to each rarity is how many drivers it has.</p>
    <h3 style="font-size:16px;margin:0 0 6px">Card versions${O.b>1?` <span class="muted" style="font-size:13px">· ×${O.b} boost in this pack</span>`:""}</h3>
    <div class="tablewrap"><table class="oddst"><thead><tr><th>Version</th><th class="r">Card</th><th class="r">Pack</th></tr></thead><tbody>
    ${O.vers.map(x=>`<tr><td>${vpill(x.v.id)}</td><td class="r num">${oneIn(x.card)}</td><td class="r num">${oneIn(x.pack)}</td></tr>`).join("")}
    <tr><td><b>Any version</b></td><td></td><td class="r num"><b>${oneIn(O.anyV)}</b></td></tr>
    </tbody></table></div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Versions roll separately on every card, whatever its rarity. If every serial of a numbered version is already pulled for that driver, you get the next version down.</p>
  </div></div>`;
}
/* chance to pull one specific driver, for the card detail sheet */
function driverOdds(d){
  const rows=Object.values(PACKS).filter(P=>(P.price!=null||P.id==="daily")).sort((a,b)=>(a.sort??0)-(b.sort??0)).map(P=>{
    const O=packOdds(P);if(!O.pool.some(x=>x.id===d.id))return null;return{P,p:O.perDriver[d.tier]}}).filter(r=>r&&r.p>0);
  const n=ALL.filter(x=>x.tier===d.tier).length;
  if(!rows.length&&!n)return"";
  return`<details class="fold" style="margin-top:12px"><summary>Pull odds for ${esc(d.name)}</summary>
    <div class="tablewrap"><table class="oddst"><tbody>
    ${rows.map(r=>`<tr><td>${esc(r.P.name)}${r.P.price!=null?` <span class="muted num" style="font-size:12px">${fmt(r.P.price)}</span>`:""}</td><td class="r num">${oneIn(r.p)} packs</td></tr>`).join("")}
    ${n?`<tr><td>${TIERS[d.tier].name} from the rarity shop <span class="muted num" style="font-size:12px">${fmt(TIERS[d.tier].price)}</span></td><td class="r num">${oneIn(1/n)} buys</td></tr>`:""}
    </tbody></table></div></details>`;
}
function packOddsTable(){
  const ps=Object.values(PACKS).filter(P=>P.price!=null||["daily","starter","gold","silver"].includes(P.id)).sort((a,b)=>(a.sort??0)-(b.sort??0));
  if(!ps.length)return"";
  return`<section class="block"><div class="sec-head"><h2>Pack odds</h2><p>Chance of getting at least one card of that rarity or better from one pack. Tap a pack for the full breakdown.</p></div>
    <div class="tablewrap"><table class="oddst"><thead><tr><th>Pack</th><th class="r">Epic+</th><th class="r">Leg+</th><th class="r">Mythic</th><th class="r hide-sm">Any version</th></tr></thead><tbody>
    ${ps.map(P=>{const O=packOdds(P);return`<tr class="click" data-act="odds" data-type="${esc(P.id)}"><td>${esc(P.name)}</td><td class="r num">${oneIn(O.atLeast[3])}</td><td class="r num">${oneIn(O.atLeast[4])}</td><td class="r num">${oneIn(O.atLeast[5])}</td><td class="r num hide-sm">${oneIn(O.anyV)}</td></tr>`}).join("")}
    </tbody></table></div></section>`;
}
function packTile(id,{count=0,action}={}){
  const P=PACKS[id];if(!P)return"";
  return`<article class="pack" style="--pc1:${esc(P.c[0])};--pc2:${esc(P.c[1])}">
    <div class="pack-art">${count?`<span class="cnt-badge">×${count}</span>`:""}<h3>${esc(P.name)}</h3></div>
    <div class="pack-body"><p>${esc(id==="team"?`${teamOfWeek||"No team"} only. Rotates every Monday (UTC).`:P.desc)}</p>
      <p class="num" style="font-size:13px">${P.pick_one?`Pick 1 of ${P.cards}`:`${P.cards} cards`}${P.guar!=null?` · ${TIERS[P.guar].name}+ guaranteed`:""}${Number(P.variant_boost)>1?` · <b style="color:var(--ink)">×${Number(P.variant_boost)} Holo &amp; numbered odds</b>`:""}</p>${oddsHTML(P)}
      <div class="pack-foot">${action}</div></div></article>`;
}
function renderWallet(){
  const packs=Object.values(myPacks).reduce((a,b)=>a+b,0);
  $("#wallet").innerHTML=!sb?"":!signedIn()?`<button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button>`:
    `<span class="chip" title="Tokens"><span class="coin"></span><b>${fmt(me.coins)}</b></span>
     <span class="chip hide-sm">Packs <b>${packs}</b></span><span class="chip hide-sm">Cards <b>${ownedIds().size}/${ALL.length}</b></span>
     <button class="chip bell" data-act="notices" aria-label="Notifications">🔔${NOTICES.some(n=>!n.seen)?`<b class="bell-n">${NOTICES.filter(n=>!n.seen).length}</b>`:""}</button>
     <button class="me-btn" data-act="account" aria-label="Your account">${me.avatar_url?`<img src="${esc(me.avatar_url)}" alt="">`:`<span class="me-ph">${esc((me.ign||me.discord_name||"?")[0])}</span>`}<b class="hide-sm">${esc(me.ign||me.discord_name)}</b></button>`;
  const pendingRewards=signedIn()&&myIgn()&&(races.some(r=>myResult(r)&&!myRaceClaims[r.id])||tracks.some(t=>trackDue(t)>0));
  document.querySelectorAll("#tabs a").forEach(a=>{a.setAttribute("aria-current",a.dataset.tab===tab?"page":"false");
    a.querySelector(".dot")?.remove();
    if((a.dataset.tab==="races"&&pendingRewards)||(a.dataset.tab==="packs"&&dailyReady())||(a.dataset.tab==="admin"&&(ignReqs.some(r=>r.status==="pending")||BUGS.some(b=>b.status==="open"))))
      a.insertAdjacentHTML("beforeend",'<span class="dot" aria-label="needs attention"></span>')});
  $("#adminTab").hidden=!isAdmin();
}
function banner(){
  if(!ALL.length)return`<div class="banner"><strong>No standings loaded yet.</strong> ${isAdmin()?"Import a league in League admin to fill the card pool.":"The league admin hasn't imported any standings yet."}</div>`;
  if(!signedIn())return`<section class="hero"><div><span class="eyebrow">Minecraft iceboat racing</span><h2>Collect the drivers. Earn packs on the ice.</h2>
    <p>Every card is a real racer, ranked from FrostHex, IceDrifters, BoatLabs and IBR results. Open packs, trade on the auction house, and claim rewards for your own race finishes and track times.</p>
    <div class="row" style="gap:10px;flex-wrap:wrap"><button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button><a class="btn ghost" href="#help">How it works</a></div></div>
    <div class="hero-cards">${ALL.slice(0,3).map(d=>cardHTML(d)).join("")}</div></section>`;
  return"";
}
function vPacks(){
  const done=signedIn()&&!dailyReady();const st=signedIn()&&me.last_daily_at&&Date.now()-Date.parse(me.last_daily_at)<1728e5?me.streak:0;
  const midnight=new Date(dailyNext());
  const inv=Object.entries(myPacks).filter(([t,n])=>n>0&&PACKS[t]);
  const store=Object.values(PACKS).filter(p=>p.price!=null&&!p.special),special=Object.values(PACKS).filter(p=>p.price!=null&&p.special);
  const cant=p=>!signedIn()?"":me.coins<p.price?"disabled":"";
  return`${banner()}${pickBanner()}
  <section class="block"><div class="daily">
    <div><span class="eyebrow">Daily drop</span><h3>${done?"Today's pack is claimed":"Your Daily Pack is ready"}</h3>
      <p>${done?`Next pack in <span class="num" data-until="${midnight.getTime()}">${dur(midnight-Date.now())}</span>, 24 hours after your last claim.`:"Claim one free pack every 24 hours. Claim again within 48 hours to keep your streak. Tokens come from races, BoatLabs times, quick-selling and auctions."}</p>
      ${st>1?`<p class="num" style="margin:8px 0 0;font-size:13px;color:var(--ink)">${st}-day streak</p>`:""}</div>
    <button class="btn" data-act="daily" ${done?"disabled":""}>${done?"Claimed":"Claim daily"}</button></div></section>
  ${signedIn()?`<section class="block"><div class="sec-head"><h2>Your packs</h2><p>Packs from daily drops, race rewards and your welcome kit wait here until you open them.</p></div>
    ${inv.length?`<div class="packs">${inv.map(([t,n])=>packTile(t,{count:n,action:`<span class="muted" style="font-size:13px">Ready</span><button class="btn" data-act="open" data-type="${esc(t)}">Open</button>`})).join("")}</div>`
      :`<div class="empty"><b>No unopened packs</b>Claim your daily pack, buy one below, or finish on the podium in a race.</div>`}</section>`:""}
  <section class="block"><div class="sec-head"><h2>Pack store</h2><p>Buy and open on the spot.</p></div>
    <div class="packs">${store.map(p=>packTile(p.id,{action:`<span class="price"><span class="coin"></span>${fmt(p.price)}</span><button class="btn" data-act="buy" data-type="${esc(p.id)}" ${cant(p)}>Buy & open</button>`})).join("")}</div></section>
  <section class="block"><div class="sec-head"><h2>Special packs</h2><p>Narrow pools with better floors. You see every card, then keep just one. The Team Pack changes every week.</p></div>
    <div class="packs">${special.map(p=>packTile(p.id,{action:`<span class="price"><span class="coin"></span>${fmt(p.price)}</span><button class="btn" data-act="buy" data-type="${esc(p.id)}" ${cant(p)}>Buy & open</button>`})).join("")}</div>
    <p class="muted" style="font-size:13px;margin:12px 0 0">Any card can come out as a Holo or numbered version. The numbers on each pack are your chance per pack. <a href="#help">See all pack odds</a>.</p></section>`;
}
function variantsInfo(){
  const vs=VARIANTS.filter(v=>v.id!=="base");if(!vs.length)return"";
  const ex=ALL[0];
  return`<section class="block"><div class="sec-head"><h2>Card versions</h2><p>Every card you pull can come out as a special version, in any pack or shop buy. Special versions also raise the driver's OVR on that card, up to 99. Numbered versions have a fixed print run per driver. Once all the serials are pulled, that version of that driver is gone for good.</p></div>
    ${ex?`<div class="grid" style="margin-bottom:14px">${vs.map((v,i)=>cardHTML(ex,{tag:"div",sp:{variant:v.id,serial:v.print_run?Math.min(v.print_run,[1,7,3,2,1,1][i]||1):null,print_run:v.print_run}})).join("")}</div>`:""}
    <div class="tablewrap"><table class="oddst"><thead><tr><th>Version</th><th class="r">Run</th><th class="r">OVR</th><th class="r">Per card</th><th class="r hide-sm">Quick-sell</th></tr></thead><tbody>
    ${vs.map(v=>`<tr><td>${vpill(v.id)}</td><td class="r num">${v.print_run?(v.print_run===1?"1/1":"/"+v.print_run):"∞"}</td><td class="r num">+${+v.ovr_boost||0}</td><td class="r num">${oneIn(vch(v))}</td><td class="r num hide-sm">×${Number(v.sell_mult)}</td></tr>`).join("")}
    </tbody></table></div><p class="muted" style="font-size:13px">Some packs multiply these chances. It says so on the pack. Diamond 1/1s are always a Legendary or Mythic driver: a Diamond on any card turns into a top driver's 1/1.</p></section>`;
}
/* ---------- sets, trade-in, showcase ---------- */
const NO_TEAM=["","Independent","No Team"];
function teamSets(){
  const by={};ALL.forEach(d=>{const ts=(d.teams&&d.teams.length?d.teams:[d.team]).map(t=>String(t||"").trim());
    [...new Set(ts)].forEach(t=>{if(NO_TEAM.includes(t))return;(by[t]=by[t]||[]).push(d)})});
  return Object.entries(by).filter(([,m])=>m.length>=SET_MIN).map(([team,m])=>({team,m:m.sort((a,b)=>b.tier-a.tier||b.ovr-a.ovr),
    reward:Math.round(m.reduce((s,d)=>s+TIERS[d.tier].sell,0)*1.5/10)*10}));
}
function spareDupes(t){return owned().reduce((s,[id,n])=>s+(card(id).tier===t&&n>1?n-1:0),0)}
function vSets(){
  if(!signedIn())return"";
  const ids=ownedIds();
  const sets=teamSets().map(S=>({...S,have:S.m.filter(d=>ids.has(d.id)).length,claimed:mySets["team:"+S.team]!=null}))
    .sort((a,b)=>(b.have===b.m.length&&!b.claimed)-(a.have===a.m.length&&!a.claimed)||a.claimed-b.claimed||b.have/b.m.length-a.have/a.m.length||a.team.localeCompare(b.team));
  const done=sets.filter(S=>S.claimed).length;
  return`<section class="block"><div class="sec-head"><h2>Trade in duplicates</h2><p>Turn spare copies of one rarity into a random card of the next rarity up. Higher rarities cost more duplicates. Your last copy of each driver is always kept, and only base cards count.</p></div>
    <div class="panel list-rows">${TIERS.slice(0,5).map((T,t)=>{const n=spareDupes(t);return`<div class="lrow">
      <span><span class="tpill" style="--tc:var(--t${t})">${T.name}</span> → <span class="tpill" style="--tc:var(--t${t+1})">${TIERS[t+1].name}</span></span><span class="muted num lrow-sub">${n} spare · needs ${TRADE_COST[t]}</span>
      <span></span><button class="btn sm" data-act="tradein" data-tier="${t}" ${n<TRADE_COST[t]?"disabled":""}>Trade ${TRADE_COST[t]}</button></div>`}).join("")}</div></section>
  <section class="block"><div class="sec-head"><h2>Team sets</h2><p>Own every driver on a team (any version counts) to claim a one-time token reward. Teams need 5+ drivers this season to have a set, and a driver who races for two teams counts for both. ${done} of ${sets.length} sets claimed.</p></div>
    <div class="races">${sets.slice(0,view.setsAll?99:12).map(S=>{const full=S.have===S.m.length;return`<article class="race"><div><span class="eyebrow">${S.have}/${S.m.length} drivers · +${fmt(S.reward)} tokens</span><h3>${esc(S.team)}</h3></div>
      <div class="meter"><i style="width:${(S.have/S.m.length*100).toFixed(0)}%"></i></div>
      <ol>${S.m.map(d=>`<li class="${ids.has(d.id)?"me":""}" style="${ids.has(d.id)?"":"opacity:.55"}" data-card="${esc(d.id)}"><span class="p" style="color:var(--t${d.tier})">${TIER_SHORT[d.tier]}</span>${face(d.name)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</span>${ids.has(d.id)?"✓":auctions.some(a=>!isEnded(a)&&a.card_id===d.id)?'<a href="#auctions" class="tag need" style="text-decoration:none">On auction</a>':""}</li>`).join("")}</ol>
      ${S.claimed?`<span class="tag lead" style="align-self:flex-start">Claimed</span>`:full?`<button class="btn" data-act="claimset" data-id="${esc(S.team)}">Claim +${fmt(S.reward)} tokens</button>`:""}
    </article>`}).join("")}</div>${sets.length>12?`<div class="more"><button class="btn ghost" data-act="setsall">${view.setsAll?"Show fewer sets":`Show all ${sets.length} sets`}</button></div>`:""}</section>`;
}
const showcaseOf=p=>Array.isArray(p?.showcase)?p.showcase:[];
const pinned=(k,id)=>showcaseOf(me).some(x=>x.k===k&&String(x.id)===String(id));
function showcaseCards(p){
  return showcaseOf(p).map(x=>{if(x.k==="s"){const s=SPECIALS.find(y=>String(y.id)===String(x.id)&&y.owner===p.id&&y.status!=="retired");return s?{d:card(s.card_id),sp:spOf(s)}:null}
    return BY_ID[x.id]?{d:card(x.id),sp:null}:null}).filter(Boolean);
}
async function togglePin(k,id){
  if(!guard())return;let cur=showcaseOf(me).filter(x=>!(x.k===k&&String(x.id)===String(id)));
  if(cur.length===showcaseOf(me).length){if(cur.length>=3)return toast("Your showcase holds 3 cards. Unpin one first.");cur=[...cur,{k,id}]}
  const r=await act("set_showcase",{p_items:cur});if(r!=null){await loadPeople();toast("Showcase updated");closeOverlay();render()}
}
/* price history */
const salesOf=(id,variant)=>SALES.filter(x=>x.card_id===id&&(variant==null||x.variant===variant));
function lastSale(id,variant){const s=salesOf(id,variant||"base")[0];return s?s.price:null}
function salesTable(id){
  const list=salesOf(id).slice(0,8);if(!list.length)return`<p class="muted" style="font-size:14px;margin:12px 0 0">No auction sales yet.</p>`;
  const base=salesOf(id,"base");const avg=base.length?Math.round(base.slice(0,10).reduce((a,x)=>a+x.price,0)/Math.min(base.length,10)):null;
  return`<h3 style="font-size:16px;margin:14px 0 6px">Recent sales${avg?` <span class="muted num" style="font-size:13px">· base avg ${fmt(avg)}</span>`:""}</h3>
    <div class="tablewrap"><table><tbody>${list.map(x=>`<tr><td>${x.variant&&x.variant!=="base"?vpill(x.variant,x):'<span class="muted">Base</span>'}</td><td class="r num">${fmt(x.price)}</td><td class="muted" style="font-size:13px">${ago(x.at)}</td></tr>`).join("")}</tbody></table></div>`;
}
/* sets a card would help finish */
const SET_MIN=5;const TRADE_COST=[5,5,6,8,10];let setsCache={k:null,v:null};
function setsByTeam(){const k=ALL.length;if(setsCache.k!==k)setsCache={k,v:Object.fromEntries(teamSets().map(S=>[S.team,S]))};return setsCache.v}
function neededFor(id){
  const d=BY_ID[id];if(!d||ownedIds().has(id))return null;const ids=ownedIds();
  const opts=Object.values(setsByTeam()).filter(S=>mySets["team:"+S.team]==null&&S.m.some(x=>x.id===id))
    .map(S=>({team:S.team,have:S.m.filter(x=>ids.has(x.id)).length,of:S.m.length})).sort((a,b)=>b.have/b.of-a.have/a.of);
  return opts[0]||null;
}
/* badges */
function badgesOf(p){
  const sp=SPECIALS.filter(x=>x.owner===p.id&&x.status!=="retired"),num=sp.filter(x=>x.serial).length;
  const byUser=allCards.filter(c=>c.user_id===p.id&&c.qty>0).map(c=>c.card_id);const ids=new Set([...byUser,...sp.map(x=>x.card_id)]);
  const sets=allSetClaims.filter(x=>x.user_id===p.id).length,myth=ALL.filter(d=>d.tier===5);
  const b=[];
  if(sp.some(x=>x.variant==="diamond"))b.push(["One of One","Owns a Diamond 1/1"]);
  if(num>=10)b.push(["Numbered x10","Owns 10+ numbered cards"]);else if(num>=3)b.push(["Numbered","Owns 3+ numbered cards"]);
  if(sets>=10)b.push(["Set Master","Finished 10+ team sets"]);else if(sets>=3)b.push(["Set Collector","Finished 3+ team sets"]);
  if(myth.length&&myth.every(d=>ids.has(d.id)))b.push(["Mythic Hunter","Owns every Mythic driver"]);
  if(ids.size>=200)b.push(["Encyclopedia","Owns 200+ drivers"]);else if(ids.size>=100)b.push(["Centurion","Owns 100+ drivers"]);
  if(p.ign&&BY_ID[p.ign]||ALL.some(d=>d.name.toLowerCase()===String(p.ign||"").toLowerCase()))b.push(["On the Grid","Has their own card in the pool"]);
  return b;
}
const badgeHTML=p=>badgesOf(p).map(([n,t])=>`<span class="badge" title="${esc(t)}">${esc(n)}</span>`).join("");
/* notifications */
function showAccount(){
  const packs=Object.values(myPacks).reduce((a,b)=>a+b,0);const name=me.ign||me.discord_name;
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Your account"><div class="sheet" style="width:min(420px,100%)">
    <div class="sheet-head"><h2 style="font-size:20px;display:flex;align-items:center;gap:10px">${me.avatar_url?`<img src="${esc(me.avatar_url)}" alt="" style="width:32px;height:32px;border-radius:50%">`:""}${esc(name)}</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <div class="acct">
      <div><span>Tokens</span><b class="num">${fmt(me.coins)}</b></div>
      <div><span>Unopened packs</span><b class="num">${packs}</b></div>
      <div><span>Drivers collected</span><b class="num">${ownedIds().size}/${ALL.length}</b></div>
      <div><span>Minecraft IGN</span><b>${me.ign?esc(me.ign):'<a href="#races" data-act="close">Add yours</a>'}</b></div>
      <div><span>Discord</span><b>${esc(me.discord_handle||me.discord_name)}</b></div>
      <div><span>Next Daily Pack</span><b>${dailyReady()?"Ready now":new Date(dailyNext()).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}</b></div>
    </div>
    <div class="row" style="margin-top:14px"><a class="btn ghost" href="#player/${encodeURIComponent(name)}" data-act="close">View my profile</a><button class="btn ghost" data-act="bug">Report a bug</button><button class="btn ghost" data-act="signout">Sign out</button></div>
  </div></div>`;
}
function showNotices(){
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Notifications"><div class="sheet" style="width:min(560px,100%)">
    <div class="sheet-head"><h2 style="font-size:22px">Notifications</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    ${NOTICES.length?`<ul class="notices">${NOTICES.map(n=>`<li class="${n.seen?"":"unseen"}"><a href="${esc(n.link||"#packs")}" data-act="close">${esc(n.body)}</a><span class="muted" style="font-size:12px">${ago(n.at)}</span></li>`).join("")}</ul>`
      :`<p class="muted">Nothing yet. You'll see it here when you're outbid, win an auction or sell a card.</p>`}</div></div>`;
  if(NOTICES.some(n=>!n.seen)){rpc("mark_notices_seen").then(()=>{NOTICES.forEach(n=>n.seen=true);renderWallet()}).catch(()=>{})}
}
function vShop(){
  const can=t=>!signedIn()||me.coins>=TIERS[t].price;
  return`<section class="block"><div class="sec-head"><h2>Rarity shop</h2><p>Pick a rarity and get a random driver from it.</p></div>
    <div class="panel list-rows">${TIERS.map((T,t)=>{const n=ALL.filter(d=>d.tier===t).length;return`<div class="lrow">
      <span class="tpill" style="--tc:var(--t${t})">${T.name}</span><span class="muted lrow-sub">${n} drivers · sells for ${fmt(T.sell)}</span>
      <span class="price"><span class="coin"></span>${fmt(T.price)}</span><button class="btn sm" data-act="tier" data-tier="${t}" ${!n||!can(t)?"disabled":""}>Buy</button></div>`}).join("")}</div></section>
  <section class="block">${bigPulls(4)}<p style="margin:8px 0 0;font-size:13px"><a href="#rankings/pulls">See all big pulls</a></p></section>`;
}
function vCollection(){
  if(!signedIn())return"";
  const top=seg("colSub",[["cards","Cards"],["sets","Sets &amp; trade-ins"]],"collection");
  if(view.colSub==="sets")return`<div class="block" style="padding-bottom:0">${top}</div>${vSets()}`;
  return`<div class="block" style="padding-bottom:0">${top}</div>${vCards()}`;
}
function vCards(){
  let list=owned().map(([id,n])=>({d:card(id),n}));
  if(view.colTier>=0)list=list.filter(x=>x.d.tier===view.colTier);
  list.sort(view.colSort==="name"?(a,b)=>a.d.name.localeCompare(b.d.name):view.colSort==="count"?(a,b)=>b.n-a.n:(a,b)=>b.d.tier-a.d.tier||b.d.ovr-a.d.ovr);
  const ids=ownedIds(),uniq=ids.size,pct=ALL.length?uniq/ALL.length*100:0,val=collectionValue(myCards,session?.user.id);
  const perTier=TIERS.map((_,t)=>[[...ids].filter(id=>card(id).tier===t).length,ALL.filter(d=>d.tier===t).length]);
  let sps=mySpecials();if(view.colTier>=0)sps=sps.filter(x=>card(x.card_id).tier===view.colTier);
  sps.sort((a,b)=>vinfo(b.variant).sort-vinfo(a.variant).sort||card(b.card_id).tier-card(a.card_id).tier||(a.serial||0)-(b.serial||0));
  return`<section class="block"><div class="sec-head"><h2>Collection</h2><p>${fmt(uniq)} of ${fmt(ALL.length)} drivers · quick-sell value <span class="num">${fmt(val)}</span> tokens. Tap a card to sell it or list it.</p></div>
    <div class="meter" style="margin-bottom:14px"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="panel" style="margin-bottom:16px"><b style="font-family:var(--f-display)">Your showcase</b> <span class="muted" style="font-size:14px">Up to 3 cards shown next to your name on Top collectors. Tap a card, then "Pin to showcase".</span>
      ${showcaseCards(me).length?`<div class="grid mini" style="margin-top:10px">${showcaseCards(me).map(x=>cardHTML(x.d,{sp:x.sp})).join("")}</div>`:""}</div>
    <div class="filters"><button class="fchip" data-act="coltier" data-tier="-1" aria-pressed="${view.colTier<0}">All</button>
      ${TIERS.map((T,t)=>`<button class="fchip" style="--tc:var(--t${t})" data-act="coltier" data-tier="${t}" aria-pressed="${view.colTier===t}"><span class="sw"></span>${T.name} <span class="num">${perTier[t][0]}/${perTier[t][1]}</span></button>`).join("")}
      <span style="margin-left:auto"></span><label class="muted" style="font-size:13px" for="colSort">Sort</label>
      <select id="colSort" data-act="colsort"><option value="tier" ${view.colSort==="tier"?"selected":""}>Rarity</option><option value="name" ${view.colSort==="name"?"selected":""}>Name</option><option value="count" ${view.colSort==="count"?"selected":""}>Duplicates</option></select></div>
    ${sps.length?`<h3 style="font-size:17px;margin:4px 0 10px">Holo &amp; numbered <span class="muted num" style="font-size:14px">${sps.length}</span></h3>
      <div class="grid" style="margin-bottom:22px">${sps.slice(0,view.spN).map(x=>cardHTML(card(x.card_id),{sp:spOf(x)})).join("")}${sps.length>view.spN?`</div><div class="more" style="margin-bottom:22px"><button class="btn ghost" data-act="morespecial">Show more</button><span class="muted">${view.spN} of ${sps.length}</span></div><div>`:""}</div><h3 style="font-size:17px;margin:4px 0 10px">Base cards</h3>`:""}
    ${list.length?`<div class="grid">${list.slice(0,view.colN).map(x=>cardHTML(x.d,{count:x.n})).join("")}</div>${list.length>view.colN?`<div class="more"><button class="btn ghost" data-act="morecards">Show more</button><span class="muted">${view.colN} of ${list.length}</span></div>`:""}`:`<div class="empty"><b>${sps.length?"No base cards here":"Nothing here yet"}</b>Open a pack to add drivers.</div>`}</section>`;
}
const isEnded=a=>a.status!=="open"||Date.now()>=new Date(a.ends_at).getTime();
const minBid=a=>a.high_bid?Math.max(a.high_bid+1,Math.ceil(a.high_bid*1.05)):a.start_bid;
function vAuctions(){
  const uid=session?.user.id;const SPB=Object.fromEntries(SPECIALS.map(x=>[x.id,x]));
  let live=auctions.filter(a=>!isEnded(a)).sort((a,b)=>new Date(a.ends_at)-new Date(b.ends_at));
  const needN=live.filter(a=>neededFor(a.card_id)).length;if(view.aucNeed)live=live.filter(a=>neededFor(a.card_id));
  const recent=auctions.filter(a=>a.status==="sold").sort((a,b)=>new Date(b.settled_at)-new Date(a.settled_at)).slice(0,8);
  const lot=a=>{const d=card(a.card_id);const ends=new Date(a.ends_at).getTime();const lead=a.high_bidder===uid,own=a.seller===uid;const sp=a.special_id&&SPB[a.special_id];
    return`<article class="lot">${cardHTML(d,{sp:sp?spOf(sp):null})}<div class="lot-info">${sp?`<div>${vpill(sp.variant,sp)}</div>`:""}
      <div style="display:flex;gap:6px;flex-wrap:wrap">${own?'<span class="tag">Your listing</span>':""}${lead?'<span class="tag lead">You lead</span>':""}${(()=>{const n=neededFor(a.card_id);return n?`<span class="tag need">Needed for ${esc(n.team)} set (${n.have}/${n.of})</span>`:""})()}</div>
      ${(()=>{const ls=lastSale(a.card_id,sp?sp.variant:"base");return ls!=null?`<div class="kv"><span>Last sold</span><b>${fmt(ls)}</b></div>`:""})()}
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
  return`${banner()}<section class="block"><div class="sec-head"><h2>Auction house</h2><p>Your bid is held until someone outbids you, then it comes straight back. Sellers pay a ${AUCTION_FEE*100}% fee. Bids in the last 30 seconds extend the timer. List a card from your Collection.${signedIn()&&!myIgn()?` <b style="color:var(--ink)">You need an approved IGN to bid or sell. <a href="#races">Submit yours on Rewards</a>.</b>`:""}</p></div>
    ${needN||view.aucNeed?`<div class="filters"><button class="fchip" data-act="aucneed" aria-pressed="${!!view.aucNeed}">Needed for my sets <span class="num">${needN}</span></button></div>`:""}
    ${live.length?`<div class="auctions">${live.map(lot).join("")}</div>`:`<div class="empty"><b>No live auctions</b>Open your Collection, pick a card and choose “List on auction”.</div>`}</section>
    ${recent.length?`<section class="block"><div class="sec-head"><h2>Recent sales</h2></div><div class="tablewrap"><table><thead><tr><th>Card</th><th>Rarity</th><th class="r">Price</th><th>Buyer</th></tr></thead><tbody>
      ${recent.map(a=>{const d=card(a.card_id);return`<tr data-card="${esc(d.id)}" style="cursor:pointer"><td>${face(d.name)}${esc(d.name)} ${a.special_id&&SPB[a.special_id]?vpill(SPB[a.special_id].variant,SPB[a.special_id]):""}</td><td><span class="tpill" style="--tc:var(--t${d.tier})">${TIERS[d.tier].name}</span></td><td class="r num">${fmt(a.high_bid)}</td><td>${esc(pname(a.high_bidder))}</td></tr>`}).join("")}</tbody></table></div></section>`:""}`;
}
function myResult(r){if(!myIgn())return null;const N=myNames();return(r.results||[]).filter(x=>N.has(String(x.mc).toLowerCase())).sort((a,b)=>a.pos-b.pos)[0]||null}
function myTrackPos(t){if(!myIgn())return 0;const N=myNames();const x=(t.top||[]).filter(y=>N.has(String(y.mc).toLowerCase())).sort((a,b)=>a.pos-b.pos)[0];return x?x.pos:0}
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
  else h+=g?`<details style="margin-top:8px"><summary class="muted" style="font-size:14px;cursor:pointer">Changed your Minecraft name?</summary>${form("New IGN","",true)}</details>`:form("Your Minecraft IGN","")+note;
  return h;
}
function vRaces(){
  const pending=races.filter(r=>myResult(r)&&!myRaceClaims[r.id]);const pendT=tracks.filter(t=>trackDue(t)>0);
  const shorts=[...new Set(races.map(r=>r.league).filter(Boolean))].sort((a,b)=>{const ta=(races.find(r=>r.league===a)||{}).tier,tb=(races.find(r=>r.league===b)||{}).tier;return"ABCR".indexOf(ta)-"ABCR".indexOf(tb)||a.localeCompare(b)});
  let list=[...races].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.league).localeCompare(String(b.league)));
  if(view.raceLeague==="mine")list=list.filter(r=>myResult(r));else if(view.raceLeague!=="all")list=list.filter(r=>r.league===view.raceLeague);
  const total=pending.reduce((s,r)=>s+raceReward(myResult(r).pos,r.tier,r.league),0)+pendT.reduce((s,t)=>s+trackDue(t),0);
  const g=myIgn();
  let tl=[...tracks];if(view.trackMine)tl=tl.filter(t=>myTrackPos(t));if(view.trackQ)tl=tl.filter(t=>t.name.toLowerCase().includes(view.trackQ.toLowerCase()));
  tl.sort((a,b)=>(myTrackPos(a)||99)-(myTrackPos(b)||99)||a.name.localeCompare(b.name));
  const shownT=tl.slice(0,view.trackQ?60:view.trackN);
  return`${banner()}<section class="block two">
    <div class="panel"><span class="eyebrow">Your racer</span><h3 style="font-size:20px;margin:4px 0 8px">${signedIn()?esc(g||me.discord_name):"Not signed in"}</h3>
      ${ignPanel()}
      ${g&&(pending.length||pendT.length)?`<button class="btn" data-act="claimall" style="margin-top:12px">Claim everything · +${fmt(total)} tokens</button>`:""}
    </div>
    <div class="panel"><span class="eyebrow">Tokens per race</span>
      <div class="tablewrap" style="margin-top:10px"><table class="oddst"><thead><tr><th>Finish</th><th>Pack</th>${["A","B","C","R"].map(t=>`<th class="r"><span class="hide-sm">Tier </span>${t}</th>`).join("")}</tr></thead><tbody>
      ${[[1,"P1"],[2,"P2"],[3,"P3"],[4,"P4"],[10,"P10"],[15,"P11–15"],[20,"P16–20"],[21,"P21+"]].map(([p,l])=>`<tr><td>${l}</td><td>${racePack(p)?esc((PACKS[racePack(p)]?.name||"").replace(" Pack","").replace(" Race","")):"—"}</td>${["A","B","C","R"].map(t=>`<td class="r num">${fmt(raceReward(p,t))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div><p class="muted" style="font-size:13px;margin:8px 0 0">Within a tier, lower-ranked leagues pay 10% less per step (Tier A: IDA, then FC1, then IBR).</p></div></section>
  <section class="block"><div class="sec-head"><h2>Race results</h2><p>Tokens scale with the league tier. Claim once per race.</p></div>
    <div class="filters"><button class="fchip" data-act="raceleague" data-l="all" aria-pressed="${view.raceLeague==="all"}">All</button>
      ${g?`<button class="fchip" data-act="raceleague" data-l="mine" aria-pressed="${view.raceLeague==="mine"}">My races</button>`:""}
      ${shorts.map(l=>`<button class="fchip" data-act="raceleague" data-l="${esc(l)}" aria-pressed="${view.raceLeague===l}">${esc(l)}</button>`).join("")}</div>
    ${list.length?`<div class="races">${list.slice(0,view.raceN).map(r=>{const res=myResult(r),claimed=myRaceClaims[r.id];const shown=(r.results||[]).slice(0,3);
      return`<article class="race"><div><span class="eyebrow">${esc(r.league||"Race")} · Tier ${esc(r.tier)} · ${esc(r.date||"")}</span><h3>${esc(r.name)}</h3></div>
        <ol>${shown.map(x=>`<li class="${res&&x.pos===res.pos?"me":""}"><span class="p">P${x.pos}</span>${face(x.mc)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.mc)}</span>${x.pts!=null?`<span class="num muted" style="font-size:12px">${x.pts} pts</span>`:""}</li>`).join("")}
        ${res&&res.pos>3?`<li class="me"><span class="p">P${res.pos}</span>${face(res.mc)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(res.mc)}</span></li>`:""}
        ${(r.results||[]).length>3?`<li><details><summary class="muted">All ${r.results.length} finishers</summary><ol class="full">${r.results.slice(3).map(x=>`<li class="${res&&x.pos===res.pos?"me":""}"><span class="p">P${x.pos}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.mc)}</span>${x.pts!=null?`<span class="num muted" style="font-size:12px">${x.pts} pts</span>`:""}</li>`).join("")}</ol></details></li>`:""}</ol>
        ${res?(claimed?`<span class="tag lead" style="align-self:flex-start">Claimed P${res.pos}</span>`:`<button class="btn" data-act="claim" data-id="${esc(r.id)}">Claim P${res.pos} · +${fmt(raceReward(res.pos,r.tier,r.league))} tokens</button>`):""}
      </article>`}).join("")}</div>${list.length>view.raceN?`<div class="more"><button class="btn ghost" data-act="moreraces">Show more races</button><span class="muted">${Math.min(view.raceN,list.length)} of ${list.length}</span></div>`:""}`:`<div class="empty"><b>No races here yet</b>When results are posted, rewards show up here.</div>`}</section>
  <section class="block"><div class="sec-head"><h2>BoatLabs track times</h2><p>A top-20 time pays ${fmt(trackReward(1))} tokens for P1 down to ${fmt(trackReward(20))} for P16–20. Move up later and you collect the difference. Every BoatLabs track is rechecked about every 3–4 hours, so a new time shows up here within a few hours. ${tracks.length} tracks listed.</p></div>
    <div class="filters"><input type="text" id="trackQ" data-act="trackq" placeholder="Search tracks" value="${esc(view.trackQ)}" aria-label="Search tracks">
      ${g?`<button class="fchip" data-act="trackmine" aria-pressed="${view.trackMine}">Only tracks I'm on</button>`:""}</div>
    ${shownT.length?`<div class="races">${shownT.map(t=>{const pos=myTrackPos(t),due=g?trackDue(t):0,prev=myTrackClaims[t.id];
      return`<article class="race"><div><span class="eyebrow">${esc(t.server||"BoatLabs")}</span><h3>${t.url?`<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(t.name)}</a>`:esc(t.name)}</h3></div>
        <ol>${(t.top||[]).slice(0,3).map(x=>`<li class="${pos&&x.pos===pos?"me":""}"><span class="p">P${x.pos}</span>${face(x.mc)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(x.mc)}</span><span class="num muted" style="font-size:12px">${esc(x.time)}</span></li>`).join("")}
        ${pos>3?`<li class="me"><span class="p">P${pos}</span>${face(g)}<span style="flex:1">${esc(g)}</span><span class="num muted" style="font-size:12px">${esc((t.top||[]).find(x=>x.pos===pos)?.time||"")}</span></li>`:""}</ol>
        ${pos?(due?`<button class="btn" data-act="claimtrack" data-id="${esc(t.id)}">Claim P${pos} · +${fmt(due)} tokens</button>`:prev?`<span class="tag lead" style="align-self:flex-start">Claimed P${prev}</span>`:""):""}
      </article>`}).join("")}</div>${tl.length>shownT.length?`<div class="more"><button class="btn ghost" data-act="moretracks">Show more tracks</button><span class="muted">${shownT.length} of ${tl.length}</span></div>`:""}`
      :`<div class="empty"><b>No tracks match</b>Try another search.</div>`}</section>`;
}
function collectorStats(){
  const byUser={};allCards.forEach(c=>{(byUser[c.user_id]=byUser[c.user_id]||{})[c.card_id]=c.qty});
  return profiles.map(p=>{const sp=SPECIALS.filter(x=>x.owner===p.id&&x.status!=="retired");
    return{p,uniq:new Set([...Object.entries(byUser[p.id]||{}).filter(([,n])=>n>0).map(([id])=>id),...sp.map(x=>x.card_id)]).size,
      val:collectionValue(byUser[p.id],p.id),sets:allSetClaims.filter(x=>x.user_id===p.id).length,num:sp.filter(x=>x.serial).length,sp}}).filter(c=>c.uniq);
}
function vRankings(){
  const top=seg("rankSub",[["drivers","Drivers"],["collectors","Collectors"],["valuable","Most valuable"],["pulls","Big pulls"]],"rankings");
  if(view.rankSub==="valuable")return`<div class="block" style="padding-bottom:0">${top}</div>${vValuable()}`;
  if(view.rankSub==="collectors")return`<div class="block" style="padding-bottom:0">${top}</div>${vCollectors()}`;
  if(view.rankSub==="pulls")return`<div class="block" style="padding-bottom:0">${top}</div><section class="block">${bigPulls(40)}</section>`;
  let list=ALL;
  if(view.rankTier>=0)list=list.filter(d=>d.tier===view.rankTier);
  if(view.rankLeague!=="all")list=list.filter(d=>(d.leagues||[]).some(l=>l.id===view.rankLeague));
  if(view.rankQ)list=list.filter(d=>d.name.toLowerCase().includes(view.rankQ.toLowerCase())||String(d.team).toLowerCase().includes(view.rankQ.toLowerCase()));
  return`<div class="block" style="padding-bottom:0">${top}</div>
  <section class="block"><div class="sec-head"><h2>Driver rankings</h2><p>${fmt(ALL.length)} drivers. Tap one to see its card.</p></div>
    <div class="filters"><input type="text" id="rankQ" data-act="rankq" placeholder="Search driver or team" value="${esc(view.rankQ)}" aria-label="Search drivers">
      <select id="rankLeague" data-act="rankleague" aria-label="League"><option value="all">All leagues</option>${LEAGUES.map(L=>`<option value="${esc(L.id)}" ${view.rankLeague===L.id?"selected":""}>${esc(L.name)}</option>`).join("")}</select>
      <button class="fchip" data-act="ranktier" data-tier="-1" aria-pressed="${view.rankTier<0}">All</button>
      ${TIERS.map((T,t)=>`<button class="fchip" style="--tc:var(--t${t})" data-act="ranktier" data-tier="${t}" aria-pressed="${view.rankTier===t}"><span class="sw"></span>${T.name}</button>`).join("")}</div>
    <div class="tablewrap"><table><thead><tr><th class="r">#</th><th>Driver</th><th>Rarity</th><th class="r">OVR</th><th class="hide-sm">Leagues</th><th class="r hide-sm">Wins</th><th class="r hide-sm">Pods</th><th class="r hide-sm">Owned</th></tr></thead><tbody>
      ${list.slice(0,view.rankAll||view.rankQ?1000:30).map(d=>`<tr data-card="${esc(d.id)}" style="cursor:pointer"><td class="r num">${d.rank}</td><td class="drv">${face(d.name)}<span>${esc(d.name)}<span class="muted team"> ${esc(d.team)}</span></span></td>
        <td><span class="tpill" style="--tc:var(--t${d.tier})"><span class="tp-long">${TIERS[d.tier].name}</span><span class="tp-short">${TIER_SHORT[d.tier]}</span></span></td><td class="r num">${d.ovr}</td>
        <td class="hide-sm">${(d.leagues||[]).map(l=>`<span class="lg-pill">${esc(l.short)} P${l.pos}</span>`).join("")}</td><td class="r num hide-sm">${d.wins}</td><td class="r num hide-sm">${d.pods}</td><td class="r num hide-sm">${(myCards[d.id]||0)+mySpecials().filter(x=>x.card_id===d.id).length||""}</td></tr>`).join("")}</tbody></table></div>
    ${!view.rankQ&&list.length>30?`<div style="text-align:center;margin-top:12px"><button class="btn ghost" data-act="rankall">${view.rankAll?"Show top 30 only":`Show all ${fmt(list.length)} drivers`}</button></div>`:""}</section>
  <section class="block"><details class="panel fold"><summary><b>How rarity works</b><span class="muted"> · ${LEAGUES.length} leagues</span></summary><p class="muted" style="font-size:14px">Rarity comes from a driver's points share, wins and podiums in each league, weighted by league tier (A counts most, then B, then C, then R) and by each league's order inside its tier. A driver's best league counts fully, the next one half, then a quarter and less, so missing a league doesn't sink anyone. Leagues in the same series (FC1 and FC2) count once.</p>
    ${LEAGUES.length?`<div class="tablewrap"><table><thead><tr><th>League</th><th class="hide-sm">Server</th><th>Tier</th><th class="r">Weight</th><th class="hide-sm">Season</th><th class="r hide-sm">Drivers</th><th class="hide-sm">Source</th></tr></thead><tbody>
      ${LEAGUES.map(L=>`<tr><td><span class="lg-pill">${esc(L.short)}</span>${esc(L.name)}</td><td class="hide-sm">${esc(L.server||"—")}</td><td>${esc(L.tier)}${(LEAGUES.filter(x=>x.tier===L.tier).length>1)?` #${L.tier_rank||1}`:""}</td><td class="r num">${leagueWeight(L).toFixed(2)}</td><td class="hide-sm">${esc(L.season||"")}</td><td class="r num hide-sm">${(L.rows||[]).length}</td><td class="hide-sm">${L.url?`<a href="${esc(L.url)}" target="_blank" rel="noopener">Standings</a>`:"—"}</td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty"><b>No leagues imported</b>Standings imported in League admin appear here.</div>`}</details></section>
`;
}
function vValuable(){
  const live=SPECIALS.filter(x=>x.status!=="retired");
  const ones=live.filter(x=>x.variant==="diamond").sort((a,b)=>card(b.card_id).tier-card(a.card_id).tier||card(b.card_id).ovr-card(a.card_id).ovr);
  const top=[...live].filter(x=>x.serial).map(x=>({x,val:spSell(x),last:lastSale(x.card_id,x.variant)})).sort((a,b)=>Math.max(b.val,b.last||0)-Math.max(a.val,a.last||0)).slice(0,25);
  const sales=[...SALES].sort((a,b)=>b.price-a.price).slice(0,10);
  const owner=x=>x.status==="auction"?"On auction":pname(x.owner);
  return`<section class="block"><div class="sec-head"><h2>Every 1 of 1</h2><p>Only one copy of each of these will ever exist. ${ones.length} pulled so far.</p></div>
    ${ones.length?`<div class="grid">${ones.map(x=>`<div style="display:flex;flex-direction:column;gap:6px">${cardHTML(card(x.card_id),{sp:spOf(x)})}<a class="muted" style="font-size:13px;text-align:center" href="#player/${encodeURIComponent(owner(x))}">${esc(owner(x))}</a></div>`).join("")}</div>`
      :`<div class="empty"><b>No 1 of 1s yet</b>Each card has about a ${oneIn(+(VBY.diamond?.chance)||0.00002)} chance of being a Diamond 1/1, and every Diamond is a Legendary or Mythic driver.</div>`}</section>
  <section class="block"><div class="sec-head"><h2>Most valuable numbered cards</h2><p>Ranked by the higher of quick-sell value and last auction price.</p></div>
    ${top.length?`<div class="tablewrap"><table><thead><tr><th>#</th><th>Card</th><th class="hide-sm">Owner</th><th class="r">Value</th></tr></thead><tbody>
      ${top.map((r,i)=>{const d=card(r.x.card_id);return`<tr data-special="${esc(r.x.id)}" style="cursor:pointer"><td class="num">${i+1}</td><td><div class="drv2">${face(d.name)}<div><div>${esc(d.name)}</div>${vpill(r.x.variant,r.x)}</div></div></td><td class="hide-sm">${esc(owner(r.x))}</td><td class="r num">${fmt(Math.max(r.val,r.last||0))}</td></tr>`}).join("")}</tbody></table></div>`
      :`<div class="empty"><b>No numbered cards yet</b>They show up here as soon as someone pulls one.</div>`}</section>
  <section class="block"><div class="sec-head"><h2>Biggest auction sales</h2></div>
    ${sales.length?`<div class="tablewrap"><table><thead><tr><th>Card</th><th class="r">Price</th><th class="r hide-sm">When</th></tr></thead><tbody>
      ${sales.map(x=>{const d=card(x.card_id);return`<tr data-card="${esc(d.id)}" style="cursor:pointer"><td><div class="drv2">${face(d.name)}<div><div>${esc(d.name)}</div>${x.variant&&x.variant!=="base"?vpill(x.variant,x):'<span class="muted" style="font-size:12px">Base</span>'}</div></div></td><td class="r num">${fmt(x.price)}</td><td class="r muted hide-sm">${ago(x.at)}</td></tr>`}).join("")}</tbody></table></div>`
      :`<div class="empty"><b>No sales yet</b>Finished auctions show up here.</div>`}</section>`;
}
function vCollectors(){
  const key={val:"val",uniq:"uniq",sets:"sets",num:"num"}[view.collSort]||"val";
  const list=collectorStats().sort((a,b)=>b[key]-a[key]||b.val-a.val);
  const lbl={val:"Value",uniq:"Drivers",sets:"Sets",num:"Numbered"};
  return`<section class="block"><div class="sec-head"><h2>Collectors</h2><p>Tap a collector to see their profile and showcase.</p></div>
    <div class="filters">${Object.entries(lbl).map(([k,l])=>`<button class="fchip" data-act="collsort" data-k="${k}" aria-pressed="${key===k}">${l}</button>`).join("")}</div>
    ${list.length?`<div class="tablewrap"><table><thead><tr><th>#</th><th>Collector</th><th>Showcase</th><th class="r">Sets</th><th class="r">Numbered</th><th class="r">Drivers</th><th class="r">Value</th></tr></thead><tbody>
      ${list.map((c,i)=>`<tr data-player="${esc(c.p.id)}" style="cursor:pointer"><td class="num">${i+1}</td><td style="white-space:nowrap">${c.p.ign?face(c.p.ign):c.p.avatar_url?`<img class="mini-head" alt="" src="${esc(c.p.avatar_url)}" style="border-radius:50%">`:""}${esc(c.p.ign||c.p.discord_name)}${c.p.id===session?.user.id?' <span class="tag lead">You</span>':""}<div style="margin-top:3px">${badgeHTML(c.p)}</div></td>
        <td>${showcaseCards(c.p).map(x=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;white-space:nowrap">${face(x.d.name)}<span class="tpill" style="--tc:var(--t${x.d.tier})">${esc(x.d.name)}</span>${x.sp?vpill(x.sp.variant,x.sp):""}</span>`).join("")||'<span class="muted">—</span>'}</td>
        <td class="r num">${c.sets||""}</td><td class="r num">${c.num||""}</td><td class="r num">${c.uniq}</td><td class="r num">${fmt(c.val)}</td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty"><b>No collectors yet</b>The first person to open a pack takes the top spot.</div>`}</section>`;
}
function showProfile(key){
  const p=profiles.find(x=>x.id===key)||profiles.find(x=>(x.ign||"").toLowerCase()===String(key).toLowerCase())||profiles.find(x=>(x.discord_name||"").toLowerCase()===String(key).toLowerCase());
  if(!p)return toast("Couldn't find that collector.");
  const c=collectorStats().find(x=>x.p.id===p.id)||{uniq:0,val:0,sets:0,num:0,sp:[]};
  const name=p.ign||p.discord_name;const sc=showcaseCards(p);
  const sp=[...c.sp].sort((a,b)=>vinfo(b.variant).sort-vinfo(a.variant).sort||card(b.card_id).tier-card(a.card_id).tier);
  const sets=allSetClaims.filter(x=>x.user_id===p.id).map(x=>x.set_id.replace(/^team:/,""));
  const link=location.origin+location.pathname+"#player/"+encodeURIComponent(name);
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(name)}"><div class="sheet">
    <div class="sheet-head"><h2 style="font-size:22px;display:flex;align-items:center;gap:10px">${p.ign?face(p.ign,"mini-head"):p.avatar_url?`<img class="mini-head" alt="" src="${esc(p.avatar_url)}" style="border-radius:50%">`:""}${esc(name)}</h2>
      <div class="row"><button class="btn ghost sm" data-act="copylink" data-link="${esc(link)}">Copy link</button><button class="btn ghost sm" data-act="close">Close</button></div></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px"><span class="chip">Drivers <b>${c.uniq}/${ALL.length}</b></span><span class="chip">Value <b>${fmt(c.val)}</b></span><span class="chip">Sets <b>${c.sets}</b></span><span class="chip">Numbered <b>${c.num}</b></span>${p.discord_name&&p.ign?`<span class="chip muted">Discord ${esc(p.discord_name)}</span>`:""}</div>
    ${badgesOf(p).length?`<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">${badgeHTML(p)}</div>`:""}
    <h3 style="font-size:17px;margin:6px 0 8px">Showcase</h3>
    ${sc.length?`<div class="grid mini">${sc.map(x=>cardHTML(x.d,{tag:"div",sp:x.sp})).join("")}</div>`:`<p class="muted">Nothing pinned yet.</p>`}
    ${sp.length?`<h3 style="font-size:17px;margin:16px 0 8px">Holo &amp; numbered <span class="muted num" style="font-size:14px">${sp.length}</span></h3><div class="grid">${sp.slice(0,24).map(x=>cardHTML(card(x.card_id),{tag:"div",sp:spOf(x)})).join("")}</div>`:""}
    ${sets.length?`<h3 style="font-size:17px;margin:16px 0 8px">Completed sets</h3><p>${sets.map(esc).join(" · ")}</p>`:""}
  </div></div>`;
}
function adminEconomy(){
  if(!ECON)return"";const E=ECON;const st=(l,v)=>`<div class="stat"><span>${l}</span><b class="num">${v}</b></div>`;
  return`<section class="block"><div class="sec-head"><h2>Economy</h2><p>Keep an eye on this during beta. If tokens pile up, lower rewards; if nobody can afford anything, raise them.</p></div>
    <div class="panel" style="margin-bottom:12px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>Diamond meter: <b class="num">${fmt(+DMETER.cards||0)}</b> cards opened without a Diamond${DMETER.since?` (${ago(DMETER.since).replace(" ago","")})`:""} · real chance now <b class="num">${VBY.diamond?oneIn(Number(VBY.diamond.chance)*diamondMult()):"—"}</b> per card (players only see ${VBY.diamond?oneIn(Number(VBY.diamond.chance)):"—"})</span><button class="btn ghost sm" data-act="diamondclock">Restart meter</button></div>
    <div class="stats">${st("Players",fmt(E.players))}${st("Tokens held",fmt(E.tokens))}${st("Median balance",fmt(Math.round(E.median)))}${st("Packs opened",fmt(E.packs_opened))}
      ${st("Unopened packs",fmt(E.packs_waiting))}${st("Holo &amp; numbered",fmt(E.specials))}${st("Race tokens (7d)",fmt(E.race_tokens_7d))}${st("Set tokens (7d)",fmt(E.set_tokens_7d))}${st("Auction sales (7d)",fmt(E.sales_7d))}${st("Live auctions",fmt(E.live_auctions))}</div>
    <div class="two" style="margin-top:14px">
      <div class="panel"><b>Richest players</b>${(E.rich||[]).map(r=>`<div class="lrow" style="grid-template-columns:1fr auto"><a href="#player/${encodeURIComponent(r.name)}">${esc(r.name)}</a><span class="price"><span class="coin"></span>${fmt(r.coins)}</span></div>`).join("")}</div>
      <div class="panel"><b>Admin activity</b>${(E.log||[]).length?(E.log||[]).map(l=>`<div class="lrow" style="grid-template-columns:1fr auto"><span><b>${esc(l.who)}</b> <span class="muted">${esc(l.action)} · ${esc(l.detail)}</span></span><span class="muted" style="font-size:12px">${ago(l.at)}</span></div>`).join(""):'<p class="muted" style="margin:8px 0 0">Nothing yet.</p>'}</div>
    </div></section>
  <section class="block"><div class="sec-head"><h2>Players</h2><p>Give tokens or packs, take back cards, or lock an account. Players get a notification when you change something.</p></div>
    <div class="filters"><input type="text" id="admQ" data-act="admq" placeholder="Search players" value="${esc(view.admQ||"")}"></div>
    <div class="tablewrap"><table><thead><tr><th>Player</th><th class="hide-sm">Discord</th><th class="r">Tokens</th><th class="r hide-sm">Drivers</th><th></th></tr></thead><tbody>
    ${collectorStatsAll().filter(c=>!view.admQ||`${c.p.ign||""} ${c.p.discord_name||""} ${c.p.discord_handle||""}`.toLowerCase().includes(view.admQ.toLowerCase())).map(c=>`<tr>
      <td>${esc(c.p.ign||c.p.discord_name)}${c.p.locked?' <span class="tag out">Locked</span>':""}${c.p.is_admin?' <span class="tag">Admin</span>':""}</td><td class="hide-sm muted">${esc(c.p.discord_handle||"")}</td>
      <td class="r num">${fmt(c.p.coins)}</td><td class="r num hide-sm">${c.uniq}</td><td class="r"><button class="btn ghost sm" data-act="admplayer" data-id="${esc(c.p.id)}">Manage</button></td></tr>`).join("")}
    </tbody></table></div></section>`;
}
function collectorStatsAll(){const cs=collectorStats();return profiles.map(p=>cs.find(c=>c.p.id===p.id)||{p,uniq:0,val:0,sets:0,num:0,sp:[]}).sort((a,b)=>String(a.p.ign||a.p.discord_name).localeCompare(String(b.p.ign||b.p.discord_name)))}
function showAdminPlayer(uid){
  const p=profiles.find(x=>x.id===uid);if(!p)return;
  const base=allCards.filter(c=>c.user_id===uid&&c.qty>0).sort((a,b)=>card(b.card_id).tier-card(a.card_id).tier);
  const sp=SPECIALS.filter(x=>x.owner===uid&&x.status==="owned");
  const packOpts=Object.values(PACKS).sort((a,b)=>a.sort-b.sort).map(P=>`<option value="${esc(P.id)}">${esc(P.name)}</option>`).join("");
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Manage player"><div class="sheet" style="width:min(620px,100%)">
    <div class="sheet-head"><h2 style="font-size:20px">${esc(p.ign||p.discord_name)} <span class="muted" style="font-size:14px;font-weight:500">${esc(p.discord_handle||"")}</span></h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <p class="muted" style="margin:0 0 12px">${fmt(p.coins)} tokens · ${base.reduce((s,c)=>s+c.qty,0)} base cards · ${sp.length} Holo/numbered${p.locked?' · <span class="tag out">Locked</span>':""}</p>
    <form class="panel" data-form="admgrant" data-id="${esc(uid)}" style="display:flex;flex-direction:column;gap:10px"><b>Give or take tokens and packs</b>
      <div class="row"><label class="f" style="width:130px">Tokens (+/−)<input type="number" name="coins" value="0" step="10"></label>
        <label class="f" style="flex:1;min-width:150px">Pack<select name="pack"><option value="">None</option>${packOpts}</select></label>
        <label class="f" style="width:80px">How many<input type="number" name="qty" value="1" min="1" max="20"></label></div>
      <label class="f">Note to the player (optional)<input type="text" name="note" maxlength="120" placeholder="Giveaway winner"></label>
      <button class="btn" style="align-self:flex-start">Send</button></form>
    <form class="panel" data-form="admtake" data-id="${esc(uid)}" style="display:flex;flex-direction:column;gap:10px;margin-top:12px"><b>Take back a card</b>
      <label class="f">Card<select name="card"><option value="">Pick a card</option>
        ${sp.map(x=>`<option value="s:${x.id}">${esc(card(x.card_id).name)} · ${esc(vinfo(x.variant).name)}${x.serial?" "+serialTxt(x):""}</option>`).join("")}
        ${base.map(c=>`<option value="b:${esc(c.card_id)}">${esc(card(c.card_id).name)} · ${TIERS[card(c.card_id).tier].name} base (×${c.qty})</option>`).join("")}</select></label>
      <label class="f">Reason (optional)<input type="text" name="note" maxlength="120"></label>
      <button class="btn warn" style="align-self:flex-start">Take card</button></form>
    <div class="row" style="margin-top:12px">${p.is_admin?"":`<button class="btn ${p.locked?"":"warn"}" data-act="admlock" data-id="${esc(uid)}" data-v="${p.locked?0:1}">${p.locked?"Unlock account":"Lock account"}</button>`}
      <a class="btn ghost" href="#player/${encodeURIComponent(p.ign||p.discord_name)}" data-act="close">View profile</a></div>
  </div></div>`;
}
async function adminAct(fn,args,msg,reopen){try{const r=await rpc(fn,args);await Promise.all([loadMe(),loadPeople()]);toast(msg(r));render();if(reopen)showAdminPlayer(reopen)}catch(e){toast(errMsg(e))}}
function vAdmin(){
  if(!isAdmin())return`<div class="empty"><b>Admins only</b>League admin is for the league staff.</div>`;
  return adminEconomy()+vAdminRest();
}
function vAdminRest(){
  const pend=ignReqs.filter(r=>r.status==="pending"),denied=ignReqs.filter(r=>r.status==="denied");
  const prof=id=>profiles.find(p=>p.id===id)||{};
  const approved=profiles.filter(p=>p.ign).sort((a,b)=>a.ign.localeCompare(b.ign));
  const openBugs=BUGS.filter(b=>b.status==="open"),doneBugs=BUGS.filter(b=>b.status!=="open").slice(0,8);
  const bugRow=b=>`<div class="lrow" style="grid-template-columns:1fr auto;align-items:start"><div style="min-width:0"><div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(b.body)}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">${esc(pname(b.user_id))} · ${esc(b.page)} · ${esc(b.device)} · ${ago(b.created_at)}</div></div>
    <div class="row" style="gap:6px;justify-content:flex-end">${b.status==="open"?`<button class="btn sm" data-act="bugset" data-id="${b.id}" data-s="fixed">Fixed</button><button class="btn ghost sm" data-act="bugset" data-id="${b.id}" data-s="wontfix">Close</button>`:`<span class="tag ${b.status==="fixed"?"lead":""}">${b.status==="fixed"?"Fixed":"Closed"}</span><button class="btn ghost sm" data-act="bugset" data-id="${b.id}" data-s="open">Reopen</button>`}</div></div>`;
  const admins=profiles.filter(p=>p.is_admin);const others=profiles.filter(p=>!p.is_admin&&!p.locked).sort((a,b)=>String(a.ign||a.discord_name).localeCompare(String(b.ign||b.discord_name)));
  const adminSec=`<section class="block"><div class="sec-head"><h2>Admins</h2><p>${IS_OWNER?"Only you, the site owner, can add or remove admins. Admin access is tied to each person's Discord account, so it survives resets and new accounts.":"Only the site owner can add or remove admins."}</p></div>
    <div class="panel list-rows">${admins.map(p=>`<div class="lrow" style="grid-template-columns:1fr auto"><span>${p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:8px">`:""}<b>${esc(p.ign||p.discord_name)}</b> <span class="muted">${esc(p.discord_handle||"")}</span>${p.id===session?.user.id?' <span class="tag">You</span>':""}</span>
      ${IS_OWNER&&p.id!==session?.user.id?`<button class="btn ghost sm" data-act="setadmin" data-id="${esc(p.id)}" data-on="0">Remove</button>`:"<span></span>"}</div>`).join("")}
    ${IS_OWNER?`<form data-form="addadmin" class="lrow" style="grid-template-columns:1fr auto"><select name="user" aria-label="Player to make admin"><option value="">Pick a player…</option>${others.map(p=>`<option value="${esc(p.id)}">${esc(p.ign||p.discord_name)}${p.discord_handle?` (${esc(p.discord_handle)})`:""}</option>`).join("")}</select><button class="btn sm">Make admin</button></form>`:""}</div></section>`;
  return`${adminSec}<section class="block"><div class="sec-head"><h2>Bug reports</h2><p>${openBugs.length?`${openBugs.length} open. Marking one fixed sends the reporter a thank-you notification.`:"No open reports."}</p></div>
    ${openBugs.length?`<div class="panel list-rows">${openBugs.map(bugRow).join("")}</div>`:""}
    ${doneBugs.length?`<details class="fold" style="margin-top:10px"><summary>Recently closed (${doneBugs.length})</summary><div class="list-rows">${doneBugs.map(bugRow).join("")}</div></details>`:""}</section>
  <section class="block"><div class="sec-head"><h2>IGN requests</h2><p>Each request shows the Discord account that signed in and asked for the IGN. Accept it if that Discord user really owns the Minecraft account.</p></div>
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
  <section class="block"><div class="sec-head"><h2>Renamed players</h2><p>When a racer changes their Minecraft name, their old and new names make two cards. Tell the site they're the same person and the cards merge into one under the new name. Their old race results and track times still pay out to them.</p></div>
    <form class="panel" data-form="merge" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><label class="f" for="mOld" style="flex:1;min-width:150px">Old name<input type="text" id="mOld" name="old" maxlength="16" placeholder="kaweyq"></label>
        <label class="f" for="mNew" style="flex:1;min-width:150px">Current name<input type="text" id="mNew" name="cur" maxlength="16" placeholder="Kayne256"></label></div>
      <button class="btn" style="align-self:flex-start">Merge and rebuild</button>
      ${PLAYERS.length?`<details><summary class="muted" style="font-size:14px;cursor:pointer">${NAMEMAP.filter(n=>{const p=PLAYERS.find(x=>x.uuid===n.uuid);return p&&p.current.toLowerCase()!==n.name}).length} old names already linked</summary>
        <p style="font-size:14px">${PLAYERS.map(p=>({p,old:[...new Set(NAMEMAP.filter(n=>n.uuid===p.uuid&&n.name!==p.current.toLowerCase()).map(n=>n.name))]})).filter(x=>x.old.length).sort((a,b)=>a.p.current.localeCompare(b.p.current)).map(x=>`<b>${esc(x.p.current)}</b> <span class="muted">was ${x.old.map(esc).join(", ")}</span>`).join("<br>")}</p></details>`:""}
    </form></section>
  <section class="block"><div class="sec-head"><h2>Team families</h2><p>Teams listed here count as one team for cards and sets (for example IKEA Racing Jr's counts as IKEA Racing).</p></div>
    <form class="panel" data-form="teamalias" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><label class="f" style="flex:1;min-width:150px">Team name<input type="text" name="alias" maxlength="60" placeholder="IKEA Racing Jr's"></label>
        <label class="f" style="flex:1;min-width:150px">Counts as<input type="text" name="team" maxlength="60" placeholder="IKEA Racing"></label></div>
      <button class="btn" style="align-self:flex-start">Save and rebuild</button>
      ${TEAMALIAS.length?`<div class="list-rows" style="padding:0">${TEAMALIAS.slice().sort((a,b)=>a.team.localeCompare(b.team)).map(r=>`<div class="lrow" style="grid-template-columns:1fr auto"><span>${esc(r.alias)} <span class="muted">→</span> <b>${esc(r.team)}</b></span><button type="button" class="btn ghost sm" data-act="delalias" data-id="${esc(r.alias)}">Remove</button></div>`).join("")}</div>`:""}
    </form></section>
  <section class="block"><div class="sec-head"><h2>Removed players</h2><p>Players listed here get no card and are hidden from race results and track times. Any of their names works, old names included.</p></div>
    <form class="panel" data-form="rmplayer" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><label class="f" style="flex:1;min-width:150px">Minecraft name<input type="text" name="name" maxlength="16" placeholder="Name to remove" list="drvlist"></label>
        <label class="f" style="flex:1;min-width:150px">Note (only admins see it)<input type="text" name="note" maxlength="80"></label></div>
      <button class="btn" style="align-self:flex-start">Remove and rebuild</button>
      ${REMOVED.length?`<div class="list-rows" style="padding:0">${REMOVED.map(r=>`<div class="lrow" style="grid-template-columns:1fr auto"><span><b>${esc(r.name)}</b>${r.note?` <span class="muted">${esc(r.note)}</span>`:""}</span><button type="button" class="btn ghost sm" data-act="unremove" data-id="${esc(r.name)}">Bring back</button></div>`).join("")}</div>`:""}
    </form></section>
  <section class="block"><div class="sec-head"><h2>Driver teams</h2><p>Set a driver's team when the standings get it wrong (say they only subbed for a team once). It replaces every team from the standings, for their card and for team sets.</p></div>
    <form class="panel" data-form="dteam" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><label class="f" style="flex:1;min-width:150px">Driver<input type="text" name="name" maxlength="16" placeholder="DiamondSwishyy" list="drvlist"></label>
        <label class="f" style="flex:1;min-width:150px">Team<input type="text" name="team" maxlength="60" placeholder="Pelican Racing" list="teamlist"></label></div>
      <datalist id="drvlist">${ALL.map(d=>`<option value="${esc(d.name)}">`).join("")}</datalist><datalist id="teamlist">${[...new Set(ALL.flatMap(d=>d.teams||[]))].sort().map(t=>`<option value="${esc(t)}">`).join("")}</datalist>
      <button class="btn" style="align-self:flex-start">Save and rebuild</button>
      ${DTEAMS.length?`<div class="list-rows" style="padding:0">${DTEAMS.map(r=>`<div class="lrow" style="grid-template-columns:1fr auto"><span>${esc(r.display)} <span class="muted">→</span> <b>${esc(r.team)}</b></span><button type="button" class="btn ghost sm" data-act="deldteam" data-id="${esc(r.name)}">Remove</button></div>`).join("")}</div>`:""}
    </form></section>
  <section class="block"><div class="sec-head"><h2>Star drivers</h2><p>For elite racers who barely race in the leagues, so their standings undersell them. Set a minimum rarity and OVR. If they aren't in any league, they get a card anyway. There are always exactly ${MYTHIC_COUNT} Mythics, the top ${MYTHIC_COUNT} by OVR, so a Mythic star driver who isn't in the top ${MYTHIC_COUNT} becomes Legendary.</p></div>
    <form class="panel" data-form="star" style="display:flex;flex-direction:column;gap:10px">
      <div class="row"><label class="f" for="sName" style="flex:1;min-width:150px">Minecraft IGN<input type="text" id="sName" name="name" maxlength="16" placeholder="sodasoker"></label>
        <label class="f" for="sTier">Rarity at least<select id="sTier" name="tier">${TIERS.map((T,t)=>`<option value="${t}" ${t===5?"selected":""}>${T.name}</option>`).reverse().join("")}</select></label>
        <label class="f" for="sOvr" style="width:110px">OVR (optional)<input type="number" id="sOvr" name="ovr" min="40" max="99" placeholder="96"></label>
        <label class="f" for="sTeam" style="flex:1;min-width:140px">Team (optional)<input type="text" id="sTeam" name="team" maxlength="40"></label></div>
      <button class="btn" style="align-self:flex-start">Save and rebuild</button>
      ${STARS.length?`<div class="tablewrap"><table><thead><tr><th>Driver</th><th>Rarity floor</th><th class="r">OVR</th><th></th></tr></thead><tbody>${STARS.map(o=>`<tr><td>${face(o.display)}${esc(o.display)}</td><td><span class="tpill" style="--tc:var(--t${o.min_tier})">${TIERS[o.min_tier].name}</span></td><td class="r num">${o.ovr||"—"}</td><td class="r"><button type="button" class="btn ghost sm" data-act="delstar" data-id="${esc(o.name)}">Remove</button></td></tr>`).join("")}</tbody></table></div>`:""}
    </form></section>
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
  <section class="block"><div class="sec-head"><h2>Leagues</h2><p>Give leagues the same Series name (like FC) and a driver only gets credit for their best one of them. Changes apply when you leave the box.</p></div>
    ${LEAGUES.length?`<div class="tablewrap"><table><thead><tr><th>League</th><th>Tier</th><th>Order in tier</th><th>Series</th><th class="r">Drivers</th><th></th></tr></thead><tbody>${LEAGUES.map(L=>`<tr><td><span class="lg-pill">${esc(L.short)}</span>${esc(L.name)} <span class="muted">${esc(L.server||"")} ${esc(L.season||"")}</span></td>
      <td><select data-act="settier" data-id="${esc(L.id)}" aria-label="Tier for ${esc(L.name)}">${["A","B","C","R"].map(t=>`<option ${L.tier===t?"selected":""}>${t}</option>`).join("")}</select></td>
      <td><select data-act="setrank" data-id="${esc(L.id)}" aria-label="Order in tier for ${esc(L.name)}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${(L.tier_rank||1)===n?"selected":""}>#${n}</option>`).join("")}</select></td>
      <td><input type="text" data-act="setseries" data-id="${esc(L.id)}" value="${esc(L.series||"")}" placeholder="—" maxlength="12" style="width:80px" aria-label="Series for ${esc(L.name)}"></td>
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
      <p class="muted" style="margin:0;font-size:14px">${siteCfg.tracks_feed_url||siteCfg.bl_status?`BoatLabs scan: <b style="color:var(--ink)">${esc(siteCfg.bl_status||siteCfg.tracks_feed_status||"not checked yet")}</b>${siteCfg.tracks_feed_checked?` · checked ${esc(new Date(siteCfg.tracks_feed_checked).toLocaleString())}`:""}. <button type="button" class="btn ghost sm" data-act="syncfeed">Check now</button>`:"Run auto_tracks.sql to turn on nightly updates."}</p>
      <p class="muted" style="margin:0;font-size:14px">Race results feed: <b style="color:var(--ink)">${esc(siteCfg.races_feed_status||"not checked yet")}</b>${siteCfg.races_feed_checked?` · checked ${esc(new Date(siteCfg.races_feed_checked).toLocaleString())}`:""}. <button type="button" class="btn ghost sm" data-act="syncraces">Check races now</button></p>
      <label class="f" for="tName">Track name<input type="text" id="tName" name="tname" placeholder="Luigi Circuit"></label>
      <label class="f" for="tTop">Top 20 (position | player | time)<textarea id="tTop" name="ttop" placeholder="1|Makkuusen|25.335&#10;2|Lapis_Lettuce|25.350"></textarea></label>
      <button class="btn" style="align-self:flex-start">Save track</button></form></section>
  <section class="block"><div class="sec-head"><h2>Posted races (${races.length})</h2></div>
    <div class="tablewrap"><table><thead><tr><th>Race</th><th>League</th><th>Date</th><th class="r">Finishers</th><th></th></tr></thead><tbody>
      ${[...races].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.league)} · ${esc(r.tier)}</td><td class="num">${esc(r.date)}</td><td class="r num">${(r.results||[]).length}</td><td class="r"><button class="btn ghost sm" data-act="delrace" data-id="${esc(r.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div></section>`;
}
function pullRow(p,guest){
  const d=card(p.card_id),pr=profiles.find(x=>x.id===p.user_id),who=pr?(pr.ign||pr.discord_name):"Someone";
  const v=p.variant&&p.variant!=="base"?p.variant:"";
  return`<li>${face(d.name)}<div class="pull-main"><div><b>${esc(d.name)}</b> <span class="tpill" style="--tc:var(--t${d.tier})">${TIERS[d.tier].name}</span>${v?" "+vpill(v,p):""}</div>
    <div class="muted" style="font-size:12px">${guest?esc(who):`<a href="#player/${encodeURIComponent(who)}">${esc(who)}</a>`} · ${ago(p.at)}</div></div></li>`;
}
function bigPulls(n,guest){
  const list=PULLS.slice(0,n);
  return`<div class="panel pulls"><span class="eyebrow">Recent big pulls</span>${list.length?`<ul>${list.map(p=>pullRow(p,guest)).join("")}</ul>`:`<p class="muted" style="margin:6px 0 0">Legendary and Mythic drivers and every numbered card show up here when someone pulls one.</p>`}</div>`;
}
function vLanding(){
  const vs=VARIANTS.filter(v=>v.id==="gold"||v.id==="diamond");
  const ex=ALL.slice(0,3);
  return`<section class="hero"><div><span class="eyebrow">Minecraft iceboat racing · Beta</span><h2>Collect the drivers. Earn packs on the ice.</h2>
    <p>Every card is a real racer, ranked from FrostHex, IceDrifters and IBR results. Open packs, chase numbered cards, trade on the auction house and earn tokens from your own race finishes and BoatLabs times.</p>
    <button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord</button>
    <p class="muted" style="font-size:13px;margin:10px 0 0">You need a Discord account to play. Signing in only shares your Discord name and avatar.</p></div>
    <div class="hero-cards">${ex.map((d,i)=>cardHTML(d,{tag:"div",sp:i===1&&vs[0]?{variant:vs[0].id,serial:7,print_run:vs[0].print_run}:i===2&&vs[1]?{variant:vs[1].id,serial:1,print_run:1}:null})).join("")}</div></section>
  <section class="block">${bigPulls(8,true)}</section>
  ${vGuide(true)}`;
}
function vGuide(landing){
  const pk=id=>PACKS[id]?.name||id;
  const vs=VARIANTS.filter(v=>v.id!=="base");
  return`<section class="block guide"><div class="sec-head"><h2>How it works</h2><p>IBR Trading Cards is in <b style="color:var(--ink)">beta</b>. Things may change, and cards or tokens could be reset before the full launch.</p></div>
  <h3>1. Sign in</h3>
  <p>Sign in with Discord. Your first sign-in comes with a ${esc(pk("starter"))} and ${fmt(250)} tokens.</p>
  <h3>2. Get cards</h3>
  <ul><li><b>Daily Pack</b>: free every 24 hours, counted from when you last claimed it.</li>
    <li><b>Pack store</b>: buy with tokens and keep every card.</li>
    <li><b>Special packs</b> (Tier A Elite, Podium, Team, Champion's Crate): better odds and narrower pools, but you see all the cards and keep only one.</li>
    <li><b>Rarity shop</b>: pick a rarity and get a random driver from it.</li></ul>
  <h3>3. Rarity</h3>
  <p>Every card is a real racer. Rarity comes from their league results: points share, wins and podiums, weighted by league tier (A, then B, C, R) and by each league's order inside its tier. A driver's best league counts fully, the next one counts half, then less. Only the top 6 drivers are <b>Mythic</b>. After that come Legendary, Epic, Rare, Uncommon and Common. Rarities are fixed for the season.</p>
  ${vs.length?`<h3>4. Special versions</h3>
  <p>Any card can come out as a special version. Numbered versions have a fixed print run for each driver. Once every serial is pulled, that version is gone for good. Special versions also raise the card's OVR and are worth more. A <b>Diamond 1/1</b> is always a Legendary or Mythic driver: if one hits on any card, it turns into a top driver's 1/1.</p>
  <div class="var-row">${vs.map(v=>vpill(v.id)+`<span class="muted num" style="font-size:13px;align-self:center">${v.print_run?(v.print_run===1?"1/1":"/"+v.print_run):"no limit"}</span>`).join("")}</div>`:""}
  ${landing?"":`</section>${variantsInfo()}${packOddsTable()}<section class="block guide">`}
  <h3>5. Earn tokens with your own racing</h3>
  <ol><li>Go to ${landing?"Rewards":`<a href="#races">Rewards</a>`} and submit your Minecraft IGN.</li>
    <li>The admin checks the Discord account that asked for it and approves it. Each Minecraft account can belong to only one person.</li>
    <li>Your race finishes in FC and IceDrifters leagues pay tokens, and podiums also give a race pack. A top-20 time on any BoatLabs track pays a few tokens too, and moving up pays the difference.</li>
    <li>Race results are checked twice an hour. Every BoatLabs track (all 800+) is rechecked about every 3–4 hours, and new tracks are picked up daily. Tap <b>Claim everything</b> to collect.</li></ol>
  <p>If you've changed your Minecraft name, results under your old name still count for you.</p>
  <h3>6. Auction house</h3>
  <p>You need an approved Minecraft IGN to buy or sell here, which keeps alt accounts out. List any card from your Collection. Your bid is held until someone outbids you, and then you get it back right away. Bids in the last 30 seconds extend the timer. Sellers pay a ${AUCTION_FEE*100}% fee. You can also quick-sell cards for tokens. Quick-selling a numbered card retires that serial forever.</p>
  <h3>7. Sets, trade-ins and your showcase</h3>
  <p>Own every driver on a team (teams with 5 or more drivers this season) to claim a one-time token reward on the Sets tab. A driver who races for two teams counts for both. Trade spare duplicates for a random card of the next rarity up: 5 Commons, 5 Uncommons, 6 Rares, 8 Epics or 10 Legendaries. Pin your best 3 cards to your showcase so they show next to your name on Top collectors.</p>
  <h3>8. Rankings</h3>
  <p>${landing?"Rankings":`<a href="#rankings">Rankings</a>`} shows every driver in the pool, the leagues that count and the top collectors.</p>
  ${landing?"":`<h3>Found a bug?</h3><p>Something broken, confusing or unfair? <button class="linkbtn" data-act="bug" style="display:inline;padding:0;font-size:inherit">Report a bug</button> and the league admin will see it. You'll get a notification when it's fixed.</p>`}
  ${siteCfg.discord_invite?`<p><a href="${esc(siteCfg.discord_invite)}" target="_blank" rel="noopener">Join the Discord</a> for news and help.</p>`:""}
  ${landing?`<div style="margin-top:22px"><button class="signin" data-act="signin">${DISCORD_SVG}Sign in with Discord to start</button></div>`:""}
  </section>`;
}
const VIEWS={packs:()=>vPacks()+vShop(),collection:vCollection,auctions:vAuctions,races:vRaces,rankings:vRankings,admin:vAdmin,help:()=>vGuide(false)};
let lastHTML="",booted=false;
function render(){
  if(!sb){$("#main").innerHTML=`<div class="empty"><b>Almost there</b>Open <span class="num">config.js</span> and paste your Supabase URL and anon key. The setup guide explains where to find them.</div>`;return}
  if(!VIEWS[tab])tab="packs";
  const cur=(tab==="admin"&&!isAdmin())?(booted?"packs":"loading"):tab;
  renderWallet();
  $("#tabs").hidden=!signedIn();
  const ae=document.activeElement,aid=ae&&ae.id,sel=aid&&ae.selectionStart;
  const html=!booted?`<div class="empty"><b>Loading the paddock…</b>Fetching leagues, packs and your collection.</div>`:!signedIn()?vLanding():cur==="loading"?"":VIEWS[cur]();
  if(html!==lastHTML){
    const keep={};$("#main").querySelectorAll("input[id],textarea[id]").forEach(el=>{if(el.value!==el.defaultValue)keep[el.id]=el.value});
    $("#main").innerHTML=html;lastHTML=html;
    for(const [id,v] of Object.entries(keep)){const el=document.getElementById(id);if(el)el.value=v}
  }
  if(pendingOpen&&booted&&signedIn()&&ALL.length){const o=pendingOpen;pendingOpen=null;setTimeout(()=>o.card?showDetail(BY_ID[o.card]?o.card:(ALL.find(d=>d.name.toLowerCase()===o.card.toLowerCase())||{}).id||o.card):showProfile(o.player),0)}
  if(aid){const el=document.getElementById(aid);if(el&&el!==document.activeElement){el.focus();try{if(sel!=null)el.setSelectionRange(sel,sel)}catch{}}}
}

/* ---------- overlays ---------- */
function showBug(){
  if(!guard())return;
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Report a bug"><div class="sheet" style="width:min(520px,100%)">
    <div class="sheet-head"><h2 style="font-size:22px">Report a bug</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <form data-form="bug" style="display:flex;flex-direction:column;gap:12px">
      <label class="f" for="bugBody">What went wrong?<textarea id="bugBody" name="body" rows="5" maxlength="2000" required placeholder="What you tapped, what you expected, and what happened instead." style="width:100%;resize:vertical"></textarea></label>
      <p class="muted" style="margin:0;font-size:13px">We'll attach the page you were on (${esc(location.hash||"#packs")}) and your device type. Screenshots help too: post them in the Discord forum and mention your report.</p>
      <button class="btn" style="align-self:flex-start">Send report</button></form>
    ${MYBUGS.length?`<h3 style="font-size:16px;margin:16px 0 6px">Your reports</h3><ul class="notices">${MYBUGS.slice(0,5).map(b=>`<li><span>${esc(b.body.slice(0,90))}${b.body.length>90?"…":""}</span><span class="tag ${b.status==="fixed"?"lead":""}" style="flex:none">${b.status==="fixed"?"Fixed":b.status==="wontfix"?"Closed":"Open"}</span></li>`).join("")}</ul>`:""}
  </div></div>`;
  setTimeout(()=>document.getElementById("bugBody")?.focus(),50);
}
const deviceInfo=()=>{const ua=navigator.userAgent;const os=/iPhone|iPad/.test(ua)?"iOS":/Android/.test(ua)?"Android":/Mac/.test(ua)?"Mac":/Windows/.test(ua)?"Windows":"Other";
  const br=/CriOS|Chrome/.test(ua)&&!/Edg/.test(ua)?"Chrome":/Edg/.test(ua)?"Edge":/Firefox|FxiOS/.test(ua)?"Firefox":/Safari/.test(ua)?"Safari":"Browser";return`${os} · ${br} · ${innerWidth}×${innerHeight}`};
function closeOverlay(){if(revealLock>0)return;$("#overlay").innerHTML=""}
/* which pulls get the big reveal */
function bigPull(x){
  const d=card(x.id),v=x.variant&&x.variant!=="base"?x.variant:"";
  const VC={holo:"#f0abfc",frost:"#7dd3fc",gold:"#fbbf24",aurora:"#5eead4",blackice:"#93c5fd",diamond:"#f472b6"};
  if(v==="diamond")return{label:"1 of 1",color:VC.diamond};
  if(x.serial)return{label:`${vinfo(v).name} ${serialTxt(x)}`,color:VC[v]||"#fff"};
  if(d.tier===5)return{label:v?`Mythic ${vinfo(v).name}`:"Mythic",color:"#22d3ee"};
  if(d.tier===4)return{label:v?`Legendary ${vinfo(v).name}`:"Legendary",color:"#fbbf24"};
  return null;
}
/* while a Diamond plays, the reveal can't be closed or skipped */
let revealLock=0;
function lockReveal(on){revealLock=Math.max(0,revealLock+(on?1:-1));const ov=document.querySelector(".overlay");if(!ov)return;
  ov.classList.toggle("locked",revealLock>0);ov.querySelectorAll("[data-act]").forEach(b=>{if(revealLock>0){if(!b.disabled){b.disabled=true;b.dataset.lk="1"}}else if(b.dataset.lk){b.disabled=false;delete b.dataset.lk}})}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function diamondReveal(f,done){
  f.dataset.running="1";lockReveal(true);
  const calm=matchMedia("(prefers-reduced-motion: reduce)").matches;const fromEl=f.querySelector(".from-card");
  try{
    if(!fromEl){f.classList.add("charging");await wait(calm?200:1400);f.classList.remove("charging");f.classList.add("open","bursting");await wait(calm?600:2600);return}
    f.classList.add("open","dia-open");await wait(calm?400:1700);
    if(!calm){f.classList.add("cracking");fromEl.insertAdjacentHTML("beforeend",`<svg class="cracks" viewBox="0 0 100 148" preserveAspectRatio="none" aria-hidden="true"><path d="M50 70 L38 40 L42 18 L30 0"/><path d="M50 70 L70 52 L88 48 L100 30"/><path d="M50 70 L62 98 L58 122 L70 148"/><path d="M50 70 L24 84 L10 110 L0 118"/><path d="M50 70 L80 92 L100 96"/><path d="M38 40 L18 36 L0 44"/><path d="M62 98 L84 118"/></svg>`);
      await wait(1500);
      /* shatter: slices of the old card fly apart */
      const html=fromEl.innerHTML.replace(/<svg class="cracks"[\s\S]*?<\/svg>/,"");const cuts=[["0 0","50 0","50 47","38 27"],["50 0","100 0","100 20","70 35","50 47"],["100 20","100 65","70 35"],["70 35","100 65","100 100","62 66","50 47"],["62 66","100 100","70 100"],["38 27","50 47","62 66","70 100","40 100","42 70"],["0 0","38 27","42 70","0 56"],["0 56","42 70","40 100","0 100"]];
      fromEl.insertAdjacentHTML("afterend",cuts.map((c,i)=>{const cx=c.reduce((a,p)=>a+ +p.split(" ")[0],0)/c.length-50,cy=c.reduce((a,p)=>a+ +p.split(" ")[1],0)/c.length-50;
        return`<div class="shard" style="clip-path:polygon(${c.map(p=>p.split(" ").map(n=>n+"%").join(" ")).join(",")});--tx:${(cx*3.2).toFixed(0)}px;--ty:${(cy*3.6+40).toFixed(0)}px;--r:${((i%2?1:-1)*(18+i*9))}deg;animation-delay:${i*25}ms">${html}</div>`}).join(""));
      fromEl.remove();f.classList.remove("cracking");f.classList.add("shatter");await wait(160);
    }else fromEl.remove();
    f.classList.add("bursting","dia-done");await wait(calm?600:2400);
    f.querySelectorAll(".shard").forEach(x=>x.remove());
  }finally{delete f.dataset.running;lockReveal(false);const sum=document.querySelector(".reveal-sum");if(sum&&[...document.querySelectorAll("[data-flip]")].every(x=>x.classList.contains("open")))sum.hidden=false;done&&done()}
}
function openFlip(f,done){
  if(f.dataset.running)return;
  if(f.classList.contains("open")||f.classList.contains("charging"))return done&&done();
  if(f.classList.contains("dia"))return diamondReveal(f,done);
  const finish=()=>{const sum=document.querySelector(".reveal-sum");if(sum&&[...document.querySelectorAll("[data-flip]")].every(x=>x.classList.contains("open")))sum.hidden=false;done&&done()};
  if(!f.classList.contains("big")||matchMedia("(prefers-reduced-motion: reduce)").matches){f.classList.add("open");return finish()}
  f.classList.add("charging");
  setTimeout(()=>{f.classList.remove("charging");f.classList.add("open","bursting");setTimeout(finish,900);setTimeout(()=>f.classList.remove("bursting"),2600)},750);
}
/* one card in a reveal: Diamonds that were upgraded from another driver show that driver first, then shatter */
function flipHTML(x,i,{open=false,sp}={}){
  const big=bigPull(x),dia=x.variant==="diamond",from=dia&&x.from&&x.from!==x.id?x.from:"";
  return`<button type="button" class="flip${open?" open":""}${big?" big":""}${dia?" dia":""}" data-flip ${from?`data-from="${esc(from)}"`:""} ${big?`data-big="${esc(big.label)}" style="--glow:${big.color}"`:""} aria-label="Reveal card ${i+1}"><div class="flip-in"><div class="back">IBR Cards</div><div class="face">${cardHTML(card(x.id),{isNew:x.is_new,tag:"div",sp})}${from&&!open?`<div class="from-card">${cardHTML(card(from),{tag:"div"})}</div>`:""}</div></div>${big?`<span class="burst" aria-hidden="true"></span><span class="big-label">${esc(big.label)}</span>`:""}</button>`;
}
function showReveal(title,items){
  const vs=x=>vinfo(x.variant||"base").sort||0;
  const sorted=[...items].sort((a,b)=>vs(a)-vs(b)||card(a.id).tier-card(b.id).tier);
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet">
    <div class="sheet-head"><div><span class="eyebrow">Opening</span><h2 style="font-size:22px">${esc(title)}</h2></div>
      <div class="row"><button class="btn ghost" data-act="flipall">Reveal all</button><button class="btn" data-act="close">Done</button></div></div>
    <div class="reveal-grid">${sorted.map((x,i)=>flipHTML(x,i,{sp:x.variant&&x.variant!=="base"?{variant:x.variant,serial:x.serial,print_run:x.print_run}:null})).join("")}</div>
    <p class="muted reveal-sum" hidden style="margin:14px 0 0;font-size:14px">${sorted.filter(x=>x.is_new).length} new · best pull: ${esc(TIERS[Math.max(...sorted.map(x=>card(x.id).tier))].name)}${sorted.some(x=>x.variant&&x.variant!=="base")?` · <b style="color:var(--ink)">${sorted.filter(x=>x.variant&&x.variant!=="base").map(x=>vinfo(x.variant).name+(x.serial?" "+serialTxt(x):"")).join(", ")}</b>`:""}</p></div></div>`;
}
function showPicker(){
  if(!myPick)return;const P=PACKS[myPick.pack]||{name:"Special pack"};const cards=myPick.cards||[];
  const seen=myPick.seen;myPick.seen=true;
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Pick a card"><div class="sheet">
    <div class="sheet-head"><div><span class="eyebrow">${esc(P.name)} · pick 1 of ${cards.length}</span><h2 style="font-size:22px">Keep one card</h2></div>
      <div class="row">${seen?"":`<button class="btn ghost" data-act="flipall">Reveal all</button>`}<button class="btn ghost" data-act="close">Later</button></div></div>
    <p class="muted" style="margin:0 0 12px;font-size:14px">Flip them all, then keep the one you want. The others are gone once you choose. You can come back later, but you can't open another special pack until you pick.</p>
    <div class="reveal-grid">${cards.map((x,i)=>{const sp=x.variant&&x.variant!=="base"?{variant:x.variant,print_run:x.print_run}:null;
      return`<div class="pickslot">${flipHTML(x,i,{open:seen,sp})}
      <button class="btn sm keep" data-act="keep" data-i="${i}">Keep${x.print_run?` · numbered /${x.print_run}`:""}</button></div>`}).join("")}</div></div></div>`;
}
function pickBanner(){return myPick&&signedIn()?`<section class="block"><div class="daily pickwait"><div><span class="eyebrow">Choice waiting</span><h3>Pick your card from the ${esc(PACKS[myPick.pack]?.name||"special pack")}</h3><p>${(myPick.cards||[]).length} cards are waiting. Keep one to finish opening it.</p></div><button class="btn" data-act="showpick">Choose</button></div></section>`:""}
function printRegistry(id){
  const pulled=SPECIALS.filter(x=>x.card_id===id&&x.status!=="retired");
  const rows=VARIANTS.filter(v=>v.id!=="base").map(v=>{const got=pulled.filter(x=>x.variant===v.id);const all=SPECIALS.filter(x=>x.card_id===id&&x.variant===v.id).length;
    return`<tr><td>${vpill(v.id)}</td><td class="r num">${v.print_run?`${all}/${v.print_run}`:fmt(got.length)}</td><td>${got.filter(x=>x.serial).sort((a,b)=>a.serial-b.serial).slice(0,12).map(x=>`<span class="num" title="${esc(pname(x.owner))}">#${x.serial}</span>`).join(" ")}${got.filter(x=>x.serial).length>12?" …":""}</td></tr>`}).join("");
  return VARIANTS.length?`<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Version</th><th class="r">Pulled</th><th>Serials out there</th></tr></thead><tbody>${rows}</tbody></table></div>`:"";
}
function showSpecial(sid){
  const sp=SPECIALS.find(x=>String(x.id)===String(sid));if(!sp)return;
  const d=card(sp.card_id),mine=sp.owner===session?.user.id&&sp.status==="owned",v=vinfo(sp.variant),val=spSell(sp);
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(d.name)} ${esc(v.name)}"><div class="sheet">
    <div class="sheet-head"><h2 style="font-size:22px">${esc(d.name)} ${vpill(sp.variant,sp)}</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <div class="detail">${cardHTML(d,{tag:"div",sp:spOf(sp)})}<div>
      <dl class="kvs"><dt>Version</dt><dd>${esc(v.name)}${sp.serial?` · serial ${serialTxt(sp)}`:""}</dd><dt>About</dt><dd>${esc(v.blurb||"")}</dd>
        <dt>Rarity</dt><dd>${TIERS[d.tier].name}</dd><dt>Owner</dt><dd>${sp.status==="retired"?"Retired":esc(pname(sp.owner))}${sp.status==="auction"?" (on auction)":""}</dd>
        <dt>Pulled by</dt><dd>${esc(pname(sp.pulled_by))} · ${esc(String(sp.pulled_at||"").slice(0,10))}</dd><dt>Quick-sell value</dt><dd>${fmt(val)}</dd></dl>
      ${mine?`<div style="display:flex;flex-direction:column;gap:12px">
        <button class="btn ghost" data-act="pin" data-k="s" data-id="${esc(sp.id)}" style="align-self:flex-start">${pinned("s",sp.id)?"Unpin from showcase":"Pin to showcase"}</button>
        <button class="btn ghost" data-act="sellsp" data-id="${esc(sp.id)}" style="align-self:flex-start">Quick sell · ${fmt(val)}${sp.serial?" (retires this serial)":""}</button>
        <form data-form="listsp" data-id="${esc(sp.id)}" class="panel" style="display:flex;flex-direction:column;gap:10px"><b style="font-family:var(--f-display)">List on auction</b>
          <div class="row"><label class="f" for="sStart">Starting bid<input type="number" id="sStart" name="start" min="1" value="${val*2}" style="width:120px"></label>
          <label class="f" for="sBuy">Buy now (optional)<input type="number" id="sBuy" name="buy" min="0" placeholder="—" style="width:130px"></label>
          <label class="f" for="sHours">Length<select id="sHours" name="hours"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option></select></label></div>
          <button class="btn" style="align-self:flex-start">List card</button></form></div>`:""}
      <p style="margin:12px 0 0"><button class="btn ghost sm" data-act="showcard" data-id="${esc(d.id)}">See all ${esc(d.name)} versions</button></p>
    </div></div></div></div>`;
}
function showDetail(id){
  const d=card(id),n=myCards[id]||0;
  $("#overlay").innerHTML=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(d.name)}"><div class="sheet">
    <div class="sheet-head"><h2 style="font-size:22px">${esc(d.name)}</h2><div class="row"><button class="btn ghost sm" data-act="copylink" data-link="${esc(location.origin+location.pathname+"#card/"+encodeURIComponent(d.id))}">Copy link</button><button class="btn ghost sm" data-act="close">Close</button></div></div>
    <div class="detail">${cardHTML(d,{tag:"div"})}<div>
      <dl class="kvs"><dt>Pool rank</dt><dd>#${d.rank} of ${ALL.length}${STARS.some(o=>o.display.toLowerCase()===d.name.toLowerCase())?' · <span class="tag lead">Star driver</span>':""}</dd><dt>Rarity</dt><dd>${TIERS[d.tier].name}</dd><dt>Score</dt><dd>${Number(d.score).toFixed(1)}</dd>
        ${(d.leagues||[]).map(l=>`<dt>${esc(l.name)} <span class="muted">(${esc(l.tier)})</span></dt><dd>P${l.pos} · ${fmt(l.pts)} pts</dd>`).join("")}
        ${(d.teams||[]).length>1?`<dt>Teams</dt><dd>${d.teams.map(esc).join(", ")}</dd>`:""}<dt>Wins / podiums</dt><dd>${d.wins} / ${d.pods}</dd><dt>You own</dt><dd>${n} base${mySpecials().filter(x=>x.card_id===id).length?` + ${mySpecials().filter(x=>x.card_id===id).length} special`:""}</dd>
        ${d.aliases&&d.aliases.length?`<dt>Also raced as</dt><dd>${d.aliases.map(esc).join(", ")}</dd>`:""}</dl>
      ${printRegistry(id)}
      ${driverOdds(d)}
      ${(()=>{const n=neededFor(id);return n?`<p style="margin:12px 0 0"><span class="tag need">Needed for your ${esc(n.team)} set (${n.have}/${n.of})</span></p>`:""})()}
      ${salesTable(id)}
      ${n?`<div style="display:flex;flex-direction:column;gap:12px">
        <div class="row"><button class="btn ghost" data-act="pin" data-k="b" data-id="${esc(id)}">${pinned("b",id)?"Unpin from showcase":"Pin to showcase"}</button><button class="btn ghost" data-act="sell" data-id="${esc(id)}">Quick sell · ${fmt(TIERS[d.tier].sell)}</button>${n>1?`<button class="btn ghost" data-act="selldupes" data-id="${esc(id)}">Sell ${n-1} duplicates · ${fmt(TIERS[d.tier].sell*(n-1))}</button>`:""}</div>
        <form data-form="list" data-id="${esc(id)}" class="panel" style="display:flex;flex-direction:column;gap:10px"><b style="font-family:var(--f-display)">List on auction</b>
          <div class="row"><label class="f" for="aStart">Starting bid<input type="number" id="aStart" name="start" min="1" value="${TIERS[d.tier].sell*2}" style="width:120px"></label>
          <label class="f" for="aBuy">Buy now (optional)<input type="number" id="aBuy" name="buy" min="0" placeholder="—" style="width:130px"></label>
          <label class="f" for="aHours">Length<select id="aHours" name="hours"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option></select></label></div>
          <button class="btn" style="align-self:flex-start">List card</button></form></div>`:""}
    </div></div></div></div>`;
}

/* ---------- events ---------- */
document.addEventListener("click",async e=>{
  const flip=e.target.closest("[data-flip]");if(flip){openFlip(flip);return}
  const t=e.target.closest("[data-act]");
  if(!t&&!signedIn())return;
  if(!t){const pl=e.target.closest("[data-player]");if(pl&&!pl.closest(".overlay"))return showProfile(pl.dataset.player);}
  if(!t){const sp=e.target.closest("[data-special]");if(sp&&!sp.closest(".overlay"))return showSpecial(sp.dataset.special);
    const c=e.target.closest("[data-card]");if(c&&!c.closest(".overlay"))showDetail(c.dataset.card);
    else if(e.target.classList.contains("overlay"))closeOverlay();return}
  if(t.tagName==="SELECT"||t.tagName==="INPUT")return;
  const a=t.dataset.act,id=t.dataset.id;
  const once=async fn=>{t.disabled=true;try{await fn()}finally{if(document.contains(t))t.disabled=false}};
  switch(a){
    case"signin":return signIn();
    case"signout":closeOverlay();return signOut();
    case"close":return closeOverlay();
    case"daily":return once(claimDaily);
    case"open":return once(()=>openPack(t.dataset.type));
    case"buy":return once(()=>buyPack(t.dataset.type));
    case"odds":return showOdds(t.dataset.type);
    case"bug":return showBug();
    case"diamondclock":return once(async()=>{try{await rpc("admin_restart_diamond_clock");await loadPublic();lastHTML="";render();toast("Diamond meter restarted. Back to the starting chance.")}catch(e){toast(errMsg(e))}});
    case"setadmin":return once(async()=>{try{await rpc("owner_set_admin",{p_user:id,p_on:t.dataset.on==="1"});await loadPeople();lastHTML="";render();toast("Admin removed.")}catch(e){toast(errMsg(e))}});
    case"bugset":return once(async()=>{try{await rpc("admin_bug_status",{p_id:+id,p_status:t.dataset.s});await loadMe();lastHTML="";render();toast(t.dataset.s==="fixed"?"Marked fixed. The reporter got a notification.":"Updated.")}catch(e){toast(errMsg(e))}});
    case"keep":return once(()=>keepCard(+t.dataset.i));
    case"showpick":return showPicker();
    case"tier":return once(()=>buyTier(+t.dataset.tier));
    case"board":return once(()=>buyBoard(id));
    case"coltier":view.colTier=+t.dataset.tier;return render();
    case"ranktier":view.rankTier=+t.dataset.tier;return render();
    case"raceleague":view.raceLeague=t.dataset.l;return render();
    case"trackmine":view.trackMine=!view.trackMine;return render();
    case"flipall":{const fl=[...document.querySelectorAll("[data-flip]:not(.open)")];let i=0;const next=()=>{if(i>=fl.length)return;const f=fl[i++];
      if(f.classList.contains("big")){setTimeout(()=>openFlip(f,next),350)}else{openFlip(f);setTimeout(next,160)}};next();return}
    case"sell":return once(()=>quickSell(id,1));
    case"sellsp":if(t.dataset.confirm)return once(()=>quickSellSpecial(id));t.dataset.confirm=1;t.textContent="Tap again to sell";t.classList.add("warn");return;
    case"showcard":return showDetail(id);
    case"morecards":view.colN+=24;return render();
    case"morespecial":view.spN+=12;return render();
    case"moreraces":view.raceN+=12;return render();
    case"moretracks":view.trackN+=12;return render();
    case"setsall":view.setsAll=!view.setsAll;return render();
    case"rankall":view.rankAll=!view.rankAll;render();if(!view.rankAll)window.scrollTo(0,0);return;
    case"notices":return showNotices();
    case"admplayer":return showAdminPlayer(id);
    case"admlock":return once(()=>adminAct("admin_lock",{p_user:id,p_locked:t.dataset.v==="1",p_note:""},r=>r?"Account locked":"Account unlocked",id));
    case"account":return showAccount();
    case"aucneed":view.aucNeed=!view.aucNeed;return render();
    case"collsort":view.collSort=t.dataset.k;return render();
    case"copylink":try{await navigator.clipboard.writeText(t.dataset.link);toast("Link copied")}catch{prompt?.("Copy this link",t.dataset.link)}return;
    case"pin":return once(()=>togglePin(t.dataset.k,t.dataset.k==="s"?+id:id));
    case"tradein":return once(async()=>{const r=await act("trade_in",{p_tier:+t.dataset.tier});if(r){await loadPeople();showReveal("Trade-in",r)}});
    case"claimset":return once(async()=>{const r=await act("claim_set",{p_team:id});if(r){await loadPeople();toast(`Set complete! +${fmt(r.coins)} tokens`)}});
    case"selldupes":return once(()=>quickSell(id,(myCards[id]||1)-1));
    case"buynow":return once(()=>placeBid(id,0,true));
    case"cancel":return once(()=>cancelAuction(id));
    case"claim":return once(()=>claimRace(id));
    case"claimtrack":return once(()=>claimTrack(id));
    case"claimall":return once(claimAll);
    case"ignok":return once(()=>decideIgn(id,true));
    case"ignno":return once(()=>decideIgn(id,false));
    case"revoke":return once(async()=>{try{await rpc("revoke_ign",{p_user:id});await loadPeople();toast("IGN revoked");render()}catch(err){toast(errMsg(err))}});
    case"delstar":return once(async()=>{const {error}=await sb.from("driver_overrides").delete().eq("name",id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Removed. Card pool rebuilt.")});
    case"unremove":return once(async()=>{const {error}=await sb.from("removed_players").delete().eq("name",id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Brought back. Card pool rebuilt.")});
    case"deldteam":return once(async()=>{const {error}=await sb.from("driver_teams").delete().eq("name",id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Removed. Card pool rebuilt.")});
    case"delalias":return once(async()=>{const {error}=await sb.from("team_aliases").delete().eq("alias",id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Removed. Card pool rebuilt.")});
    case"rebuild":return once(()=>rebuildCatalog(false));
    case"syncraces":return once(async()=>{try{const m=await rpc("admin_sync_races");toast(m+". New races appear within about 30 minutes.");await loadPublic();render()}catch(err){toast(errMsg(err))}});
    case"syncfeed":return once(async()=>{try{const m=await rpc("admin_sync_tracks");toast(m);await loadPublic();render()}catch(err){toast(errMsg(err))}});
    case"delrace":if(t.dataset.confirm)return once(()=>adminDo(sb.from("races").delete().eq("id",id),"Race deleted"));t.dataset.confirm=1;t.textContent="Confirm delete";t.classList.add("warn");return;
    case"delleague":if(t.dataset.confirm)return once(async()=>{const {error}=await sb.from("leagues").delete().eq("id",id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("League removed. Card pool updated.")});t.dataset.confirm=1;t.textContent="Confirm remove";t.classList.add("warn");return;
  }
});
document.addEventListener("change",async e=>{
  const t=e.target;
  if(t.dataset.act==="colsort"){view.colSort=t.value;render()}
  else if(t.dataset.act==="rankleague"){view.rankLeague=t.value;render()}
  else if(t.dataset.act==="setseries"){const {error}=await sb.from("leagues").update({series:t.value.trim(),updated_at:new Date().toISOString()}).eq("id",t.dataset.id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Series saved. Card pool updated.")}
  else if(t.dataset.act==="setrank"){const {error}=await sb.from("leagues").update({tier_rank:+t.value,updated_at:new Date().toISOString()}).eq("id",t.dataset.id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Order changed. Card pool updated.")}
  else if(t.dataset.act==="settier"){const {error}=await sb.from("leagues").update({tier:t.value,updated_at:new Date().toISOString()}).eq("id",t.dataset.id);if(error)return toast(errMsg(error));await loadPublic();await rebuildCatalog(true);toast("Tier changed. Card pool updated.")}
});
document.addEventListener("input",e=>{
  const t=e.target;
  if(t.dataset.act==="rankq"){view.rankQ=t.value;render()}
  else if(t.dataset.act==="admq"){view.admQ=t.value;render()}
  else if(t.dataset.act==="trackq"){view.trackQ=t.value;render()}
  if(t.id==="lrows"){const n=parseStandings(t.value).length;const p=$("#parsePreview");if(p)p.textContent=n?`${n} drivers found`:""}
});
document.addEventListener("submit",async e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();const k=f.dataset.form;const d=new FormData(f);
  const btn=f.querySelector("button:not([type=button])");if(btn)btn.disabled=true;
  try{
    if(k==="bid")await placeBid(f.dataset.id,+d.get("amt"),false);
    else if(k==="list")await listAuction(f.dataset.id,+d.get("start"),+d.get("buy"),+d.get("hours"));
    else if(k==="listsp")await listSpecial(f.dataset.id,+d.get("start"),+d.get("buy"),+d.get("hours"));
    else if(k==="star"){const nm=String(d.get("name")||"").trim();if(!/^[A-Za-z0-9_]{1,16}$/.test(nm)){toast("Enter a Minecraft IGN.")}else{
      const {error}=await sb.from("driver_overrides").upsert({name:nm.toLowerCase(),display:nm,min_tier:+d.get("tier"),ovr:+d.get("ovr")||null,team:String(d.get("team")||"").trim(),updated_at:new Date().toISOString()},{onConflict:"name"});
      if(error)toast(errMsg(error));else{f.reset();await loadPublic();await rebuildCatalog(true);toast(`${nm} saved. Card pool rebuilt.`)}}}
    else if(k==="admgrant")await adminAct("admin_grant",{p_user:f.dataset.id,p_coins:Math.trunc(+d.get("coins")||0),p_pack:String(d.get("pack")||""),p_qty:Math.trunc(+d.get("qty")||0),p_note:String(d.get("note")||"").trim()},r=>`Sent: ${r}`,f.dataset.id);
    else if(k==="admtake"){const v=String(d.get("card")||"");if(!v)toast("Pick a card first.");else await adminAct("admin_take_card",{p_user:f.dataset.id,p_card:v.startsWith("b:")?v.slice(2):"",p_special:v.startsWith("s:")?+v.slice(2):null,p_note:String(d.get("note")||"").trim()},r=>`Took ${r}`,f.dataset.id)}
    else if(k==="addadmin"){const u=String(d.get("user")||"");if(!u)toast("Pick a player first.");else try{await rpc("owner_set_admin",{p_user:u,p_on:true});await loadPeople();lastHTML="";render();toast(`${pname(u)} is now an admin.`)}catch(err){toast(errMsg(err))}}
    else if(k==="bug"){const body=String(d.get("body")||"").trim();try{await rpc("report_bug",{p_body:body,p_page:location.hash||"#packs",p_device:deviceInfo()});closeOverlay();await loadMe();toast("Thanks! Your report was sent to the admin.")}catch(err){toast(errMsg(err))}}
    else if(k==="rmplayer"){const nm=String(d.get("name")||"").trim().toLowerCase();if(!nm)toast("Type a Minecraft name.");else{
      const c=ALL.find(x=>x.name.toLowerCase()===nm||(x.aliases||[]).includes(nm));
      const names=[...new Set([nm,...(c?[c.name.toLowerCase(),...(c.aliases||[])]:[])])];
      const {error}=await sb.from("removed_players").upsert(names.map(n=>({name:n,note:String(d.get("note")||"").trim()||(c&&n!==nm?`same player as ${nm}`:"")})),{onConflict:"name"});
      if(error)toast(errMsg(error));else{f.reset();await loadPublic();await rebuildCatalog(true);toast(`Removed ${c?c.name:nm}${names.length>1?` and ${names.length-1} other name${names.length>2?"s":""}`:""}. Card pool rebuilt.`)}}}
    else if(k==="dteam"){const nm=String(d.get("name")||"").trim(),tm=String(d.get("team")||"").trim();if(!nm||!tm)toast("Fill in the driver and the team.");else{
      const c=ALL.find(x=>x.name.toLowerCase()===nm.toLowerCase()||(x.aliases||[]).includes(nm.toLowerCase()));
      const {error}=await sb.from("driver_teams").upsert({name:(c?c.name:nm).toLowerCase(),display:c?c.name:nm,team:tm,updated_at:new Date().toISOString()},{onConflict:"name"});
      if(error)toast(errMsg(error));else{f.reset();await loadPublic();await rebuildCatalog(true);toast(`${c?c.name:nm} is now on ${tm}. Card pool rebuilt.`)}}}
    else if(k==="teamalias"){const al=String(d.get("alias")||"").trim(),tm=String(d.get("team")||"").trim();if(!al||!tm)toast("Fill in both team names.");else{
      const {error}=await sb.from("team_aliases").upsert({alias:al.toLowerCase(),team:tm},{onConflict:"alias"});if(error)toast(errMsg(error));else{f.reset();await loadPublic();await rebuildCatalog(true);toast(`${al} now counts as ${tm}. Card pool rebuilt.`)}}}
    else if(k==="merge"){try{await rpc("admin_merge_names",{p_old:String(d.get("old")||""),p_current:String(d.get("cur")||"")});f.reset();await loadPublic();await rebuildCatalog(true);toast("Merged. The card pool is rebuilt.")}catch(err){toast(errMsg(err))}}
    else if(k==="ign")await requestIgn(d.get("ign"));
    else if(k==="league")await saveLeague(f);
    else if(k==="race")await postRace(f);
    else if(k==="track")await saveTrack(f);
    else if(k==="cfg")await adminDo(sb.from("site_config").update({discord_invite:String(d.get("invite")||"").trim(),ign_note:String(d.get("note")||"").trim()}).eq("id",1),"Saved");
  }finally{if(btn&&document.contains(btn))btn.disabled=false}
});
/* shrink the header once you scroll down */
{let ticking=false;const bar=document.querySelector("header.bar");
 const upd=()=>{ticking=false;const y=window.scrollY;if(y>60)bar.classList.add("scrolled");else if(y<20)bar.classList.remove("scrolled")};
 window.addEventListener("scroll",()=>{if(!ticking){ticking=true;requestAnimationFrame(upd)}},{passive:true});upd();}
window.addEventListener("hashchange",()=>{const before=tab;tab=parseHash();lastHTML="";render();if(before!==tab||!pendingOpen)window.scrollTo(0,0)});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeOverlay()});
setInterval(()=>{
  let ended=false;
  document.querySelectorAll("[data-ends]").forEach(el=>{const ms=+el.dataset.ends-Date.now();el.textContent=dur(ms);el.classList.toggle("late",ms<3e5);if(ms<=0)ended=true});
  document.querySelectorAll("[data-until]").forEach(el=>{el.textContent=dur(+el.dataset.until-Date.now())});
  if(tab==="packs"&&signedIn()&&me.last_daily_at&&Math.abs(Date.now()-dailyNext())<1200){lastHTML="";render()}
  if(ended&&sb){loadAuctions().then(()=>loadMe()).then(()=>{lastHTML="";render()})}
},1000);

/* ---------- boot ---------- */
async function boot(){
  render();if(!sb)return;
  const {data}=await sb.auth.getSession();session=data.session;
  try{await loadPublic();await loadMe()}catch(e){toast(errMsg(e))}
  booted=true;
  if(location.hash.includes("access_token")||location.search.includes("code="))history.replaceState(null,"",location.pathname+"#packs");
  render();
  sb.auth.onAuthStateChange(async(ev,s)=>{
    const changed=(s?.user?.id||null)!==(session?.user?.id||null);session=s;
    if(changed){await loadMe();await loadPeople();lastHTML="";render();if(ev==="SIGNED_IN"&&me&&me.opened===0)toast(`Welcome, ${me.discord_name}! Your Starter Kit and 250 tokens are under Packs.`)}
  });
  /* live updates: shared tables are batched (one reload per few seconds, not one per event),
     and personal tables only stream this player's own rows */
  const later={};const soon=(k,fn,ms=4000)=>{if(later[k])return;later[k]=setTimeout(async()=>{later[k]=null;if(document.hidden){dirty[k]=fn;return}try{await fn();render()}catch{}},ms)};
  const dirty={};
  document.addEventListener("visibilitychange",async()=>{if(document.hidden)return;const fns=Object.values(dirty);for(const k in dirty)delete dirty[k];if(!fns.length)return;try{await Promise.all(fns.map(f=>f()));render()}catch{}});
  sb.channel("shared").on("postgres_changes",{event:"*",schema:"public",table:"auctions"},()=>soon("auc",async()=>{await Promise.all([loadAuctions(),loadSales()]);if(session)await loadMe()},2500))
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"pull_log"},()=>soon("pulls",loadPulls,5000))
    .on("postgres_changes",{event:"*",schema:"public",table:"special_cards"},()=>soon("specials",loadSpecials,8000))
    .subscribe();
  let mine=null;
  const watchMine=()=>{if(mine){sb.removeChannel(mine);mine=null}if(!session)return;const uid=session.user.id;
    mine=sb.channel("me-"+uid)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"notices",filter:`user_id=eq.${uid}`},async p=>{await loadNotices();if(p.new?.body)toast(p.new.body);await loadMe();render()})
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"profiles",filter:`id=eq.${uid}`},()=>soon("me",loadMe,1500))
      .on("postgres_changes",Object.assign({event:"*",schema:"public",table:"ign_requests"},me?.is_admin?{}:{filter:`user_id=eq.${uid}`}),()=>soon("me",loadMe,1500))
      .subscribe()};
  watchMine();sb.auth.onAuthStateChange(()=>setTimeout(watchMine,500));
  setInterval(async()=>{if(document.hidden||tab!=="auctions")return;try{await loadAuctions();render()}catch{}},60000);
}
boot();
