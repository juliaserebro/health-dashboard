import { useState, useEffect, useRef, useCallback } from "react";

// ── LIVE DATA (Fri 12 Jun 2026, 14:20 Israel) ─────────────────────────────
const SUPA_URL = "https://itdrrugsztpqkafxfljt.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0ZHJydWdzenRwcWthZnhmbGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5OTkwMzUsImV4cCI6MjA5NjU3NTAzNX0.n2iIiMxb7Lf-8nbNk79Pzhnp0E6qRzfsW51CvipQjs8";
// ── USER RESOLUTION: demo mode vs owner ───────────────────────────────────
// Default visitors (CV/LinkedIn) land on a read-only demo profile (Maya).
// Julia accesses her real data via ?u=<OWNER_KEY>.
// Private owner key — do not publish this URL anywhere public.
// NOTE: this is obscurity, not real auth — the anon key in this file can still
// read the DB. Acceptable for a single-user portfolio app; real Supabase Auth
// is required before any multi-user launch.
const OWNER_KEY = "jls-Vq83kTz5mPn2wXr9";
const resolveUser = () => {
  const params = new URLSearchParams(window.location.search);
  // ?demo=1 forces the demo view even on a device with owner mode persisted —
  // lets the owner preview exactly what a visitor sees.
  if (params.get("demo") === "1") {
    return { uid: "demo_maya", isDemo: true };
  }
  // Owner mode persists per TAB (sessionStorage), not per device: the Google
  // OAuth redirect strips ?u= but returns to the same tab, so login survives —
  // while a plain-URL visit in any new tab (including the owner's own devices)
  // always shows the demo.
  try{ localStorage.removeItem("owner_mode"); }catch(e){} // migrate away from old device-wide flag
  if (params.get("u") === OWNER_KEY) {
    try{
      sessionStorage.setItem("owner_mode", OWNER_KEY);
      // Also remember for the INSTALLED app: a home-screen PWA launches at the
      // bare start_url in a fresh session, so standalone mode (below) falls back
      // to this device flag. Browser tabs keep ignoring it — plain URL = demo.
      localStorage.setItem("owner_device", OWNER_KEY);
    }catch(e){}
    return { uid: "00000000-0000-0000-0000-000000000001", isDemo: false };
  }
  // Installed PWA (standalone display mode): trust the device flag set the
  // last time the private link was opened, since start_url can't carry ?u=.
  try{
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    if (standalone && localStorage.getItem("owner_device") === OWNER_KEY) {
      sessionStorage.setItem("owner_mode", OWNER_KEY);
      return { uid: "00000000-0000-0000-0000-000000000001", isDemo: false };
    }
  }catch(e){}
  // A Google OAuth callback (token or oauth error in the URL hash) can ONLY come
  // from an owner sync — demo hides Sync entirely. Google returns to the bare
  // redirect URI (no ?u=), and on a PWA / new-tab return sessionStorage may be
  // empty, so trust the callback itself as proof of owner mode and re-assert it.
  // Without this the returned token gets discarded and Google must be reconnected
  // on every sync.
  try{
    const h = window.location.hash || "";
    if (/[#&](access_token|error)=/.test(h)) {
      sessionStorage.setItem("owner_mode", OWNER_KEY);
      return { uid: "00000000-0000-0000-0000-000000000001", isDemo: false };
    }
  }catch(e){}
  try{
    if (sessionStorage.getItem("owner_mode") === OWNER_KEY) {
      return { uid: "00000000-0000-0000-0000-000000000001", isDemo: false };
    }
  }catch(e){}
  return { uid: "demo_maya", isDemo: true };
};
const { uid: UID, isDemo: IS_DEMO } = resolveUser();

// Small non-blocking toast for demo-mode write attempts (vanilla DOM — usable
// from anywhere including the supa() helper outside React)
let _demoToastAt = 0;
function showDemoToast(){
  if(Date.now()-_demoToastAt<2500) return;
  _demoToastAt = Date.now();
  const el = document.createElement("div");
  el.textContent = "You're viewing a demo — data can't be changed here.";
  el.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1917;color:#fff;font-family:Inter,sans-serif;font-size:13px;padding:10px 18px;border-radius:10px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transition:opacity .25s";
  document.body.appendChild(el);
  requestAnimationFrame(()=>{el.style.opacity="1";});
  setTimeout(()=>{el.style.opacity="0";setTimeout(()=>el.remove(),300);},2200);
}

// SUPABASE SETUP SQL — run once in Supabase SQL editor
/*
-- Run once in Supabase SQL editor

-- profiles table (uid MUST be text, not uuid — app uses "julia" as UID)
-- If you get "string did not match expected pattern" errors, run these first:
-- ALTER TABLE profiles ALTER COLUMN uid TYPE text;
-- (or drop and recreate if it was created with uid uuid)
create table if not exists profiles (
  uid text primary key,
  name text,
  birth_date date,
  gender text,
  goals jsonb,
  activity_mapping jsonb,
  activity_targets jsonb,
  step_target integer,
  protein_target integer,
  active_days_target integer,
  height_cm numeric,
  weight_kg numeric,
  body_fat_pct numeric,
  body_fat_target_pct numeric,
  supplements jsonb,
  health_notes text,
  workout_plan text,
  cycle_tracking boolean,
  timezone text,
  fitbit_connected boolean,
  onboarding_complete boolean
);
alter table profiles enable row level security;
create policy "Allow all for now" on profiles for all using (true) with check (true);

-- fitness_cache table (RLS required — Supabase security alert)
create table if not exists fitness_cache (
  user_id text primary key,
  data jsonb,
  synced_at timestamptz
);
alter table fitness_cache enable row level security;
create policy "Allow all for now" on fitness_cache for all using (true) with check (true);
*/

// ── ACTIVITY CATEGORY MAPPING ────────────────────────────────────────────
const DEFAULT_ACTIVITY_MAPPING = {
  "strength training":"strength","weightlifting":"strength","powerlifting":"strength",
  "boot camp":"strength","circuit training":"strength","crossfit":"strength","core training":"strength",
  "yoga":"mobility","pilates":"mobility","tai chi":"mobility","stretching":"mobility","flexibility":"mobility","barre":"mobility","dance":"mobility","qigong":"mobility",
  "run":"cardio","walk":"cardio","hike":"cardio","bike":"cardio","cycling":"cardio","elliptical":"cardio",
  "treadmill":"cardio","swim":"cardio","swimming":"cardio","rowing machine":"cardio","stair climber":"cardio",
  "hiit":"cardio","interval workout":"cardio","aerobics":"cardio","kickboxing":"cardio",
  "dancing":"cardio","cross country skiing":"cardio","skiing":"cardio","snowboarding":"cardio",
  "rollerblading":"cardio","surfing":"cardio","paddleboarding":"cardio","kayaking":"cardio",
  "canoeing":"cardio","golf":"cardio","tennis":"cardio","martial arts":"cardio",
  "indoor climbing":"cardio","outdoor workout":"cardio","sports":"cardio",
  "gym":"strength","weightlifting":"strength",
  "weight training":"strength","resistance training":"strength","weights":"strength",
  "functional training":"strength","calisthenics":"strength","bodyweight training":"strength",
  "functional strength training":"strength","strength and conditioning":"strength"
  // "workout" intentionally omitted — requires user mapping
};

function getActivityCategory(activityType, userMapping) {
  const key = (activityType||"").toLowerCase();
  if (userMapping && userMapping[key]) return userMapping[key];
  return DEFAULT_ACTIVITY_MAPPING[key] || "uncategorized";
}

// Active timezone — set from the loaded profile, falls back to Asia/Jerusalem.
// Used by the many standalone metric components that compute Israel-local dates.
let ACTIVE_TZ = "Asia/Jerusalem"; // overwritten on profile load via setActiveTz()
function setActiveTz(tz){ if(tz) ACTIVE_TZ = tz; }
function getTz(){ return ACTIVE_TZ || "Asia/Jerusalem"; }

// Week start preference — "sunday" (default, Israeli convention) or "monday".
let ACTIVE_WEEK_START = "sunday"; // overwritten on profile load via setActiveWeekStart()
function setActiveWeekStart(ws){ if(ws==="sunday"||ws==="monday") ACTIVE_WEEK_START = ws; }
// Days back from `dow` (0=Sun..6=Sat) to the configured week start
function daysSinceWeekStart(dow){ return ACTIVE_WEEK_START==="monday" ? (dow+6)%7 : dow; }

// Returns the sleep record that counts as "last night" for a given fitbitData object.
// Sleep records use the wake-up date. We only accept today's date as current;
// anything older means last night's data hasn't synced yet.
function getLastNightSleep(fitbitData, tz) {
  const todayStr = new Date().toLocaleDateString("en-CA", {timeZone: tz || getTz()});
  const records = [...(fitbitData.sleep || [])].sort((a, b) => b.date.localeCompare(a.date));
  return records[0]?.date === todayStr ? records[0] : null;
}

// Returns true when the most recent sleep is stale: past 2pm local time and the
// latest sleep record is from 2 or more calendar days ago.
function isSleepDataStale(fitbitData, tz) {
  const tzResolved = tz || getTz();
  const records = [...(fitbitData.sleep || [])].sort((a, b) => b.date.localeCompare(a.date));
  const latest = records[0];
  if (!latest) return true;
  const localHour = parseInt(new Date().toLocaleString("en-CA", {timeZone: tzResolved, hour: "numeric", hour12: false}));
  const todayStr = new Date().toLocaleDateString("en-CA", {timeZone: tzResolved});
  const daysDiff = Math.floor((new Date(todayStr + "T12:00:00") - new Date(latest.date + "T12:00:00")) / 864e5);
  return localHour >= 14 && daysDiff >= 2;
}

// Safe cycle-day helper — avoids UTC-midnight vs local-midnight bug.
// Returns 1 on the start date, 28 on day 27, wraps at 28.
function calcCycleDay(startDateStr) {
  const nowStr = new Date().toLocaleDateString("en-CA", {timeZone: getTz()});
  const d1 = new Date(startDateStr + "T12:00:00");
  const d2 = new Date(nowStr + "T12:00:00");
  const diff = Math.round((d2 - d1) / 864e5);
  if (diff < 0) return 1;
  return (diff % 28) + 1;
}

// Dr. Shira's clinical model: luteal phase is biologically fixed at 14 days;
// follicular phase absorbs all cycle-length variability.
// Accepts an array of period start date strings (most recent first) and avgPeriodLength.
// Can also be called with a single date string for backward compat (wraps to array).
function calculateCyclePhase(periodStartDatesOrStr, avgPeriodLength=5) {
  const periodStartDates = Array.isArray(periodStartDatesOrStr)
    ? periodStartDatesOrStr
    : (periodStartDatesOrStr ? [periodStartDatesOrStr] : []);
  const avgPL = avgPeriodLength || 5;

  if (!periodStartDates || periodStartDates.length === 0) {
    return {phase:'unknown',cycleDay:null,nextPeriod:null,confidence:'no_data',variability:'insufficient_data',avgCycleLength:28,avgPeriodLength:avgPL,cyclesUsedForCalculation:0};
  }

  const sorted = [...periodStartDates].filter(Boolean).sort((a,b) => new Date(b)-new Date(a));
  const lastPeriodStart = sorted[0];

  // Gap lengths between consecutive period starts
  const cycleLengths = [];
  for (let i = 0; i < sorted.length-1; i++) {
    const diff = Math.round((new Date(sorted[i])-new Date(sorted[i+1])) / 864e5);
    if (diff > 10 && diff < 90) cycleLengths.push(diff); // sanity bounds
  }

  let avgCycleLength = 28;
  let confidence = 'low';
  let variability = 'insufficient_data';

  if (cycleLengths.length === 0) {
    confidence = 'low';
  } else if (cycleLengths.length === 1) {
    avgCycleLength = cycleLengths[0];
    confidence = 'low';
  } else {
    avgCycleLength = Math.round(cycleLengths.reduce((a,b)=>a+b,0) / cycleLengths.length);
    const variance = cycleLengths.reduce((sum,len)=>sum+Math.pow(len-avgCycleLength,2),0) / cycleLengths.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 7) {
      variability = 'highly_irregular';
      confidence = 'very_low';
    } else if (stdDev > 4) {
      variability = 'irregular';
      confidence = 'moderate';
    } else {
      variability = 'regular';
      confidence = cycleLengths.length >= 3 ? 'high' : 'moderate';
    }
  }

  const today = new Date();
  const lastPeriod = new Date(lastPeriodStart+"T12:00:00");
  const daysSince = Math.floor((today - lastPeriod) / 864e5) + 1;

  // Fixed 14-day luteal; ovulatory window is 2 days before luteal; follicular fills the rest
  const lutealStartDay = avgCycleLength - 14 + 1;
  const ovulatoryStartDay = lutealStartDay - 2;
  const follicularStartDay = avgPL + 1;

  // LATE HANDLING: once we pass the expected cycle length WITHOUT a new period
  // being logged, do NOT wrap into a phantom day-1. The person is simply late —
  // hold them in extended luteal and report how many days overdue. Only a new
  // logged period start begins a new cycle.
  // calendarDaysSince = full days elapsed since the period start (start day = 0).
  // Period is DUE when this equals avgCycleLength; each day beyond that is 1 late.
  const calendarDaysSince = daysSince - 1;
  const daysLate = calendarDaysSince - avgCycleLength;
  const isLate = daysLate > 0;
  const cycleDay = isLate ? daysSince : ((daysSince - 1) % avgCycleLength) + 1;

  let phase;
  if (isLate)                            phase = 'luteal'; // late = still pre-menstrual
  else if (cycleDay <= avgPL)            phase = 'menstrual';
  else if (cycleDay < ovulatoryStartDay) phase = 'follicular';
  else if (cycleDay < lutealStartDay)    phase = 'ovulatory';
  else                                    phase = 'luteal';

  // Next period: the most recent expected date that is today or in the future,
  // unless late — then it's the overdue expected date (kept in the past).
  const cyclesElapsed = isLate ? 0 : Math.floor((daysSince - 1) / avgCycleLength);
  const nextPeriod = new Date(lastPeriod);
  nextPeriod.setDate(lastPeriod.getDate() + avgCycleLength * (cyclesElapsed + 1));

  return {phase, cycleDay, isLate, daysLate, nextPeriod:nextPeriod.toISOString().slice(0,10), avgCycleLength, avgPeriodLength:avgPL, confidence, variability, cyclesUsedForCalculation:cycleLengths.length};
}

function getPhaseDisplayText(result) {
  const labels = {menstrual:'Menstrual',follicular:'Follicular',ovulatory:'Ovulatory',luteal:'Luteal',unknown:'Not enough data yet'};
  const prefix = {no_data:'',low:'Estimated — ',moderate:'Likely ',high:'',very_low:'Uncertain — '};
  if (result.isLate) return `Period late by ${result.daysLate} day${result.daysLate!==1?'s':''}`;
  return (prefix[result.confidence]||'') + (labels[result.phase]||result.phase);
}

async function saveCycleDates(newDate, avgPeriodLen=5) {
  let existing = null;
  try { existing = await supa("GET","cycle_logs",null,`uid=eq.${UID}&limit=1`); } catch(e){}
  const existingDates = existing?.[0]?.period_start_dates || [];
  const existingPeriodLen = existing?.[0]?.avg_period_length || avgPeriodLen;
  const merged = [...new Set([...existingDates, newDate])]
    .sort((a,b)=>new Date(b)-new Date(a))
    .slice(0,6);
  const cycleLengths = [];
  for(let i=0;i<merged.length-1;i++){
    cycleLengths.push(Math.round((new Date(merged[i])-new Date(merged[i+1]))/864e5));
  }
  const avgCycleLength = cycleLengths.length ? Math.round(cycleLengths.reduce((a,b)=>a+b,0)/cycleLengths.length) : 28;
  let cycle_variability = 'insufficient_data';
  if (cycleLengths.length >= 2) {
    const variance = cycleLengths.reduce((s,l)=>s+Math.pow(l-avgCycleLength,2),0)/cycleLengths.length;
    const std = Math.sqrt(variance);
    cycle_variability = std > 7 ? 'highly_irregular' : std > 4 ? 'irregular' : 'regular';
  }
  await supa("POST","cycle_logs",{uid:UID,period_start_dates:merged,avg_cycle_length:avgCycleLength,avg_period_length:existingPeriodLen,last_period_start:merged[0]},"on_conflict=uid");
  return {merged, avgCycleLength, cycle_variability};
}

async function supa(method, table, body, query) {
  // Demo mode is strictly read-only — one guard covers every write path,
  // including any we forget to guard individually.
  if (IS_DEMO && method !== "GET") { showDemoToast(); return null; }
  let url, hdrs, fetchOpts;
  if (method === "GET") {
    const q = [query, "apikey="+SUPA_KEY].filter(Boolean).join("&");
    url = SUPA_URL + "/rest/v1/" + table + "?" + q;
    hdrs = {"Accept": "application/json"};
    fetchOpts = {method:"GET", headers:hdrs};
  } else {
    url = SUPA_URL + "/rest/v1/" + table + (query ? "?" + query : "");
    hdrs = {
      "Content-Type": "application/json",
      "apikey": SUPA_KEY,
      "Authorization": "Bearer " + SUPA_KEY,
      "Accept": "application/json"
    };
    // Use merge-duplicates for upserts (on_conflict), return=minimal to avoid large responses
    if (query&&query.includes("on_conflict")) {
      hdrs["Prefer"] = "resolution=merge-duplicates,return=minimal";
    } else if (method==="POST"||method==="PATCH") {
      hdrs["Prefer"] = "return=representation";
    }
    fetchOpts = {method, headers:hdrs, body:body?JSON.stringify(body):undefined, mode:"cors", credentials:"omit"};
  }
  let res;
  try {
    res = await fetch(url, fetchOpts);
  } catch(networkErr) {
    throw new Error("Network/CORS: " + networkErr.message);
  }
  const txt = await res.text();
  if (!res.ok) { throw new Error(table+" "+res.status+": "+txt.slice(0,80)); }
  if (!txt) return null;
  return JSON.parse(txt);
}

// Date key in the active timezone (NOT UTC — otherwise anything logged between
// midnight and ~3am Israel time lands on the previous day and disagrees with
// every other date computation in the app).
function tkey(d) { return (d||new Date()).toLocaleDateString("en-CA",{timeZone:getTz()}); }




// ── FITBIT SEED DATA ─────────────────────────────────────────────────────
// Updated: 2026-06-14. Auto-upserts to Supabase fitness_cache on load.
// Each sync session: only this block changes. App reads from Supabase state.
const FITBIT_SEED = {"sleep":[{"date":"2026-06-16","bedtime":"01:20","total":503,"deep":112,"rem":97,"light":294,"awake":0},{"date":"2026-06-15","bedtime":"00:44","total":447,"deep":106,"rem":107,"light":234,"awake":0},{"date":"2026-06-14","bedtime":"01:16","total":395,"deep":92,"rem":96,"light":207,"awake":7},{"date":"2026-06-13","bedtime":"01:15","total":420,"deep":105,"rem":104,"light":211,"awake":9},{"date":"2026-06-12","bedtime":"01:27","total":399,"deep":102,"rem":93,"light":203,"awake":9},{"date":"2026-06-11","bedtime":"00:47","total":430,"deep":89,"rem":120,"light":221,"awake":4},{"date":"2026-06-10","bedtime":"01:22","total":434,"deep":118,"rem":116,"light":200,"awake":5},{"date":"2026-06-09","bedtime":"00:10","total":476,"deep":128,"rem":118,"light":230,"awake":7},{"date":"2026-06-08","bedtime":"23:46","total":358,"deep":97,"rem":74,"light":187,"awake":5},{"date":"2026-06-07","bedtime":"00:41","total":461,"deep":121,"rem":100,"light":240,"awake":23},{"date":"2026-06-06","bedtime":"01:38","total":440,"deep":101,"rem":114,"light":225,"awake":77},{"date":"2026-06-05","bedtime":"01:58","total":479,"deep":110,"rem":118,"light":251,"awake":10},{"date":"2026-06-04","bedtime":"02:40","total":449,"deep":100,"rem":109,"light":240,"awake":8},{"date":"2026-06-03","bedtime":"02:07","total":473,"deep":126,"rem":89,"light":257,"awake":10}],"naps":[{"date":"2026-06-08","start":"13:10","total":16,"deep":7,"light":9}],"steps":[{"date":"2026-06-03","steps":5473},{"date":"2026-06-04","steps":5912},{"date":"2026-06-05","steps":6964},{"date":"2026-06-06","steps":6676},{"date":"2026-06-07","steps":7361},{"date":"2026-06-08","steps":11972},{"date":"2026-06-09","steps":8461},{"date":"2026-06-10","steps":10033},{"date":"2026-06-11","steps":13717},{"date":"2026-06-12","steps":3719},{"date":"2026-06-13","steps":6574},{"date":"2026-06-14","steps":7649},{"date":"2026-06-15","steps":7915},{"date":"2026-06-16","steps":6400}],"workouts":[{"date":"2026-06-15","type":"workout","duration_min":50,"avg_hr":79},{"date":"2026-06-14","type":"yoga","duration_min":60,"avg_hr":99},{"date":"2026-06-12","type":"yoga","duration_min":91,"avg_hr":99},{"date":"2026-06-11","type":"workout","duration_min":38,"avg_hr":94},{"date":"2026-06-11","type":"elliptical","duration_min":24,"avg_hr":109},{"date":"2026-06-11","type":"run","duration_min":23,"avg_hr":119},{"date":"2026-06-11","type":"walk","duration_min":null,"avg_hr":null},{"date":"2026-06-08","type":"workout","duration_min":25,"avg_hr":68},{"date":"2026-06-08","type":"walk","duration_min":60,"avg_hr":99},{"date":"2026-06-07","type":"yoga","duration_min":60,"avg_hr":101},{"date":"2026-06-05","type":"yoga","duration_min":96,"avg_hr":null}],"synced_at":"2026-06-26T08:00:00+03:00"};



// ── SHARE CARD ────────────────────────────────────────────────────────────
// Draws a branded 1080×1080 stats card on a canvas and opens the native share
// sheet (mobile) or downloads the PNG (desktop). No screenshot libraries.
async function shareStatsCard({heading, subheading, rows, footer}){
  const W=1080,H=1080;
  const cv=document.createElement("canvas");cv.width=W;cv.height=H;
  const ctx=cv.getContext("2d");
  // Background
  ctx.fillStyle="#f5f4f0";ctx.fillRect(0,0,W,H);
  // Top accent band
  const grad=ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,"#4a42b0");grad.addColorStop(1,"#0f7b5f");
  ctx.fillStyle=grad;ctx.fillRect(0,0,W,14);
  // Heading
  ctx.fillStyle="#1a1917";
  ctx.font="italic 600 76px Georgia, 'Playfair Display', serif";
  ctx.fillText(heading, 80, 170);
  // Subheading
  ctx.fillStyle="#6b6860";
  ctx.font="500 34px Inter, -apple-system, sans-serif";
  ctx.fillText(subheading, 82, 232);
  // Stat rows
  const top=320, rowH=Math.min(118, Math.floor(620/rows.length));
  const rr=(x,y2,w2,h2,r2)=>{ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y2,w2,h2,r2);}else{ctx.rect(x,y2,w2,h2);}};
  rows.forEach((r,i)=>{
    const y=top+i*rowH;
    // subtle row card
    ctx.fillStyle="#ffffff";
    rr(80,y-64,W-160,rowH-16,18);ctx.fill();
    ctx.strokeStyle="rgba(0,0,0,.07)";ctx.lineWidth=2;
    rr(80,y-64,W-160,rowH-16,18);ctx.stroke();
    ctx.fillStyle="#6b6860";
    ctx.font="600 30px Inter, -apple-system, sans-serif";
    ctx.fillText(r.label.toUpperCase(), 116, y);
    ctx.fillStyle=r.color||"#1a1917";
    ctx.font="700 44px Inter, -apple-system, sans-serif";
    const vw=ctx.measureText(r.value).width;
    ctx.fillText(r.value, W-116-vw, y+4);
  });
  // Footer
  ctx.fillStyle="#a09d98";
  ctx.font="500 28px Inter, -apple-system, sans-serif";
  ctx.fillText(footer||"Health Coach", 82, H-64);
  ctx.fillStyle="#4a42b0";
  ctx.font="italic 600 34px Georgia, serif";
  const brand="Health Coach";
  ctx.fillText(brand, W-82-ctx.measureText(brand).width, H-64);

  return new Promise(resolve=>{
    cv.toBlob(async blob=>{
      const file=new File([blob],"health-coach-stats.png",{type:"image/png"});
      try{
        if(navigator.canShare&&navigator.canShare({files:[file]})){
          await navigator.share({files:[file],title:heading});
          resolve(true);return;
        }
      }catch(e){ if(e.name==="AbortError"){resolve(false);return;} }
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);a.download="health-coach-stats.png";a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
      resolve(true);
    },"image/png");
  });
}

// ── COLORS ────────────────────────────────────────────────────────────────
const C = {
  bg:"#f5f4f0", sf:"#fff", s2:"#f0ede8",
  tx:"#1a1917", t2:"#6b6860", t3:"#a09d98",
  // aerobic / steps / cardio / active — GREEN
  teal:"#0f7b5f", tl:"#e0f4ed", tm:"#1D9E75",
  // gym / strength / AI labels — PURPLE
  pu:"#4a42b0", pl:"#eeedf8",
  // yoga / movement / pilates — ORANGE
  or:"#b35a1f", orl:"#fdebd0",
  // sleep / recovery — BLUE
  sl:"#2d65a8", sll:"#e8f1fb", slm:"#3a78c9",
  // food / protein / nutrition — AMBER
  am:"#a05f0a", al:"#fdf3e3",
  // cycle / hormonal — ROSE
  pi:"#993556", pil:"#fbeaf0",
  // pain / danger — RED
  red:"#c0392b", rl:"#fdf0ee",
  bd:"rgba(0,0,0,.08)"
};

// ── SUPABASE ──────────────────────────────────────────────────────────────
// ── STYLES ────────────────────────────────────────────────────────────────
const s = {
  shell:{maxWidth:980,margin:"0 auto",padding:"20px 16px 96px",fontFamily:"'Inter',-apple-system,sans-serif",fontSize:14,color:C.tx,background:C.bg,minHeight:"100vh"},
  card:{background:C.sf,borderRadius:16,border:`1px solid rgba(0,0,0,.04)`,boxShadow:"0 1px 2px rgba(26,25,23,.04), 0 4px 16px rgba(26,25,23,.05)",padding:"16px 18px",marginBottom:14},
  hdr:{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,gap:10,flexWrap:"wrap"},
  h1:{fontSize:32,fontWeight:600,fontFamily:"'Playfair Display',Georgia,serif",fontStyle:"italic",letterSpacing:"-.5px",margin:0,lineHeight:1.1},
  tabs:{display:"flex",gap:2,marginBottom:20,borderBottom:`1px solid ${C.bd}`,overflowX:"auto"},
  tb:(active)=>({fontFamily:"inherit",fontSize:13,fontWeight:500,color:active?C.tx:C.t2,background:"none",border:"none",cursor:"pointer",padding:"8px 14px",borderBottom:active?`2px solid ${C.tx}`:"2px solid transparent",marginBottom:-1,whiteSpace:"nowrap",flexShrink:0}),
  mg:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14},
  mg2:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:14},
  mc:{background:C.sf,borderRadius:14,border:`1px solid rgba(0,0,0,.04)`,boxShadow:"0 1px 2px rgba(26,25,23,.04), 0 3px 10px rgba(26,25,23,.04)",padding:"14px 16px"},
  ml:{fontSize:9,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:C.t3,marginBottom:5},
  mv:{fontSize:21,fontWeight:600,letterSpacing:"-.5px",lineHeight:1.1},
  ms:{fontSize:11,marginTop:3},
  secLbl:{fontSize:9,fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",color:C.t3,marginBottom:16,display:"flex",alignItems:"center",gap:8},
  secLine:{flex:1,height:1,background:"linear-gradient(to right,rgba(0,0,0,.08),transparent)"},
  hr:{border:"none",borderTop:`2px solid ${C.s2}`,margin:"28px 0 24px"},
  aiCard:{background:C.sf,borderRadius:14,border:`1px solid rgba(0,0,0,.04)`,borderLeft:`3px solid ${C.pu}`,boxShadow:"0 1px 2px rgba(26,25,23,.04), 0 4px 16px rgba(26,25,23,.05)",padding:"16px 18px",marginBottom:14},
  aiLbl:{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.pu,marginBottom:10,display:"flex",alignItems:"center",gap:6},
  btn:(v)=>({fontFamily:"inherit",fontSize:13,fontWeight:500,padding:"8px 18px",borderRadius:8,cursor:"pointer",border:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,...(v==="p"?{background:C.tx,color:"#fff"}:{background:C.sf,color:C.t2,border:`.5px solid ${C.bd}`})}),
  btnSm:{padding:"5px 12px",fontSize:12},
  input:{width:"100%",padding:"8px 12px",border:`.5px solid ${C.bd}`,borderRadius:8,fontFamily:"inherit",fontSize:13,background:C.s2,color:C.tx,boxSizing:"border-box"},
  pill:(bg,color)=>({fontSize:11,fontWeight:500,padding:"4px 10px",borderRadius:20,background:bg,color:color}),
  wi:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:`.5px solid ${C.bd}`,fontSize:12},
  badge:(bg,color)=>({fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:bg,color,marginRight:8}),
  pb:{height:6,borderRadius:3,background:C.s2,overflow:"hidden",margin:"5px 0 3px"},
  pf:(w,bg)=>({height:"100%",borderRadius:3,width:w+"%",background:bg}),
  mo:{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16},
  modal:{background:C.sf,borderRadius:16,padding:24,width:400,maxWidth:"100%",boxShadow:"0 12px 40px rgba(26,25,23,.18)"},
};

// ── MINI COMPONENTS ───────────────────────────────────────────────────────
function Card({children, style={}}) {
  return <div className="hcCard" style={{...s.card,...style}}>{children}</div>;
}
function SecLabel({children}) {
  return <div style={s.secLbl}>{children}<div style={s.secLine}/></div>;
}
function Metric({label,value,sub,subColor,compact=false}) {
  if(compact) return (
    <div style={{...s.mc,flex:"1 1 0",minWidth:0,padding:"12px 10px",overflow:"hidden"}}>
      <div style={{...s.ml,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
      <div style={{fontSize:22,fontWeight:600,letterSpacing:"-.5px",lineHeight:1.1}}>{value}</div>
      {sub&&<div style={{...s.ms,color:subColor||C.t3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sub}</div>}
    </div>
  );
  return (
    <div style={{...s.mc}}>
      <div style={s.ml}>{label}</div>
      <div style={s.mv}>{value}</div>
      {sub && <div style={{...s.ms,color:subColor||C.t3}}>{sub}</div>}
    </div>
  );
}
function Spinner() {
  return <span style={{width:14,height:14,border:`2px solid ${C.bd}`,borderTopColor:C.pu,borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite",verticalAlign:"middle",marginRight:6}}/>;
}

// ── ICON SYSTEM ──────────────────────────────────────────────────────────
// One consistent stroke-based line-icon set (24 viewBox, 2px, round caps)
// replacing the mixed emoji chrome. Usage: <Icon name="sync" size={16}/>
const ICON_PATHS = {
  home:      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>,
  food:      <><path d="M5 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M7.5 3v18"/><path d="M17 21V3c-2.2 1.8-3.5 5-3.5 8 0 2 1.2 3.5 3.5 3.5"/></>,
  log:       <><path d="M17 3l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></>,
  profile:   <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></>,
  moon:      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>,
  sync:      <><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></>,
  settings:  <><path d="M5 21v-5M5 10V3M12 21v-9M12 6V3M19 21v-3M19 12V3"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="19" cy="16" r="2"/></>,
  share:     <><path d="M12 3v13"/><path d="M8 7l4-4 4 4"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/></>,
  chat:      <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>,
  plus:      <path d="M12 5v14M5 12h14"/>,
  dumbbell:  <><path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5"/><path d="M6.5 12h11"/></>,
  target:    <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".5"/></>,
  repeat:    <><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></>,
};
function Icon({name,size=16,color="currentColor",strokeWidth=2,style={}}) {
  const p = ICON_PATHS[name];
  if(!p) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{flexShrink:0,verticalAlign:"middle",...style}}>{p}</svg>
  );
}

function CyclePhaseMetric({cycleDates, cycleLog}) {
  const lastPeriodStart = cycleLog?.last_period_start || cycleDates.filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d))[0]?.d || null;
  if(!lastPeriodStart) return <div style={s.mc}><div style={s.ml}>Cycle phase</div><div style={{...s.mv,fontSize:15}}>—</div><div style={{...s.ms,color:C.t3}}>add in Cycle tab</div></div>;
  const datesArr = cycleLog?.period_start_dates?.length ? cycleLog.period_start_dates : [lastPeriodStart];
  const res = calculateCyclePhase(datesArr, cycleLog?.avg_period_length||5);
  const ph = res.phase?getPhaseDisplayText(res):"—";
  return <div style={s.mc}><div style={s.ml}>Cycle phase</div><div style={{...s.mv,fontSize:15,color:C.pi}}>{ph}</div><div style={{...s.ms,color:C.pi}}>Day {res.cycleDay||"—"} of cycle</div></div>;
}

// ── PROTEIN DAYS METRIC ──────────────────────────────────────────────────
function ProteinAvgMetric({allFood, protTgt}) {
  const weekStart = getWeekStartDate();
  const weekKeys = Array.from({length:7},(_,i)=>{
    const d=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i);
    return d.toLocaleDateString("en-CA",{timeZone:getTz()});
  });
  const todayStr = new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
  const entries = weekKeys
    .filter(dk=>dk<=todayStr && (allFood[dk]||[]).length>0)
    .map(dk=>({dk, total:(allFood[dk]||[]).reduce((s,e)=>s+(e.p||0),0)}))
    .filter(e=>e.total>0);
  if(!entries.length) return <div style={s.mc}><div style={s.ml}>Protein avg</div><div style={{...s.mv,color:C.t3}}>—</div><div style={{...s.ms,color:C.t3}}>this week</div></div>;
  const avg = Math.round(entries.reduce((s,e)=>s+e.total,0)/entries.length);
  const col = avg>=protTgt?C.am:avg>=protTgt*.75?"#c48a0a":C.red;
  return <div style={s.mc}><div style={s.ml}>Protein avg</div><div style={{...s.mv,color:col}}>{avg}g</div><div style={{...s.ms,color:col}}>{entries.length}d this week</div></div>;
}

function MonthlyMetrics({fitbitData, allFood, protTgt, profileData, compact=false}) {
  const now=new Date();
  const month=now.toLocaleDateString("en-CA",{timeZone:getTz()}).slice(0,7); // "2026-06"
  const stepTarget=profileData?.step_target||8000;
  // Active days = step target+ steps OR workout
  const monthSteps=(fitbitData.steps||[]).filter(s=>s.date.startsWith(month));
  const monthWorkouts=(fitbitData.workouts||[]).filter(w=>w.date.startsWith(month));
  const workoutDates=new Set(monthWorkouts.map(w=>w.date));
  const activeDates=new Set([
    ...monthSteps.filter(s=>s.steps>=stepTarget).map(s=>s.date),
    ...workoutDates
  ]);
  const strengthCount=monthWorkouts.filter(w=>getActivityCategory(w.type, profileData?.activity_mapping)==="strength").length;
  const mobilityCount=monthWorkouts.filter(w=>getActivityCategory(w.type, profileData?.activity_mapping)==="mobility").length;
  const cardioCount=monthWorkouts.filter(w=>getActivityCategory(w.type, profileData?.activity_mapping)==="cardio").length;
  const at=profileData?.activity_targets||{};
  const tStr=(Number(at.strength)||2)*4;
  const tMov=(Number(at.mobility)||Number(at.movement)||2)*4;
  const tCard=(Number(at.cardio)||2)*4;
  const proteinDays=Object.entries(allFood).filter(([date,meals])=>{
    if(!date.startsWith(month)) return false;
    return meals.reduce((s,e)=>s+(e.p||0),0)>=protTgt;
  }).length;
  return (<>
    <Metric compact={compact} label="Active days" value={<span style={{color:C.teal}}>{activeDates.size}</span>} sub={(profileData?.active_days_target||20)+"/month"} subColor={C.teal}/>
    <Metric compact={compact} label="Strength" value={<span style={{color:C.pu}}>{strengthCount}</span>} sub={"target: "+tStr+"/mo"} subColor={C.pu}/>
    <Metric compact={compact} label="Mobility" value={<span style={{color:C.or}}>{mobilityCount}</span>} sub={"target: "+tMov+"/mo"} subColor={C.or}/>
    <Metric compact={compact} label="Cardio" value={<span style={{color:C.teal}}>{cardioCount}</span>} sub={"target: "+tCard+"/mo"} subColor={C.teal}/>
  </>);
}

function ProteinDaysMetric({allFood, protTgt, compact=false}) {
  const daysHit = Object.entries(allFood).filter(([date, meals]) => {
    const total = meals.reduce((s,e)=>s+(e.p||0),0);
    return total >= protTgt;
  }).length;
  const totalDaysLogged = Object.keys(allFood).length;
  return <Metric compact={compact} label="Protein days" value={<span style={{color:daysHit>0?C.am:C.t3}}>{daysHit>0?daysHit:"—"}</span>} sub={daysHit>0?`of ${totalDaysLogged} logged`:"log meals"} subColor={daysHit>0?C.am:C.t3}/>;
}

function WeeklySleepMetric({fitbitData}) {
  const now=new Date();
  const todayIL=now.toLocaleDateString("en-CA",{timeZone:getTz()});
  // Parse date parts directly to avoid timezone issues with getDay()
  const [ilY,ilM,ilD]=todayIL.split("-").map(Number);
  const dowIL=new Date(ilY,ilM-1,ilD).getDay(); // 0=Sun, 1=Mon...
  const weekDates=[];
  for(let i=0;i<=daysSinceWeekStart(dowIL);i++){
    const d=new Date(now.getTime()-i*864e5);
    weekDates.push(d.toLocaleDateString("en-CA",{timeZone:getTz()}));
  }
  const weekSleep=(fitbitData.sleep||[]).filter(s=>weekDates.includes(s.date));
  if(!weekSleep.length) return <div style={s.mc}><div style={s.ml}>Avg sleep</div><div style={{...s.mv,color:C.t3}}>—</div><div style={{...s.ms,color:C.t3}}>no data this week</div></div>;
  const avg=Math.round(weekSleep.reduce((s,r)=>s+r.total,0)/weekSleep.length);
  const h=Math.floor(avg/60),m=avg%60;
  const col=avg>=420?C.sl:avg>=360?C.slm:C.red;
  return <div style={s.mc}><div style={s.ml}>Avg sleep</div><div style={{...s.mv,color:col}}>{h}h {m}m</div><div style={{...s.ms,color:C.sl}}>{weekSleep.length} night{weekSleep.length!==1?"s":""} this week</div></div>;
}

function WeeklyWorkoutsMetric({fitbitData}) {
  const weekStart=getWeekStartDate();
  const weekDates=[];
  for(let i=0;i<7;i++){
    const d=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i);
    weekDates.push(d.toLocaleDateString("en-CA",{timeZone:getTz()}));
  }
  const weekWorkouts=(fitbitData.workouts||[]).filter(w=>weekDates.includes(w.date));
  const types=[...new Set(weekWorkouts.map(w=>w.type))];
  const sub=types.length?types.join(" · "):"rest so far";
  return <div style={s.mc}><div style={s.ml}>This week</div><div style={{...s.mv,color:weekWorkouts.length>0?C.pu:C.t3}}>{weekWorkouts.length}</div><div style={{...s.ms,color:C.pu}}>{sub}</div></div>;
}

function WeeklyStepsMetric({fitbitData}) {
  const now=new Date();
  const todayStr=now.toLocaleDateString("en-CA",{timeZone:getTz()});
  const weekStart=getWeekStartDate();
  let total=0;
  const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for(let i=0;i<7;i++){
    const d=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i);
    const dateStr=d.toLocaleDateString("en-CA",{timeZone:getTz()});
    const rec=(fitbitData.steps||[]).find(s=>s.date===dateStr);
    if(rec) total+=rec.steps;
  }
  const [ty,tm,td]=todayStr.split("-").map(Number);
  const todayDow=new Date(ty,tm-1,td).getDay();
  return <div style={s.mc}><div style={s.ml}>Total steps</div><div style={{...s.mv,color:C.teal}}>{total.toLocaleString()}</div><div style={{...s.ms,color:C.teal}}>{ACTIVE_WEEK_START==="monday"?"Mon":"Sun"}–{dayNames[todayDow]} this week</div></div>;
}

function SleepTileMetric({fitbitData}) {
  const todayIL = new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
  // Sleep records use wake-up date (= today). Only show if actually tracked last night.
  const rec = (fitbitData.sleep||[]).find(s=>s.date===todayIL);
  if(!rec) return <div style={s.mc}><div style={s.ml}>Sleep last night</div><div style={{...s.mv,color:C.t3}}>—</div><div style={{...s.ms,color:C.t3}}>not tracked</div></div>;
  const h=Math.floor(rec.total/60),m=rec.total%60;
  const col=rec.total>=420?C.sl:rec.total>=360?C.slm:C.red;
  const todayNap=(fitbitData.naps||[]).find(n=>n.date===todayIL);
  const sub=todayNap?`${rec.deep}m deep · +${todayNap.total}m nap`:`${rec.deep}m deep · ${rec.rem}m REM`;
  return <div style={s.mc}><div style={s.ml}>Sleep last night</div><div style={{...s.mv,color:col}}>{h}h {m}m</div><div style={{...s.ms,color:col}}>{sub}</div></div>;
}

function StepsMetric({fitbitData, profileData}) {
  const today = new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
  const todayRec = (fitbitData.steps||[]).find(s=>s.date===today);
  const steps = todayRec ? todayRec.steps : 0;
  const sub = steps >= (profileData?.step_target||8000) ? "active day ✓" : steps > 0 ? "keep going" : "no data yet";
  return <div style={s.mc}><div style={s.ml}>Steps today</div><div style={{...s.mv,color:C.teal}}>{steps.toLocaleString()}</div><div style={{...s.ms,color:C.teal}}>{sub}</div></div>;
}

// ── DASHBOARD TAB ─────────────────────────────────────────────────────────

// ── GOOGLE HEALTH API ─────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = "749607035074-b06qae2bs7o4cfn7dlbbg0772eg7cntf.apps.googleusercontent.com";
const GOOGLE_REDIRECT_URI = "https://juliaserebro.github.io/health-dashboard/";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly"
].join(" ");
const GH_BASE = "https://health.googleapis.com/v4";

function getGToken(){try{return JSON.parse(localStorage.getItem("gtoken")||"null");}catch{return null;}}
function setGToken(tok){localStorage.setItem("gtoken",JSON.stringify(tok));}
function clearGToken(){localStorage.removeItem("gtoken");}
function isGTokenValid(tok){
  if(!tok||!tok.access_token) return false;
  return tok.expires_at>Date.now()+60000;
}

function startGoogleAuth(forceConsent=false){
  const hasConsented = localStorage.getItem("gh_consent_granted");
  const loginHint = localStorage.getItem("gh_login_hint");
  const prompt = (forceConsent||!hasConsented) ? "consent" : "none";
  const params=new URLSearchParams({
    client_id:GOOGLE_CLIENT_ID,redirect_uri:GOOGLE_REDIRECT_URI,
    response_type:"token",scope:GOOGLE_SCOPES,
    include_granted_scopes:"true",prompt,
    ...(loginHint?{login_hint:loginHint}:{})
  });
  window.location.href="https://accounts.google.com/o/oauth2/v2/auth?"+params.toString();
}

function handleGoogleCallback(){
  const hash=window.location.hash.substring(1);
  if(!hash) return false;
  const params=new URLSearchParams(hash);
  const error=params.get("error");
  // An OAuth callback only ever happens for the owner — restore the private
  // ?u= key to the URL that Google stripped, so the address bar (and any
  // bookmark/refresh from it) keeps pointing at the owner link.
  const ownerUrl = window.location.pathname + "?u=" + OWNER_KEY;
  if(error){
    if(error==="login_required"||error==="consent_required"||error==="interaction_required"){
      window.history.replaceState(null,"",ownerUrl);
      startGoogleAuth(true);
    }
    return false;
  }
  const access_token=params.get("access_token");
  const expires_in=params.get("expires_in");
  if(!access_token) return false;
  const tok={access_token,expires_at:Date.now()+parseInt(expires_in||3600)*1000};
  setGToken(tok);
  localStorage.setItem("gh_consent_granted","true");
  window.history.replaceState(null,"",ownerUrl);
  // Fetch email for login_hint so future silent re-auths skip the account chooser
  if(!localStorage.getItem("gh_login_hint")){
    fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{"Authorization":"Bearer "+access_token}})
      .then(r=>r.json()).then(u=>{if(u.email) localStorage.setItem("gh_login_hint",u.email);}).catch(()=>{});
  }
  supa("PATCH","profiles",{google_access_token:access_token,google_token_expiry:new Date(tok.expires_at).toISOString()},"uid=eq."+UID).catch(()=>{});
  return true;
}

// Silent token refresh via hidden iframe — no page navigation, no account chooser
function silentGoogleRefresh(){
  return new Promise((resolve,reject)=>{
    const loginHint=localStorage.getItem("gh_login_hint");
    if(!loginHint){reject(new Error("no_login_hint"));return;}
    const params=new URLSearchParams({
      client_id:GOOGLE_CLIENT_ID,redirect_uri:GOOGLE_REDIRECT_URI,
      response_type:"token",scope:GOOGLE_SCOPES,
      include_granted_scopes:"true",prompt:"none",login_hint:loginHint
    });
    const iframe=document.createElement("iframe");
    iframe.style.cssText="display:none;width:1px;height:1px;";
    const startedAt=Date.now();
    const cleanup=()=>{clearInterval(poller);try{document.body.removeChild(iframe);}catch(e){}};
    // Poll — first the iframe shows Google's page (cross-origin, unreadable),
    // then it redirects back to our origin with the token in the hash
    const poller=setInterval(()=>{
      let hash=null;
      try{ hash=iframe.contentWindow.location.hash; }catch(e){ /* still on Google's domain */ }
      if(hash&&hash.includes("access_token")){
        const p=new URLSearchParams(hash.substring(1));
        const at=p.get("access_token");
        const ei=p.get("expires_in");
        cleanup();
        const tok={access_token:at,expires_at:Date.now()+parseInt(ei||3600)*1000};
        setGToken(tok);
        supa("PATCH","profiles",{google_access_token:at,google_token_expiry:new Date(tok.expires_at).toISOString()},"uid=eq."+UID).catch(()=>{});
        resolve(tok);
        return;
      }
      if(hash&&hash.includes("error=")){ cleanup(); reject(new Error("silent_denied")); return; }
      // Fallback: the iframe may have loaded the full app which stored the token itself
      const stored=getGToken();
      if(isGTokenValid(stored)&&stored.expires_at>startedAt+3600000-120000){ cleanup(); resolve(stored); return; }
      if(Date.now()-startedAt>12000){ cleanup(); reject(new Error("silent_timeout")); }
    },250);
    iframe.src="https://accounts.google.com/o/oauth2/v2/auth?"+params.toString();
    document.body.appendChild(iframe);
  });
}

async function ghGet(path,params={}){
  const tok=getGToken();
  if(!tok||!isGTokenValid(tok)) throw new Error("NOT_AUTHENTICATED");
  const qs=Object.keys(params).length?"?"+new URLSearchParams(params).toString():"";
  const res=await fetch(GH_BASE+path+qs,{headers:{"Authorization":"Bearer "+tok.access_token}});
  if(res.status===401){clearGToken();throw new Error("NOT_AUTHENTICATED");}
  if(!res.ok){const e=await res.text();throw new Error("GH "+res.status+": "+e.slice(0,200));}
  return res.json();
}

async function ghPost(path,body){
  const tok=getGToken();
  if(!tok||!isGTokenValid(tok)) throw new Error("NOT_AUTHENTICATED");
  const res=await fetch(GH_BASE+path,{
    method:"POST",
    headers:{"Authorization":"Bearer "+tok.access_token,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  if(res.status===401){clearGToken();throw new Error("NOT_AUTHENTICATED");}
  if(!res.ok){const e=await res.text();throw new Error("GH "+res.status+": "+e.slice(0,200));}
  return res.json();
}

// Parse date string "2026-06-15" to CivilDateTime object {year,month,day}
function toCivil(dateStr){
  const [y,m,d]=dateStr.split("-").map(Number);
  return {year:y,month:m,day:d};
}

// Add N days to a date string
function addDays(dateStr,n){
  const [y,m,d]=dateStr.split("-").map(Number);
  const dt=new Date(y,m-1,d+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

// Get steps via list - one call per day to avoid double-counting across midnight
async function ghGetStepsRollup(startDate,endDate){
  // Single range request - same approach as sleep/exercise which work correctly
  // Parse civilStartTime from each dataPoint to group by Israel date
  const results={};
  try{
    const data=await ghGet("/users/me/dataTypes/steps/dataPoints",{
      filter:`steps.interval.civil_start_time >= "${startDate}" AND steps.interval.civil_start_time < "${addDays(endDate,1)}"`,
      pageSize:2000
    });
    const pts=data.dataPoints||[];
    console.log("Steps raw: total intervals=",pts.length,"sample=",JSON.stringify(pts[0]).slice(0,200));
    // Only use Fitbit device data, not phone pedometer (avoids double-counting)
    const fitbitPts=pts.filter(pt=>pt.dataSource?.platform==="FITBIT"||pt.dataSource?.device?.displayName==="Charge 6");
    console.log("Steps: total=",pts.length,"fitbit only=",fitbitPts.length);
    fitbitPts.forEach(pt=>{
      const startTime=pt.steps?.interval?.startTime;
      const utcOffset=pt.steps?.interval?.startUtcOffset;
      if(!startTime) return;
      const count=parseInt(pt.steps?.count||0);
      if(count<=0) return;
      const offsetSeconds=parseInt(utcOffset||"10800")||10800;
      const localMs=new Date(startTime).getTime()+(offsetSeconds*1000);
      const localDate=new Date(localMs);
      const dateStr=localDate.getUTCFullYear()+"-"+
        String(localDate.getUTCMonth()+1).padStart(2,"0")+"-"+
        String(localDate.getUTCDate()).padStart(2,"0");
      results[dateStr]=(results[dateStr]||0)+count;
    });
    Object.keys(results).forEach(d=>{
      console.log(`Steps ${d}: ${results[d]}`);
    });
  }catch(e){
    if(e.message==="NOT_AUTHENTICATED") throw e;
    console.log("Steps range error:",e.message);
  }
  console.log("Steps fetched:",Object.keys(results).length,"days. Sample:",JSON.stringify(Object.entries(results).slice(-3)));
  return results;
}

// Parse sleep data point from list endpoint
function parseSleepPoint(pt){
  const sleep=pt.sleep;
  if(!sleep||!sleep.interval) return null;
  const startTime=sleep.interval.startTime;
  const endTime=sleep.interval.endTime;
  if(!startTime||!endTime) return null;
  // Wake date in Israel timezone
  const wakeDate=new Date(endTime).toLocaleDateString("en-CA",{timeZone:getTz()});
  // Bedtime in Israel timezone
  const bedtime=new Date(startTime).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:getTz()});
  // Duration from stages
  let deepMin=0,remMin=0,lightMin=0,awakeMin=0;
  (sleep.stages||[]).forEach(stage=>{
    const mins=Math.round((new Date(stage.endTime)-new Date(stage.startTime))/60000);
    if(stage.type==="DEEP") deepMin+=mins;
    else if(stage.type==="REM") remMin+=mins;
    else if(stage.type==="LIGHT"||stage.type==="LIGHT_NREM") lightMin+=mins;
    else if(stage.type==="AWAKE") awakeMin+=mins;
  });
  // Total asleep = full interval minus awake
  const totalMins=Math.round((new Date(endTime)-new Date(startTime))/60000);
  const asleepMin=totalMins-awakeMin;
  if(asleepMin<60) return null; // too short
  const rhr=sleep.metricsSummary?.restingHeartRateBeatsPerMinute
    ?Math.round(parseFloat(sleep.metricsSummary.restingHeartRateBeatsPerMinute))
    :null;
  return {date:wakeDate,bedtime,total:asleepMin,deep:deepMin,rem:remMin,light:lightMin,awake:awakeMin,...(rhr?{rhr}:{})};
}

// Parse exercise data point
function parseExercise(pt){
  const ex=pt.exercise;
  if(!ex||!ex.interval) return null;
  const endTime=ex.interval.endTime;
  const startTime=ex.interval.startTime;
  if(!endTime) return null;
  const date=new Date(endTime).toLocaleDateString("en-CA",{timeZone:getTz()});
  const typeMap={WALK:"walk",WALKING:"walk",RUNNING:"run",YOGA:"yoga",WORKOUT:"gym",ELLIPTICAL:"elliptical",
    CIRCUIT_TRAINING:"gym",STRENGTH_TRAINING:"gym",BIKING:"cycling",HIKING:"walk",
    SPORT:"gym",SPINNING:"cycling",PILATES:"pilates"};
  const rawType=ex.exerciseType||"WORKOUT";
  const type=typeMap[rawType]||rawType.toLowerCase().replace(/_/g," ");
  const durationMin=startTime?Math.round((new Date(endTime)-new Date(startTime))/60000):null;
  const avgHr=ex.metricsSummary?.averageHeartRateBeatsPerMinute
    ?Math.round(parseFloat(ex.metricsSummary.averageHeartRateBeatsPerMinute)):null;
  if(durationMin&&durationMin<5) return null;
  return {date,type,duration_min:durationMin,avg_hr:avgHr};
}

// Full sync
async function ghFullSync(setSyncStatus,setFitbitData){
  setSyncStatus("Syncing from Google Health...");
  try{
    const now=new Date();
    const today=now.toLocaleDateString("en-CA",{timeZone:getTz()});
    const twoWeeksAgo=addDays(today,-14);
    const tomorrow=addDays(today,1);

    // ── STEPS via dailyRollUp ──────────────────────────────────────────────
    let stepsArr=[];
    try{
      const stepsMap=await ghGetStepsRollup(twoWeeksAgo,today);
      stepsArr=Object.entries(stepsMap)
        .map(([date,steps])=>({date,steps}))
        .filter(s=>s.steps>0)
        .sort((a,b)=>a.date.localeCompare(b.date));
      console.log("Steps parsed:",stepsArr.length,"days. Last 3:",stepsArr.slice(-3));
    }catch(e){
      if(e.message==="NOT_AUTHENTICATED") throw e;
      console.log("Steps error:",e.message);
    }

    // ── SLEEP via list ─────────────────────────────────────────────────────
    const sleepArr=[];
    const napArr=[];
    try{
      const sleepData=await ghGet("/users/me/dataTypes/sleep/dataPoints",{
        filter:`sleep.interval.civil_end_time >= "${twoWeeksAgo}" AND sleep.interval.civil_end_time < "${tomorrow}"`,
        pageSize:30
      });
      const sleepPts=sleepData.dataPoints||[];
      console.log("Sleep points:",sleepPts.length);
      const byDate={};
      sleepPts.forEach(pt=>{
        const parsed=parseSleepPoint(pt);
        if(!parsed) return;
        if(parsed.total<60){
          napArr.push({date:parsed.date,start:parsed.bedtime,total:parsed.total,deep:parsed.deep});
        } else {
          if(!byDate[parsed.date]){
            byDate[parsed.date]={...parsed};
          } else {
            // Multiple segments on same night (e.g. woke for medical test, went back to sleep) — sum them
            const ex=byDate[parsed.date];
            byDate[parsed.date]={
              ...ex,
              total:ex.total+parsed.total,
              deep:(ex.deep||0)+(parsed.deep||0),
              rem:(ex.rem||0)+(parsed.rem||0),
              light:(ex.light||0)+(parsed.light||0),
              awake:(ex.awake||0)+(parsed.awake||0),
              bedtime:ex.bedtime<=parsed.bedtime?ex.bedtime:parsed.bedtime,
            };
          }
        }
      });
      Object.values(byDate).forEach(s=>sleepArr.push(s));
      sleepArr.sort((a,b)=>b.date.localeCompare(a.date));
      console.log("Sleep parsed:",sleepArr.length,"nights. Latest:",sleepArr[0]);
    }catch(e){
      if(e.message==="NOT_AUTHENTICATED") throw e;
      console.log("Sleep error:",e.message);
    }

    // ── EXERCISES via list ─────────────────────────────────────────────────
    const workoutsArr=[];
    try{
      const exData=await ghGet("/users/me/dataTypes/exercise/dataPoints",{
        filter:`exercise.interval.civil_start_time >= "${twoWeeksAgo}" AND exercise.interval.civil_start_time < "${tomorrow}"`,
        pageSize:25
      });
      (exData.dataPoints||[]).forEach(pt=>{
        const parsed=parseExercise(pt);
        if(parsed) workoutsArr.push(parsed);
      });
      workoutsArr.sort((a,b)=>b.date.localeCompare(a.date));
      console.log("Workouts parsed:",workoutsArr.length,workoutsArr[0]);
    }catch(e){
      if(e.message==="NOT_AUTHENTICATED") throw e;
      console.log("Workouts error:",e.message);
    }

    // ── RESTING HEART RATE (daily rollup) ────────────────────────────────────
    try{
      const rhrData=await Promise.race([
        ghGet("/users/me/dataTypes/daily-resting-heart-rate/dataPoints",{
          pageSize:30
        }),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error("RHR timeout")),8000))
      ]);
      const rhrMap={};
      (rhrData.dataPoints||[]).forEach(pt=>{
        const hr=pt.dailyRestingHeartRate;
        if(!hr||!hr.date) return;
        const {year,month,day}=hr.date;
        const date=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const bpm=hr.beatsPerMinute;
        if(bpm!=null) rhrMap[date]=Math.round(parseFloat(bpm));
      });
      sleepArr.forEach(s=>{ if(rhrMap[s.date]!=null) s.rhr=rhrMap[s.date]; });
      console.log("RHR parsed:",Object.keys(rhrMap).length,"days",rhrMap);
    }catch(e){
      if(e.message==="NOT_AUTHENTICATED") throw e;
      console.log("RHR fetch error:",e.message);
    }

    // Only replace each field if we got actual data - never wipe with empty
    setFitbitData(prev=>{
      const merged={
        sleep: sleepArr.length>0 ? sleepArr : prev.sleep||[],
        naps: napArr.length>0 ? napArr : prev.naps||[],
        steps: (()=>{
        // Merge: for each date, keep the HIGHER value (seed vs sync)
        // This prevents sync from overwriting known-correct seed values with wrong API values
        const seedMap={};
        (prev.steps||[]).forEach(s=>{seedMap[s.date]=s.steps;});
        const syncMap={};
        stepsArr.forEach(s=>{syncMap[s.date]=s.steps;});
        // All dates from both sources
        const allDates=new Set([...Object.keys(seedMap),...Object.keys(syncMap)]);
        const merged=[];
        allDates.forEach(date=>{
          const seedVal=seedMap[date]||0;
          const syncVal=syncMap[date]||0;
          // For today and recent days, trust sync more if it's reasonable
          // For older dates where seed has verified values, keep seed if sync is suspiciously low
          const val=syncVal>0&&syncVal>seedVal*0.5?syncVal:seedVal>0?seedVal:syncVal;
          if(val>0) merged.push({date,steps:val});
        });
        return merged.sort((a,b)=>a.date.localeCompare(b.date));
      })(),
        workouts: (()=>{
          if(!workoutsArr.length) return prev.workouts||[];
          // Keep synced workouts + any seed/manual workouts for dates not covered by the sync
          const syncDates=new Set(workoutsArr.map(w=>w.date));
          const preserved=(prev.workouts||[]).filter(w=>!syncDates.has(w.date));
          return [...workoutsArr,...preserved].sort((a,b)=>b.date.localeCompare(a.date));
        })(),
        synced_at: new Date().toISOString()
      };
      // Save merged data to Supabase
      fetch(SUPA_URL+"/rest/v1/fitness_cache?on_conflict=user_id",{
        method:"POST",
        headers:{"Content-Type":"application/json","apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY,"Prefer":"resolution=merge-duplicates,return=minimal"},
        mode:"cors",credentials:"omit",
        body:JSON.stringify({user_id:UID,data:merged,synced_at:merged.synced_at})
      }).then(r=>{if(r.ok)console.log("✓ Fitness data saved to Supabase");else r.text().then(t=>console.log("Supabase save error:",t));})
        .catch(e=>console.log("Supabase save error:",e.message));
      return merged;
    });
    const newData={steps:stepsArr,sleep:sleepArr,workouts:workoutsArr};



    const t=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    setSyncStatus(`Synced ${t} · ${stepsArr.length}d steps · ${sleepArr.length} nights · ${workoutsArr.length} workouts`);
    return newData;
  }catch(e){
    if(e.message==="NOT_AUTHENTICATED") setSyncStatus("Tap Sync to reconnect Google Health");
    else setSyncStatus("Sync error: "+e.message.slice(0,40));
    throw e;
  }
}

// ── STANDALONE buildCtx (called by TabDash and App chat) ────────────────
// ─────────────────────────────────────────────────────────────
// COACH INTELLIGENCE LAYER
// ─────────────────────────────────────────────────────────────

const COACH_FEW_SHOT_EXAMPLES = `
EXAMPLE COACHING EXCHANGES (voice and tone reference — internalize these):

Situation: User had one unusually bad night of sleep with no obvious cause
Coach: "Last night looked rougher than usual — sometimes that just happens, and one night doesn't change much. If it becomes a pattern we'll look at it together. How are you feeling today?"

Situation: Pattern detected — deep sleep shorter on nights with late meals, observed 4 times
Coach: "We've noticed something worth paying attention to — on nights when your last meal was after 9pm, your deep sleep tended to be shorter. This has come up a few times now. It might be worth trying an earlier cutoff and seeing if you notice a difference. In some people, eating closer to sleep affects sleep architecture."

Situation: User is in luteal phase, appetite may be increasing
Coach: "You're likely in your luteal phase right now. If you've been feeling hungrier than usual, that's completely biological — progesterone increases appetite in the second half of the cycle. Leaning into protein-forward snacks during this window can help you feel satisfied without derailing your goals."

Situation: User has trained 10 of the last 14 days with no full rest day
Coach: "You've been incredibly consistent lately — 10 training days in the last two weeks. One thing worth considering: adaptation actually happens during rest, not during the workout itself. A full rest day or a gentle mobility session today might pay off more than another hard session right now."

Situation: Food not logged in 2 days
Coach: "We notice food hasn't been logged the last couple of days — no assumptions here, life gets busy. If you'd like your coach to give you more specific nutrition insights, logging when you can helps a lot. Even a rough log is more useful than none."

Situation: Pattern — consistent skip day detected
Coach: "We've noticed Wednesdays tend to be quiet movement-wise over the past few weeks. That might just be how your week flows — if so, it's worth building your plan around it rather than against it. Is Wednesday a rest day by design, or does something keep getting in the way?"

Situation: Rising resting HR trend over 10 days
Coach: "Your resting heart rate has been creeping slightly higher over the past week and a half. This can sometimes mean your body is carrying more stress than usual — physical or otherwise. It doesn't mean anything is wrong, but it's worth prioritising recovery this week and seeing if it settles."

Situation: Weekly coach letter — Sunday evening
Coach: "Here's your week. You trained four times, hit your step target five days, and your sleep averaged 7h 10min — just above your target. The standout thing I noticed: your readiness scores were consistently higher on days you had a mobility session before a strength session. That sequence seems to work well for you. Next week, one thing to try: protect your sleep on Wednesday — it's been your weakest night three weeks in a row. Small adjustment, potentially big payoff."

Situation: Coach has 4+ weeks of data
Coach: "Four weeks in, here's what I've learned about you: you're a night person who does best when you stop fighting it. Your strongest training days follow good sleep — almost without exception. You rarely eat before noon and that seems to work fine for you. Your luteal phase is genuinely harder on your energy, and that's biology, not weakness. And you're more consistent than you probably give yourself credit for."
`;

function getWeekStartDate() {
  const now = new Date();
  const todayIL = now.toLocaleDateString("en-CA",{timeZone:getTz()});
  const [y,m,d] = todayIL.split("-").map(Number);
  const dow = new Date(y,m-1,d).getDay(); // 0=Sunday
  return new Date(y,m-1,d-daysSinceWeekStart(dow)); // back to configured week start
}
function getWeekEndDate() {
  const sun = getWeekStartDate();
  return new Date(sun.getFullYear(),sun.getMonth(),sun.getDate()+6,23,59,59,999);
}

function buildCoachSystemPrompt(profileData, todayData, detectedPatterns, behavioralBaseline, recentHistory) {
  const calcAge = dob => {
    if (!dob) return "unknown";
    const d = new Date(dob), now = new Date();
    return now.getFullYear() - d.getFullYear() - (now < new Date(now.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
  };
  const goals = (profileData?.goals||[]).map(g=>`${g.label}${g.definition?' ('+g.definition+')':''}`).join(', ') || 'general fitness';
  const at = profileData?.activity_targets || {};
  const supps = (profileData?.supplements||[]).filter(s=>s.name).map(s=>`${s.name}${s.dose?' '+s.dose:''}${s.timing?' ('+s.timing+')':''}`).join(', ') || 'none';
  const bl = behavioralBaseline || {};
  const patternsText = (detectedPatterns||[]).length > 0
    ? detectedPatterns.map(p=>`- ${p.description} (observed ${p.occurrences} times, confidence: ${p.confidence})`).join('\n')
    : 'Still building pattern library — less than 14 days of data.';
  const pendingText = (recentHistory?.pendingFeedback||[]).length > 0
    ? recentHistory.pendingFeedback.map(f=>`- Suggested "${f.suggestion}" on ${f.date}. Metric change: ${f.metricChange||'unknown'}`).join('\n')
    : 'none';
  const baselineOk = !!(profileData?.behavioral_baseline?.established_at);

  return `You are a personal AI health coach. You are warm, direct, curious, and non-judgmental. You speak like a knowledgeable friend who happens to be an expert in health, fitness, nutrition, sleep, and women's health — not like a medical device or a generic wellness app.

CRITICAL RULES — follow these without exception:
1. OBSERVE BEFORE CONCLUDING. Never draw a causal conclusion from fewer than 3 data points. Say "we noticed" not "this is because."
2. TENTATIVE LANGUAGE ALWAYS. Use: "it might be," "in some people," "we've noticed," "this could be connected to." Never use: "you slept badly because," "this is causing."
3. MISSING DATA IS NOT BEHAVIOR. If food hasn't been logged, never assume the person wasn't hungry.
4. STRENGTH SESSION RULE: Never reference specific muscle groups or body parts (glutes, legs, upper body, lower body, back, chest, arms, core) when coaching around gym or strength sessions. Fitbit cannot see inside a workout. Frame all strength coaching around goals, energy, and readiness only. Example — WRONG: "focus on your lower body today". CORRECT: "your recovery metrics support a strong training session today".
5. ANOMALY VS PATTERN. A single outlier gets one curious question. A pattern (3+ occurrences) gets a tentative observation.
6. NEVER GUILT. Never frame missed workouts, late meals, or bad nights as failures. Everything is information and opportunity.
7. ONE SUGGESTION PER INSIGHT. Every observation leads to one specific, actionable suggestion. Not three. One.
8. THE SCIENCE IS OPTIONAL. Lead with observation and suggestion. Offer science as a "why?" — never lecture unprompted.
9. YOU ARE NOT A DOCTOR. Never diagnose. For anything recurring over 2+ weeks, suggest speaking to a professional.
10. YOU GET BETTER OVER TIME. After 4+ weeks, reference accumulated knowledge: "I've learned that you..." or "three months in..."

USER PROFILE:
Name: ${profileData?.name||'Julia'}
Age: ${calcAge(profileData?.birth_date)}
Gender: ${profileData?.gender||'female'}
Goals: ${goals}
Activity targets: Strength ${at.strength||2}x/week, Mobility ${at.mobility||2}x/week, Cardio ${at.cardio||2}x/week
Protein target: ${profileData?.protein_target||100}g/day
Step target: ${profileData?.step_target||8000} steps/day
Supplements: ${supps}
Food sensitivities & restrictions: ${(profileData?.food_sensitivities||[]).length>0 ? profileData.food_sensitivities.join(', ') : 'none specified'}
Health notes: ${profileData?.health_notes||'none'}

FOOD SENSITIVITY RULE: Never suggest a food item that conflicts with the user's stated
food sensitivities or restrictions. If restrictions are "none specified," do not assume
any restriction. If suggesting specific foods (e.g. in a nutrition insight or micro-suggestion),
always check against this list first.
Cycle tracking: ${profileData?.cycle_tracking?'active':'not tracking'}${todayData?.cycleResult?`
Current cycle phase: ${todayData.cycleResult.confidence==='very_low'||todayData.cycleResult.confidence==='no_data'?'uncertain — limited cycle data available':todayData.cycleResult.phase}
Cycle day: ${todayData.cycleResult.cycleDay||'unknown'} of ${todayData.cycleResult.avgCycleLength}-day cycle
Cycle data confidence: ${todayData.cycleResult.confidence} (based on ${todayData.cycleResult.cyclesUsedForCalculation} logged cycle gap${todayData.cycleResult.cyclesUsedForCalculation!==1?'s':''})`:''}

CYCLE PHASE RULE: If cycle data confidence is "low" or "very_low" or "no_data", do not make confident cycle-phase-based suggestions. Either omit cycle references entirely, or use very tentative language: "if you're tracking accurately, you may be in your luteal phase — though with limited data this is just an estimate."

BEHAVIORAL BASELINE (inferred from 14+ days of actual behaviour):
Typical sleep duration: ${bl.typical_sleep_hours?bl.typical_sleep_hours+'h':'not yet established'}
Typical bedtime: ${bl.typical_bedtime||'not yet established'}
Avg resting HR: ${bl.avg_resting_hr?bl.avg_resting_hr+' bpm':'establishing'}
Avg deep sleep: ${bl.avg_deep_sleep_pct?bl.avg_deep_sleep_pct+'%':'establishing'}

TODAY:
${todayData?.sleepSummary||'Sleep: not tracked last night'}
${todayData?.stepsLine||'Steps: no data'}
${todayData?.workoutsLine||'Workouts: none today'}
${todayData?.nutritionLine||'Nutrition: not logged'}${todayData?.cyclePhase?'\nCycle: '+todayData.cyclePhase:''}

RECENT 14 DAYS:
Training days: ${recentHistory?.trainingDays||0}/14
Protein target hit: ${recentHistory?.proteinDaysHit||0} days
Step target hit: ${recentHistory?.stepDaysHit||0} days
Avg sleep: ${recentHistory?.avgSleep||'insufficient data'}

DETECTED PATTERNS (confirmed 3+ occurrences):
${patternsText}

PENDING RECOMMENDATION FOLLOW-UPS:
${pendingText}

BASELINE STATUS: ${baselineOk?'Baseline established.':'Still in calibration (first 14 days). Do not judge against targets.'}

SIGNAL HIERARCHY — use when data sends conflicting messages:
1. User logs (what the person said about how they feel) — always highest priority
2. Cumulative training load (training days in last 14 days) — overrides single-day signals
3. HRV and resting HR trend — objective recovery markers
4. Readiness score — good composite but can be inflated by one good night
5. Cycle phase — tendency not certainty — lowest priority when conflicting with above

WHEN SIGNALS CONFLICT:
- Name the tension in one sentence
- State which signal you are weighting more and why, in plain language
- Give one soft recommendation
- End with acknowledgment that the user knows their body best
- Example: "Your sleep was strong and your cycle is favorable — but you have trained 10 of the last 14 days. Your body may feel ready while still carrying cumulative load. A lighter session today might be the smarter play — but if you feel strong, trust that too."

COHERENCE RULE — mandatory:
The headline and every subsection must reflect the same conclusion.
If recovery signals caution → headline cannot encourage pushing hard.
If headline says rest → nutrition and tonight must support recovery, not performance.
Before generating each subsection, check: does this contradict anything already said? If yes, rewrite until all sections tell one coherent story.

${COACH_FEW_SHOT_EXAMPLES}`;
}

function buildLast30Days(fitbitData, allFood, cycleDates, profileData) {
  const now = new Date();
  const tz = profileData?.timezone || getTz();
  const protTgt = profileData?.protein_target || 100;
  const stepTgt = profileData?.step_target || 8000;
  const confDates = (cycleDates||[]).filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 864e5);
    const dk = d.toLocaleDateString("en-CA", {timeZone: tz});
    const sleepRec = (fitbitData.sleep||[]).find(s=>s.date===dk);
    const stepsRec = (fitbitData.steps||[]).find(s=>s.date===dk);
    const dayWorkouts = (fitbitData.workouts||[]).filter(w=>w.date===dk);
    const foodEntries = allFood[dk] || [];
    let cyclePhase = null;
    if (confDates.length) {
      const startD = new Date(confDates[0].d+"T12:00:00");
      const targetD = new Date(dk+"T12:00:00");
      const diff = Math.round((targetD - startD) / 864e5);
      if (diff >= 0) { const cd = (diff % 28) + 1; cyclePhase = cd<=5?'menstrual':cd<=13?'follicular':cd<=16?'ovulatory':'luteal'; }
    }
    const proteinG = Math.round(foodEntries.reduce((s,e)=>s+(e.p||0),0));
    const last7Count = Array.from({length:7},(_,j)=>{
      const pd = new Date(d.getTime()-j*864e5);
      return pd.toLocaleDateString("en-CA",{timeZone:tz});
    }).filter(pk=>(fitbitData.workouts||[]).some(w=>w.date===pk)).length;
    days.push({
      date:dk, sleepHours:sleepRec?sleepRec.total/60:null,
      deepSleepMinutes:sleepRec?sleepRec.deep:null, remSleepMinutes:sleepRec?sleepRec.rem:null,
      bedtime:sleepRec?sleepRec.bedtime:null, steps:stepsRec?stepsRec.steps:null,
      stepsHit:stepsRec?stepsRec.steps>=stepTgt:false, hasWorkout:dayWorkouts.length>0,
      trainingDaysLast7:last7Count, cyclePhase, proteinG,
      proteinHit:proteinG>=protTgt*0.9, foodLogged:foodEntries.length>0
    });
  }
  return days;
}

async function runPatternDetection(profileData, fitbitData, allFood, cycleDates) {
  const last30 = buildLast30Days(fitbitData, allFood, cycleDates, profileData);
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const patterns = [];

  // Day-of-week skip pattern
  const skipCounts={0:0,1:0,2:0,3:0,4:0,5:0,6:0}, totalCounts={0:0,1:0,2:0,3:0,4:0,5:0,6:0};
  last30.forEach(d=>{const dow=new Date(d.date+"T12:00:00").getDay();totalCounts[dow]++;if(!d.hasWorkout)skipCounts[dow]++;});
  const maxSkip=Object.entries(skipCounts).sort((a,b)=>b[1]-a[1])[0];
  if(parseInt(maxSkip[1])>=3&&totalCounts[maxSkip[0]]>=3){
    const dn=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    patterns.push({id:'consistent_skip_day',description:`${dn[maxSkip[0]]}s are consistently rest days`,occurrences:parseInt(maxSkip[1]),confidence:'moderate',suggestion:null});
  }

  // High training load
  const highLoad=last30.filter(d=>d.trainingDaysLast7>=5);
  if(highLoad.length>=3) patterns.push({id:'high_training_load',description:'Training 5+ days in a row detected consistently',occurrences:highLoad.length,confidence:'moderate',suggestion:'Consider a rest or mobility day when reaching 5 consecutive training days'});

  // Cycle × sleep
  if(profileData?.cycle_tracking){
    const lut=last30.filter(d=>d.cyclePhase==='luteal'&&d.sleepHours);
    const fol=last30.filter(d=>d.cyclePhase==='follicular'&&d.sleepHours);
    if(lut.length>=4&&fol.length>=4){
      const diff=avg(fol.map(d=>d.sleepHours))-avg(lut.map(d=>d.sleepHours));
      if(diff>0.4) patterns.push({id:'cycle_sleep_drop',description:`Sleep averages ${diff.toFixed(1)}h less during luteal phase`,occurrences:lut.length,confidence:'high',suggestion:'Prioritise earlier bedtimes during your luteal phase'});
    }
  }

  // Protein consistency
  const logged=last30.filter(d=>d.foodLogged), hit=logged.filter(d=>d.proteinHit);
  if(logged.length>=7&&hit.length/logged.length<0.4) patterns.push({id:'low_protein_consistency',description:`Protein target hit only ${Math.round(hit.length/logged.length*100)}% of logged days`,occurrences:logged.length,confidence:'high',suggestion:'Adding a protein-focused snack mid-morning may help hit the daily target'});

  // Deep sleep trend (declining)
  const slDays=last30.filter(d=>d.deepSleepMinutes!==null&&d.deepSleepMinutes>0);
  if(slDays.length>=10){
    const half=Math.floor(slDays.length/2);
    const drop=avg(slDays.slice(0,half).map(d=>d.deepSleepMinutes))-avg(slDays.slice(half).map(d=>d.deepSleepMinutes));
    if(drop>10) patterns.push({id:'declining_deep_sleep',description:`Deep sleep has been trending down over 30 days (~${Math.round(drop)}min less)`,occurrences:slDays.length,confidence:'moderate',suggestion:'Focus on consistent bedtime — same time every night for 2 weeks'});
  }

  // Step consistency (positive)
  const stepDays=last30.filter(d=>d.steps!==null), stepHit=stepDays.filter(d=>d.stepsHit);
  if(stepDays.length>=7&&stepHit.length/stepDays.length>=0.7) patterns.push({id:'strong_step_consistency',description:`Step target hit ${Math.round(stepHit.length/stepDays.length*100)}% of days — excellent movement consistency`,occurrences:stepHit.length,confidence:'high',suggestion:null});

  try{ await supa("POST","profiles",{uid:UID,detected_patterns:patterns},"on_conflict=uid"); }catch(e){ console.log("Pattern save:",e.message); }
  return patterns;
}

async function buildBehavioralBaseline(last30Days) {
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  const mode = arr => { if(!arr.length)return null; const f={}; arr.forEach(v=>f[v]=(f[v]||0)+1); return Object.entries(f).sort((a,b)=>b[1]-a[1])[0][0]; };
  const roundH = t => t ? `${parseInt(t.split(':')[0])}:00` : null;
  const slDays = last30Days.filter(d=>d.sleepHours);
  if(slDays.length<14) return null;
  const baseline={
    typical_sleep_hours:Math.round(avg(slDays.map(d=>d.sleepHours))*10)/10,
    typical_bedtime:mode(slDays.map(d=>roundH(d.bedtime)).filter(Boolean)),
    avg_deep_sleep_pct:slDays.some(d=>d.deepSleepMinutes)?Math.round(avg(slDays.filter(d=>d.deepSleepMinutes).map(d=>d.deepSleepMinutes/(d.sleepHours*60)*100))):null,
    established_at:new Date().toISOString()
  };
  try{ await supa("POST","profiles",{uid:UID,behavioral_baseline:baseline},"on_conflict=uid"); }catch(e){ console.log("Baseline save:",e.message); }
  return baseline;
}

async function logCoachSuggestion(profileData, suggestion, relatedMetric) {
  const entry={suggestion,related_metric:relatedMetric,date:new Date().toISOString(),followed:null,metricChange:null};
  const existing=profileData?.coach_suggestion_log||[];
  try{ await supa("POST","profiles",{uid:UID,coach_suggestion_log:[...existing.slice(-19),entry]},"on_conflict=uid"); }catch(e){}
}

const MILESTONE_DEFS = [
  {id:'seven_day_food_streak',check:(last30)=>{
    let streak=0; for(let i=last30.length-1;i>=0;i--){if(last30[i].foodLogged)streak++;else break;} return streak===7;
  },message:"Seven days of food logging in a row. Your coach now has enough data to start seeing real nutrition patterns — this consistency is what makes personalised coaching possible."},
  {id:'five_sleep_nights',check:(last30)=>{
    let streak=0; for(let i=last30.length-1;i>=0;i--){const d=last30[i];if(d.sleepHours&&d.sleepHours>=7)streak++;else break;} return streak===5;
  },message:"Five nights in a row hitting your sleep target. Sleep consistency is one of the hardest habits to build and one of the highest-leverage ones. Your recovery numbers should reflect it."},
  {id:'protein_five_streak',check:(last30)=>{
    let streak=0; for(let i=last30.length-1;i>=0;i--){if(last30[i].proteinHit)streak++;else break;} return streak===5;
  },message:"Five days in a row hitting your protein target. This is the kind of nutritional consistency that supports muscle building and recovery. Your body notices."},
];

async function checkMilestones(profileData, last30Days) {
  const triggered = profileData?.triggered_milestones || [];
  const newMilestones = [];
  for (const m of MILESTONE_DEFS) {
    if (triggered.includes(m.id)) continue;
    if (m.check(last30Days)) {
      newMilestones.push({id:m.id, message:m.message, date:new Date().toISOString()});
    }
  }
  if (newMilestones.length > 0) {
    const allTriggered = [...triggered, ...newMilestones.map(m=>m.id)];
    try{ await supa("POST","profiles",{uid:UID,triggered_milestones:allTriggered},"on_conflict=uid"); }catch(e){}
    return newMilestones;
  }
  return [];
}

// Shared 14-day log digest with relevance triage. The model does the routine-vs-
// serious distinction: soreness/tiredness/mood expire after 2 days; injuries and
// movement-limiting issues stay active until a newer entry says they resolved.
function buildLogContext(logEntries){
  const now=new Date();
  const items=(logEntries||[]).filter(e=>e.dt&&(now-new Date(e.dt))/864e5<=14).slice(0,25).map(e=>{
    const daysAgo=Math.floor((now-new Date(e.dt))/864e5);
    const when=daysAgo===0?"TODAY":daysAgo===1?"YESTERDAY":`${daysAgo} days ago`;
    return `[${e.tag}|${when}] ${e.txt}`;
  });
  if(!items.length) return "USER LOGS (last 14 days): none.";
  return `USER LOGS (last 14 days, newest first):
${items.join("\n")}

LOG RELEVANCE RULES — apply judgment to each entry's age and content:
- Routine/transient entries (muscle soreness, ordinary tiredness, one bad night, daily mood) EXPIRE after 2 days: never reference or act on them once older than 2 days.
- Serious entries (injury, spinal or nerve symptoms, illness, anything that limits movement) STAY ACTIVE regardless of age until a newer entry indicates it resolved or improved. While active, never push training that conflicts with it.
- If a newer entry contradicts an older one, the newer one wins.
- When unsure whether an entry is routine or serious, treat it as routine (expires after 2 days).`;
}

function buildCtxFull({allFood, logEntries, cycleDates, protTgt, fitbitData, profileData}) {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:getTz()});
  const todayKey = now.toLocaleDateString("en-CA",{timeZone:getTz()});
  const yKey = new Date(now.getTime()-864e5).toLocaleDateString("en-CA",{timeZone:getTz()});
  const todayFood = allFood[todayKey]||[];
  const liveProt = Math.round(todayFood.reduce((s,e)=>s+(e.p||0),0));
  const liveKcal = Math.round(todayFood.reduce((s,e)=>s+(e.k||0),0));
  const liveCarbs = Math.round(todayFood.reduce((s,e)=>s+(e.c||0),0));
  const liveFat = Math.round(todayFood.reduce((s,e)=>s+(e.f||0),0));
  const mealNames = todayFood.map(e=>e.n).join(", ")||"nothing logged yet";
  const yAlcohol = logEntries.filter(e=>e.dt&&e.dt.slice(0,10)===yKey&&e.txt&&/wine|alcohol|beer|drink/i.test(e.txt)).map(e=>e.txt).join("; ");
  const conf = cycleDates.filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d));
  let cycleCtx = "Cycle not tracked";
  if(conf.length){const cd=calcCycleDay(conf[0].d);const ph=cd<=5?"menstrual":cd<=13?"follicular":cd<=16?"ovulatory":"luteal";cycleCtx=`Cycle day ${cd}/28, phase: ${ph}`;}
  const logCtx = buildLogContext(logEntries);
  const todaySteps=(fitbitData.steps||[]).find(s=>s.date===todayKey);
  const lastSleep=getLastNightSleep(fitbitData, getTz());
  const stepsLine=todaySteps?`Steps today: ${todaySteps.steps}`:"Steps: no data";
  const sleepLine=lastSleep?`Last night (${lastSleep.date}): ${Math.floor(lastSleep.total/60)}h${lastSleep.total%60}m, deep ${lastSleep.deep}min, REM ${lastSleep.rem}min, bedtime ${lastSleep.bedtime}`:(isSleepDataStale(fitbitData,getTz())?"Sleep data unavailable or stale — do not reference sleep.":"Sleep: not tracked last night — do NOT mention sleep stats or give sleep guidance.");
  const todayNaps=(fitbitData.naps||[]).filter(n=>n.date===todayKey);
  const napLine=todayNaps.length?`Nap today: ${todayNaps.map(n=>n.total+"min at "+n.start).join(", ")}.`:"No nap today.";
  const recentWorkouts=[...(fitbitData.workouts||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(w=>w.date+" "+w.type+(w.duration_min?" "+w.duration_min+"min":"")).join(", ");
  const yWorkouts=(fitbitData.workouts||[]).filter(w=>w.date===yKey);
  const ySteps=(fitbitData.steps||[]).find(s=>s.date===yKey);
  const yActivity=yWorkouts.length?yWorkouts.map(w=>w.type).join(" + "):"rest day, no workout logged";
  const yStepsNote=ySteps?ySteps.steps.toLocaleString()+" steps":"steps unknown";
  const goalsCtx = (profileData?.goals||[]).length>0 ? '\nUSER GOALS:\n'+(profileData.goals.map(g=>'- '+g.label+': '+g.definition+(g.target_value?' (target: '+g.target_value+' '+(g.target_unit||'')+')':'')).join('\n')) : '';
  const actTargCtx = profileData?.activity_targets ? `\nACTIVITY TARGETS: Strength ${profileData.activity_targets.strength}x/week, Mobility ${profileData.activity_targets.mobility||2}x/week, Cardio ${profileData.activity_targets.cardio}x/week` : '';
  const suppsCtx = (profileData?.supplements||[]).filter(s=>s.name).length>0 ? '\nSUPPLEMENTS: '+(profileData.supplements.filter(s=>s.name).map(s=>`${s.name} ${s.dose||''} ${s.timing?'('+s.timing+')':''}`).join(', ')) : '';
  const sensCtx = (profileData?.food_sensitivities||[]).length>0 ? `\nFOOD SENSITIVITIES & RESTRICTIONS: ${profileData.food_sensitivities.join(', ')}. NEVER suggest foods that conflict with these.` : '';
  // STRENGTH SESSION RULE applied here: goals described without body-part framing
  return goalsCtx + actTargCtx + suppsCtx + sensCtx + `\nJulia Serebro 41F 166cm 57.6kg. Post T9-T10 surgery Mar2026, L4-L5 disc herniation, left-side pain (physio pending). Goals: (1)build strength and muscle (2)push-up baseline progression (3)lower back/spinal stability (4)cardiovascular fitness. TRAINING PHILOSOPHY: She is building fitness after deconditioning. Muscle fatigue and general tiredness are NORMAL and expected during this phase. Do NOT recommend rest for general fatigue or soreness unless there is a recent pain/discomfort log entry (per the LOG RELEVANCE RULES below) or injury concern. Rest is only warranted for acute injury or illness, not routine tiredness. STRENGTH SESSION RULE: Never mention specific muscle groups or body parts in coaching. Frame strength sessions around readiness, energy, and goals only. TODAY: ${todayStr}. Fitbit data: ${stepsLine}. ${sleepLine}. ${napLine} Recent workouts: ${recentWorkouts||"none"}. Yesterday (${yKey}): ${yActivity}, ${yStepsNote}. LIVE NUTRITION: ${liveProt}g protein(target ${protTgt}g, ${Math.max(0,protTgt-liveProt)}g to go), ${liveKcal}kcal, ${liveCarbs}g carbs, ${liveFat}g fat. Meals today: ${mealNames}. Yesterday alcohol: ${yAlcohol||"none"}. ${cycleCtx}.

${logCtx}`;
}

function TabDash({allFood, logEntries, cycleDates, cycleLog, apiKey, protTgt, aiRefreshTick=0, fitbitData={sleep:[],steps:[],workouts:[]}, profileData=null}) {
  const [aiToday, setAiToday] = useState(null);
  const [aiWeek, setAiWeek] = useState(null);
  const [loading, setLoading] = useState({today:false,week:false});
  const [weeklyReview, setWeeklyReview] = useState(()=>{try{const s=localStorage.getItem("weekly_review");return s?JSON.parse(s):null;}catch{return null;}});
  const [weeklyReviewLoading, setWeeklyReviewLoading] = useState(false);
  const [coachContent, setCoachContent] = useState(null); // {headline,recovery,tonight,nutrition,isWeekly,isLearning}
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachDismissed, setCoachDismissed] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [pendingMilestone, setPendingMilestone] = useState(null);

  const todayFood = allFood[tkey()]||[];
  const tp = todayFood.reduce((s,e)=>s+(e.p||0),0);

  function buildCtx() {
    return buildCtxFull({allFood, logEntries, cycleDates, protTgt, fitbitData, profileData});
  }

  async function callCoachAI(userMessage, systemPrompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:600,system:systemPrompt,messages:[{role:"user",content:userMessage}]})
    });
    const d = await res.json();
    if(d.error) throw new Error(d.error.message);
    return d.content[0].text.trim();
  }

  async function generateAllCoachContent(forceRefresh=false, triggeringEvent=null) {
    // Demo: pre-generated content from the profile row, never any API call
    if(IS_DEMO){
      if(profileData?.coach_content) setCoachContent(profileData.coach_content);
      return;
    }
    // Stored content (Supabase) always renders first — works for any visitor,
    // regardless of whether this session can regenerate. localStorage below is
    // only a speed cache, never the source of truth.
    if(profileData?.coach_content && !coachContent) setCoachContent(profileData.coach_content);
    if(!apiKey) return; // session can't generate: stored content stays, no error states
    const now = new Date();
    const todayKey = now.toLocaleDateString("en-CA",{timeZone:getTz()});
    if(!forceRefresh){
      try{
        const cached = localStorage.getItem("coach_content_"+todayKey);
        if(cached){
          const parsed = JSON.parse(cached);
          const isNewFormat = Array.isArray(parsed.domain_insights) || parsed.isLearning || parsed.isWeekly;
          const generatedAt = parsed._generatedAt ? new Date(parsed._generatedAt) : null;
          const hoursSince = generatedAt ? (now - generatedAt)/3600000 : 999;
          if(isNewFormat && hoursSince < 6){ setCoachContent(parsed); return; }
        }
      }catch(e){}
    }
    const sleepCount = (fitbitData.sleep||[]).length;
    if(sleepCount < 3){
      setCoachContent({isLearning:true,headline:"Your coach is learning your patterns — check back in a few days for your first personalised insight.",recovery:null,tonight:null,nutrition:null});
      return;
    }
    setCoachLoading(true);
    try{
      const lastSleep = getLastNightSleep(fitbitData, getTz());
      const sleepStale = isSleepDataStale(fitbitData, getTz());
      const todaySteps = (fitbitData.steps||[]).find(s=>s.date===todayKey);
      const todayWorkouts = (fitbitData.workouts||[]).filter(w=>w.date===todayKey);
      const _cycleDatesArr = cycleLog?.period_start_dates?.length ? cycleLog.period_start_dates : (cycleDates||[]).filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d)).map(x=>x.d);
      let cyclePhaseStr = null;
      let cycleResult = null;
      if(_cycleDatesArr.length){cycleResult=calculateCyclePhase(_cycleDatesArr,cycleLog?.avg_period_length||5);cyclePhaseStr=`Day ${cycleResult.cycleDay}/${cycleResult.avgCycleLength}, ${cycleResult.phase} phase (confidence: ${cycleResult.confidence})`;}
      const todayFoodEntries = allFood[todayKey]||[];
      const prot = Math.round(todayFoodEntries.reduce((s,e)=>s+(e.p||0),0));
      const foodNames = todayFoodEntries.map(e=>e.n||e.name||e.description).filter(Boolean);
      const foodSummary = foodNames.length>0 ? foodNames.join(", ") : "nothing logged yet today";
      const last14Keys = Array.from({length:14},(_,i)=>{const d=new Date(now.getTime()-i*864e5);return d.toLocaleDateString("en-CA",{timeZone:getTz()});});
      const trainingDays=(fitbitData.workouts||[]).filter(w=>last14Keys.includes(w.date)).map(w=>w.date).filter((v,i,a)=>a.indexOf(v)===i).length;
      const proteinHitDays=last14Keys.filter(dk=>(allFood[dk]||[]).reduce((s,e)=>s+(e.p||0),0)>=(profileData?.protein_target||100)*0.9).length;
      const stepHitDays=last14Keys.filter(dk=>{const r=(fitbitData.steps||[]).find(s=>s.date===dk);return r&&r.steps>=(profileData?.step_target||8000);}).length;
      const recentSleep=(fitbitData.sleep||[]).filter(s=>last14Keys.includes(s.date));
      const avgSleep=recentSleep.length?(recentSleep.reduce((s,r)=>s+r.total,0)/recentSleep.length/60).toFixed(1)+"h":"insufficient data";
      const pendingFeedback=(profileData?.coach_suggestion_log||[]).filter(l=>{if(!l.date)return false;return(new Date()-new Date(l.date))/864e5<=7&&l.followed===null;});
      // Days since last workout + type (for micro workout suggestion and coach context)
      const sortedWorkouts=[...(fitbitData.workouts||[])].sort((a,b)=>b.date.localeCompare(a.date));
      const lastWorkoutDate=sortedWorkouts[0]?.date||null;
      const lastWorkoutType=lastWorkoutDate?[...new Set(sortedWorkouts.filter(w=>w.date===lastWorkoutDate).map(w=>getActivityCategory(w.type,profileData?.activity_mapping)||w.type))].join("+"):"none";
      const daysSinceLastWorkout=lastWorkoutDate?Math.floor((new Date()-new Date(lastWorkoutDate+"T12:00:00"))/864e5):99;
      const at = profileData?.activity_targets||{};
      const weeklyWorkoutTarget = (at.strength||0)+(at.mobility||0)+(at.cardio||0)||6;
      const fourteenDayTarget = weeklyWorkoutTarget * 2;
      const adherencePct = fourteenDayTarget>0 ? Math.round(trainingDays/fourteenDayTarget*100) : 100;
      const adherenceLabel = adherencePct<90?"below target":adherencePct<=110?"on target":"above target";
      const recentHistory={trainingDays,proteinDaysHit:proteinHitDays,stepDaysHit:stepHitDays,avgSleep,pendingFeedback,daysSinceLastWorkout,lastWorkoutType,fourteenDayTarget,adherencePct,adherenceLabel};
      const hour=parseInt(now.toLocaleString("en-CA",{timeZone:getTz(),hour:"numeric",hour12:false}));
      const dow=new Date(todayKey+"T12:00:00").getDay();
      const isWeekly=dow===0&&hour>=18;
      const todayDataCtx={
        sleepSummary:lastSleep?`Sleep last night: ${Math.floor(lastSleep.total/60)}h${lastSleep.total%60}m, deep ${lastSleep.deep}min, REM ${lastSleep.rem}min, bedtime ${lastSleep.bedtime}`:(sleepStale?"Sleep data unavailable or stale — do not reference last night's sleep. Focus on other available signals (steps, training load, food, cycle).":"Sleep: not tracked last night"),
        stepsLine:todaySteps?`Steps today: ${todaySteps.steps.toLocaleString()} (target: ${profileData?.step_target||8000})`:"Steps: no data yet",
        workoutsLine:todayWorkouts.length?`Workouts today: ${todayWorkouts.map(w=>w.type).join(", ")}`:"Workouts: none yet today",
        nutritionLine:todayFoodEntries.length?`Nutrition today: ${prot}g protein (target ${protTgt}g)`:"Nutrition: not logged yet",
        cyclePhase:cyclePhaseStr,
        cycleResult:cycleResult
      };
      const systemPrompt=buildCoachSystemPrompt(profileData,todayDataCtx,profileData?.detected_patterns||[],profileData?.behavioral_baseline||null,recentHistory);

      // Longer-window patterns for the dynamic insight engine
      const last14FoodData = last14Keys.map(dk=>{
        const meals=allFood[dk]||[];
        return {date:dk, logged:meals.length>0, prot:Math.round(meals.reduce((s,e)=>s+(e.p||0),0)), meals:meals.map(e=>e.n||e.name).filter(Boolean)};
      });
      const proteinStreak=((arr)=>{let n=0;for(const d of arr){if(d.prot>=(profileData?.protein_target||120)*0.9)n++;else break;return n;}})(last14FoodData);
      const sleepTrend=(()=>{const r=[...((fitbitData.sleep||[]).filter(s=>last14Keys.includes(s.date)))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(s=>s.total);return r.length>=3?r[0]>r[r.length-1]?"improving":"declining":"stable";})();
      const workoutDayOfWeek=(fitbitData.workouts||[]).filter(w=>last14Keys.includes(w.date)).map(w=>new Date(w.date+"T12:00:00").getDay());
      const dowCounts=workoutDayOfWeek.reduce((a,d)=>{a[d]=(a[d]||0)+1;return a;},{});
      const patternDays=Object.entries(dowCounts).filter(([,c])=>c>=2).map(([d])=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]);
      // Weekly targets for this week
      const weekStart2=getWeekStartDate();
      const weekKeys2=Array.from({length:7},(_,i)=>{const d=new Date(weekStart2.getFullYear(),weekStart2.getMonth(),weekStart2.getDate()+i);return d.toLocaleDateString("en-CA",{timeZone:getTz()});});
      const weekWorkouts2=(fitbitData.workouts||[]).filter(w=>weekKeys2.includes(w.date));
      const at2=profileData?.activity_targets||{};
      const weekStrDone=weekWorkouts2.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="strength").length;
      const weekMobDone=weekWorkouts2.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="mobility").length;
      const weekCarDone=weekWorkouts2.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="cardio").length;
      const mostBehindCategory=[["strength",(at2.strength||2)-weekStrDone],["mobility",(at2.mobility||2)-weekMobDone],["cardio",(at2.cardio||2)-weekCarDone]].sort((a,b)=>b[1]-a[1])[0][0];

      // Insight freshness history
      const insightHistory = (()=>{try{return JSON.parse(localStorage.getItem("coach_insight_history")||"{}");}catch{return {};}})();
      const insightHistoryCtx = Object.entries(insightHistory).map(([t,d])=>`${t}: last mentioned ${d.last_surfaced} — "${d.last_claim}"`).join("\n")||"No history yet";

      const userMsg = `TRAINING ADHERENCE (last 14 days):
Sessions completed: ${trainingDays} of ${fourteenDayTarget} target (${adherencePct}% — ${adherenceLabel})
Last session: ${lastWorkoutType}, ${daysSinceLastWorkout} day(s) ago
Most behind on weekly target: ${mostBehindCategory}
This week so far — Strength: ${weekStrDone}/${at2.strength||2}, Mobility: ${weekMobDone}/${at2.mobility||2}, Cardio: ${weekCarDone}/${at2.cardio||2}

LONGER-WINDOW DATA:
Sleep trend (last 5 nights): ${sleepTrend}
Protein streak (consecutive days at 90%+ target): ${proteinStreak} days
Consistent workout days in last 2 weeks: ${patternDays.length?patternDays.join(", "):"none confirmed"}
Last 14 days food log: ${last14FoodData.filter(d=>d.logged).map(d=>`${d.date}: ${d.prot}g prot${d.meals.length?` (${d.meals.slice(0,3).join(", ")})`:""}` ).join(" | ")||"nothing logged"}

INSIGHT HISTORY — do not repeat these unless something materially changed:
${insightHistoryCtx}

FRESHNESS RULES:
- sleep_quality: repeat only if sleep changed significantly from recent pattern
- cycle_phase: only if phase changed or newly relevant to today's plan
- protein_total: not two days in a row unless a streak milestone just hit
- training_load: not within 3 days unless adherence changed by 15%+
- food_pattern: look for qualitative patterns (variety, timing, missing food groups) not just grams
- tonight: ONLY generate if current local hour >= 19; otherwise omit it entirely
- recovery_general: only if RHR/sleep signals something actionable

TRAINING RULES:
- daysSinceLastWorkout=0: trained today — acknowledge, do NOT suggest more training
- daysSinceLastWorkout=1: suggest the complementary category to yesterday's session (never same category two days running)
- daysSinceLastWorkout>=2: encourage the category most behind weekly target (${mostBehindCategory})
- Never say "good day to train" without naming exactly which category and why

MANDATORY TRAINING LOAD RULE:
- adherencePct<100: user is at/below target — never call this heavy load; encourage if daysSinceLastWorkout>=2
- adherencePct 100–110: on target — no rest suggestion unless sleep/RHR independently signals fatigue
- adherencePct>110: only case where volume-based rest suggestion is valid

Decide ONE overall_signal first. Then generate exactly 1 headline insight — always shown. Then 0–2 domain insights — only if they pass freshness rules and are genuinely different from the headline. If a domain has nothing new to say, omit it. If nothing beyond headline, set domain_insights:[] and nothing_new:true.

LONGER TIME WINDOW — check before defaulting to today only:
- Any confirmed pattern across last 3+ days worth naming?
- Any positive streak worth recognising?
- Any week-over-week observation?
- Any qualitative food pattern (new food, missing food group, meal timing shift)?

Return ONLY valid JSON:
{
  "overall_signal": "push | maintain | recover",
  "headline": "1-2 sentences. Most interesting or actionable observation today.",
  "why": "1 sentence. Reasoning behind the headline — adds something not in the headline itself.",
  "domain_insights": [
    {
      "type": "sleep_quality | cycle_phase | protein_total | training_load | step_pattern | food_pattern | bedtime_pattern | recovery_general | weekly_trend | milestone | tonight",
      "content": "1 sentence. Genuinely different from headline. Passes freshness rule.",
      "claim": "short summary of what was just said — used to check freshness next time"
    }
  ],
  "nothing_new": false,
  "micro_workout": ${daysSinceLastWorkout>=5 ? `"${daysSinceLastWorkout} days since last session. Include 2-3 bodyweight exercises. Keep tone light. Use actual moves separated by · (middle dot). Never guilt-based."` : 'null'}
}

Rules: no section repeats another; all language warm and non-guilt; never mention specific muscle groups or body parts.`;
      // Event-aware regeneration: give the model the prior content + what changed,
      // so it responds to the event instead of blindly rewriting the morning.
      let eventCtx = "";
      try{
        const prev = coachContent && !coachContent.isLearning ? coachContent
          : JSON.parse(localStorage.getItem("coach_content_"+todayKey)||"null") || profileData?.coach_content || null;
        if(prev && !prev.isLearning){
          const prevSlim = {headline:prev.headline, why:prev.why, domain_insights:(prev.domain_insights||[]).map(i=>({type:i.type,content:i.content}))};
          eventCtx = `

PREVIOUS COACH CONTENT (what the user has been seeing until now):
${JSON.stringify(prevSlim)}

TRIGGERING EVENT: ${triggeringEvent || "scheduled refresh — no single event"}

EVENT-RESPONSE RULES:
- If the triggering event is a completed workout: acknowledge it naturally and update the day's guidance to reflect it. If the previous content suggested this session, close that loop ("Nice — you got that mobility session in").
- Only change what the new facts change. Observations still true from the previous content (e.g. the sleep trend) may be kept in substance, reworded minimally.
- Never suggest a session category the user has already completed today unless their weekly target for that category genuinely calls for another.
- Update today's session counts and weekly adherence math to include any new workout BEFORE reasoning about what to suggest.`;
        }
      }catch(e){}
      const raw = await callCoachAI(userMsg + "\n\n" + buildLogContext(logEntries) + eventCtx, systemPrompt);
      const clean = raw.replace(/```json|```/g,"").trim();
      const m = clean.match(/\{[\s\S]*\}/);
      if(m){
        const content = JSON.parse(m[0]);
        content._generatedAt = new Date().toISOString();
        content._foodHash = (allFood[todayKey]||[]).map(f=>f.dbid||f.eaten_time||f.n).join("|");
        setCoachContent(content);
        localStorage.setItem("coach_content_"+todayKey, JSON.stringify(content));
        // Persist to profile so any visitor/device sees the latest coach content
        supa("POST","profiles",{uid:UID,coach_content:content},"on_conflict=uid").catch(()=>{});
        // Update freshness history
        try{
          const existing = JSON.parse(localStorage.getItem("coach_insight_history")||"{}");
          (content.domain_insights||[]).forEach(ins=>{if(ins.type&&ins.claim)existing[ins.type]={last_surfaced:todayKey,last_claim:ins.claim};});
          localStorage.setItem("coach_insight_history",JSON.stringify(existing));
        }catch(e){}
      }
    }catch(e){ console.log("Coach content error:",e.message); }
    setCoachLoading(false);
  }

  async function refreshNutritionOnly() {
    if(IS_DEMO) return;
    if(!apiKey||!coachContent||coachContent.isLearning||coachContent.isWeekly) return;
    const now = new Date();
    const todayKey = now.toLocaleDateString("en-CA",{timeZone:getTz()});
    const todayFoodEntries = allFood[todayKey]||[];
    const currentFoodHash = todayFoodEntries.map(f=>f.dbid||f.eaten_time||f.n).join("|");
    // Skip if food hasn't changed since last generation
    try {
      const cached = JSON.parse(localStorage.getItem("coach_content_"+todayKey)||"{}");
      if(cached._foodHash===currentFoodHash) return;
    } catch(e){}
    const prot = Math.round(todayFoodEntries.reduce((s,e)=>s+(e.p||0),0));
    const protTgt2 = profileData?.protein_target||120;
    const foodSummary2 = todayFoodEntries.map(e=>e.n||e.name).filter(Boolean).join(", ")||"nothing logged yet";

    // Food changed (hash check above passed) — always refresh the nutrition insight
    // so the coach never keeps nagging about food that was just logged.
    localStorage.setItem("coach_last_protein_"+todayKey,String(prot));
    try {
      const raw = await callCoachAI(
        `Generate ONLY a food/nutrition insight for today. One sentence.
ALREADY EATEN TODAY (forbidden from suggestion): ${foodSummary2}
Protein so far: ${prot}g of ${protTgt2}g target.
FOOD SENSITIVITIES & RESTRICTIONS: ${(profileData?.food_sensitivities||[]).length>0?profileData.food_sensitivities.join(", ")+" — NEVER suggest foods conflicting with these.":"none specified — do not assume any restriction."}
Rules: do not suggest any food already eaten; notice qualitative patterns (variety, timing, streaks) not just grams; if protein is close to or at target acknowledge positively; if genuinely nothing new to say return exactly: null`,
        `You are a warm, precise nutrition coach. Return either one sentence of plain text, or the single word: null`
      );
      const txt = raw.replace(/```/g,"").trim();
      const newInsight = txt && txt.toLowerCase()!=="null" ? {type:"food_pattern",content:txt,claim:txt.slice(0,80)} : null;
      // Replace or add food_pattern in domain_insights; update hash either way
      const existingInsights = (coachContent.domain_insights||[]).filter(i=>i.type!=="food_pattern"&&i.type!=="protein_total");
      const updatedInsights = newInsight ? [...existingInsights, newInsight] : existingInsights;
      const updated = {...coachContent, domain_insights:updatedInsights, _foodHash:currentFoodHash, _generatedAt:new Date().toISOString()};
      setCoachContent(updated);
      localStorage.setItem("coach_content_"+todayKey, JSON.stringify(updated));
      supa("POST","profiles",{uid:UID,coach_content:updated},"on_conflict=uid").catch(()=>{});
      if(newInsight){
        try{const h=JSON.parse(localStorage.getItem("coach_insight_history")||"{}");h.food_pattern={last_surfaced:todayKey,last_claim:newInsight.claim,last_surfaced_ms:new Date().toISOString()};localStorage.setItem("coach_insight_history",JSON.stringify(h));}catch(e){}
      }
    } catch(e){ console.log("Nutrition refresh error:",e.message); }
  }

  function shouldShowWeeklyReview() {
    if(IS_DEMO) return !!weeklyReview?.text; // showcase piece — always visible in demo
    const now = new Date();
    const todayIL = now.toLocaleDateString("en-CA",{timeZone:getTz()});
    const [y,m,d] = todayIL.split("-").map(Number);
    const dow = new Date(y,m-1,d).getDay();
    const hour = parseInt(now.toLocaleString("en-CA",{timeZone:getTz(),hour:"numeric",hour12:false}));
    const isSaturdayEvening = dow===6 && hour>=18;
    // Also show if already generated this week and not dismissed
    const stored = weeklyReview;
    if(stored?.dismissed) return false;
    if(stored?.generatedAt) {
      const weekStart = getWeekStartDate();
      const genDate = new Date(stored.generatedAt);
      if(genDate >= weekStart) return true;
    }
    return isSaturdayEvening;
  }

  async function generateWeeklyReview(forceRefresh=false) {
    if(IS_DEMO||!apiKey) return;
    const weekStart = getWeekStartDate();
    const weekEnd = getWeekEndDate();
    if(!forceRefresh && weeklyReview?.generatedAt && new Date(weeklyReview.generatedAt) >= weekStart) return;
    setWeeklyReviewLoading(true);
    try {
      const fmt = d => d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
      const dateRange = `${fmt(weekStart)} – ${fmt(weekEnd)}`;
      // Gather this week's data (Sun–Sat)
      const weekKeys = [];
      for(let i=0;i<7;i++){
        const d = new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i);
        weekKeys.push(d.toLocaleDateString("en-CA",{timeZone:getTz()}));
      }
      const weekWorkouts = (fitbitData.workouts||[]).filter(w=>weekKeys.includes(w.date));
      const weekSleep = (fitbitData.sleep||[]).filter(s=>weekKeys.includes(s.date));
      const avgSleepMin = weekSleep.length ? Math.round(weekSleep.reduce((s,r)=>s+r.total,0)/weekSleep.length) : null;
      const protDaysHit = weekKeys.filter(dk=>(allFood[dk]||[]).reduce((s,e)=>s+(e.p||0),0)>=(profileData?.protein_target||100)*0.9).length;
      const stepDaysHit = weekKeys.filter(dk=>{const r=(fitbitData.steps||[]).find(s=>s.date===dk);return r&&r.steps>=(profileData?.step_target||8000);}).length;
      const weekSummary = `Week ${dateRange}: ${weekWorkouts.length} workouts (${[...new Set(weekWorkouts.map(w=>w.type))].join(", ")||"none"}), avg sleep ${avgSleepMin?Math.floor(avgSleepMin/60)+"h"+(avgSleepMin%60)+"m":"not tracked"}, protein target hit ${protDaysHit}/7 days, step target hit ${stepDaysHit}/7 days.`;
      const now = new Date();
      const _wDatesArr = cycleLog?.period_start_dates?.length ? cycleLog.period_start_dates : [];
      const _wCycleResult = _wDatesArr.length ? calculateCyclePhase(_wDatesArr, cycleLog?.avg_period_length||5) : null;
      let cyclePhaseStr = null;
      if(_wCycleResult){cyclePhaseStr=_wCycleResult.phase;}
      const systemPrompt = buildCoachSystemPrompt(profileData,{cyclePhase:cyclePhaseStr?`Cycle phase: ${cyclePhaseStr}`:null,cycleResult:_wCycleResult},profileData?.detected_patterns||[],profileData?.behavioral_baseline||null,{trainingDays:weekWorkouts.length,proteinDaysHit:protDaysHit,stepDaysHit:stepDaysHit,avgSleep:avgSleepMin?`${Math.floor(avgSleepMin/60)}h${avgSleepMin%60}m`:"n/a",pendingFeedback:[]});
      const userMsg = `Write this week's weekly coach review covering ${dateRange} (Sunday through Saturday — Israeli week convention). Week data: ${weekSummary}

Cover exactly these four things, one short bullet each, in this order:
1. One trend observed across the full week — a pattern across multiple days
2. One cross-factor insight only visible across a week of data (e.g. best readiness followed days with both a workout and 7+ hours of sleep)
3. One honest acknowledgment of where the week was harder — no guilt, just honesty
4. One specific focus for the coming week tied to the user's goals — actionable

Warm first-person coach voice. Reference actual numbers. Week-level view only.

${buildLogContext(logEntries)}

FORMAT — return EXACTLY four lines, each a bullet starting with a topic emoji + short CAPS label, then a colon, then one sentence. No intro, no outro, nothing else. Example shape:
📈 THE TREND: <one sentence>
🔗 WHAT CONNECTS: <one sentence>
🌧️ THE HARD PART: <one sentence>
🎯 THIS WEEK: <one sentence>`;
      const text = await callCoachAI(userMsg, systemPrompt);
      const record = {text, dateRange, generatedAt: now.toISOString(), dismissed: false};
      setWeeklyReview(record);
      localStorage.setItem("weekly_review", JSON.stringify(record));
      // Also save to profiles if columns exist
      supa("PATCH","profiles",{weekly_review:text,weekly_review_generated_at:now.toISOString(),weekly_review_dismissed:false},`uid=eq.${UID}`).catch(()=>{});
    } catch(e){ console.log("Weekly review error:",e.message); }
    setWeeklyReviewLoading(false);
  }

  async function callAI(prompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:400,messages:[{role:"user",content:buildCtx()+"\n\n"+prompt}]})
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return d.content[0].text.trim();
  }

  function renderBold(text) {
    const parts = text.split(/\*\*([^*]+)\*\*/g);
    return parts.map((p,i)=>i%2===1?<strong key={i}>{p}</strong>:p);
  }
  function formatAI(txt) {
    const lines = txt.split("\n").filter(l=>l.trim());
    const result = [];
    let i = 0;
    while(i < lines.length) {
      const line = lines[i];
      const m = line.match(/^([^\w\s]{0,3}\s*)([A-Z][A-Z\s\-]{2,}[A-Z]):\s*(.*)/);
      if(m && m[2].trim().length>=3) {
        const label = m[1].trim()+" "+m[2].trim();
        const actionLine = m[3];
        // Next line is context if it doesn't start a new section
        const nextLine = lines[i+1];
        const isNextSection = nextLine && nextLine.match(/^[^\w\s]{0,3}\s*[A-Z][A-Z\s\-]{2,}[A-Z]:/);
        const contextLine = (!isNextSection && nextLine) ? lines[++i] : null;
        result.push(
          <div key={i} style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",color:C.t2,marginBottom:3}}>{label}</div>
            {actionLine&&<div style={{fontSize:13,color:C.tx,lineHeight:1.5,marginBottom:contextLine?2:0}}>{renderBold(actionLine)}</div>}
            {contextLine&&<div style={{fontSize:12,color:C.t2,lineHeight:1.5}}>{renderBold(contextLine)}</div>}
          </div>
        );
      } else {
        result.push(<div key={i} style={{fontSize:12,color:C.t2,lineHeight:1.5,marginBottom:3}}>{renderBold(line)}</div>);
      }
      i++;
    }
    return result;
  }

  async function genAI(type) {
    if (!apiKey) return;
    setLoading(l=>({...l,[type]:true}));
    try { await genAIInner(type); } finally { setLoading(l=>({...l,[type]:false})); }
  }
  async function genAIInner(type) {
    const now = new Date();
    const todayKey = now.toLocaleDateString("en-CA",{timeZone:getTz()});
    const hourIL = parseInt(now.toLocaleString("en-CA",{timeZone:getTz(),hour:"numeric",hour12:false}));
    const isEvening = hourIL >= 21; // night mode at 9pm, not 7pm
    const dowIL = new Date(...todayKey.split("-").map((v,i)=>i===1?Number(v)-1:Number(v))).getDay();
    const isSunday = dowIL === 0;
    // Cycle phase — use full dates array for confidence-aware calculation
    const _aiDatesArr = cycleLog?.period_start_dates?.length ? cycleLog.period_start_dates : cycleDates.filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d)).map(x=>x.d);
    let cyclePhase = "cycle phase unknown";
    let cyclePhaseName = "unknown";
    let _aiCycleResult = null;
    if(_aiDatesArr.length){_aiCycleResult=calculateCyclePhase(_aiDatesArr,cycleLog?.avg_period_length||5);cyclePhaseName=_aiCycleResult.phase;cyclePhase=`cycle day ${_aiCycleResult.cycleDay}/${_aiCycleResult.avgCycleLength}, ${_aiCycleResult.phase} phase (confidence: ${_aiCycleResult.confidence})`;}
    // Today nutrition
    const todayFoodKey = todayKey; // already timezone-aware (en-CA local)
    const tf = allFood[todayFoodKey]||[];
    const liveProt = Math.round(tf.reduce((s,e)=>s+(e.p||0),0));
    const liveCarbs = Math.round(tf.reduce((s,e)=>s+(e.c||0),0));
    const liveKcal = Math.round(tf.reduce((s,e)=>s+(e.k||0),0));
    // Yesterday alcohol from log
    const yKey = new Date(now.getTime()-864e5).toLocaleDateString("en-CA",{timeZone:getTz()});
    const yAlc = logEntries.filter(e=>e.dt&&e.dt.slice(0,10)===yKey&&/wine|alcohol|beer|drink/i.test(e.txt||"")).map(e=>e.txt).join("; ");
    // Last sleep — use shared function so this matches the sleep card
    const lastSleep=getLastNightSleep(fitbitData,getTz());
    const sleepSummary = lastSleep?`${Math.floor(lastSleep.total/60)}h${lastSleep.total%60}m (deep ${lastSleep.deep}m, REM ${lastSleep.rem}m, bedtime ${lastSleep.bedtime})`:(isSleepDataStale(fitbitData,getTz())?"stale — skip sleep analysis":"not tracked last night — skip sleep analysis");
    // Today workouts
    const todayWorkouts=(fitbitData.workouts||[]).filter(w=>w.date===todayKey);
    const todayActivity=todayWorkouts.length?todayWorkouts.filter(w=>w.type!=="walk"&&w.type!=="walking").map(w=>w.type+(w.duration_min?` ${w.duration_min}min`:"")||w.type).join(", "):"no workout yet";
    // Today pain/mood log
    const todayLog = logEntries.filter(e=>e.dt&&e.dt.slice(0,10)===todayFoodKey).map(e=>`[${e.tag}] ${e.txt}`).join("; ");
    // This week food per day + workouts
    const weekFoodLines=[];
    const weekWorkoutLines=[];
    for(let i=0;i<=dowIL;i++){
      const d=new Date(now.getTime()-(dowIL-i)*864e5);
      const dk=d.toLocaleDateString("en-CA",{timeZone:getTz()});
      const dayLabel=d.toLocaleDateString("en-GB",{weekday:"short",timeZone:getTz()});
      const m=allFood[dk]||[];
      if(m.length){const p=Math.round(m.reduce((s,e)=>s+(e.p||0),0));const c=Math.round(m.reduce((s,e)=>s+(e.c||0),0));const k=Math.round(m.reduce((s,e)=>s+(e.k||0),0));weekFoodLines.push(`${dayLabel}: ${p}g prot ${c}g carb ${k}kcal`);}
      const dw=(fitbitData.workouts||[]).filter(w=>w.date===dk);
      if(dw.length) weekWorkoutLines.push(`${dayLabel}: ${dw.map(w=>w.type+(w.duration_min?` ${w.duration_min}min`:"")).join(" + ")}`);
    }
    const weekFoodSummary=weekFoodLines.join(" | ")||"no food logged";
    const weekWorkoutSummary=weekWorkoutLines.join(" | ")||"no workouts logged this week";
    // This week sleep
    const weekSleep=(fitbitData.sleep||[]).filter(s=>s.date>=todayKey.slice(0,7)+"-"+(parseInt(todayKey.slice(8))-dowIL).toString().padStart(2,"0")&&s.date<=todayKey).map(s=>`${s.date.slice(5)}: ${Math.floor(s.total/60)}h${s.total%60}m`).join(", ");
    const p = type==="today"
      ? `You are Julia's personal health coach. Today is ${now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}, current time in Israel: ${hourIL}:00. Julia is on ${cyclePhase}.
${isEvening?"⚠️ It is evening — the day for exercise is DONE. Do NOT suggest going to gym or training today under any circumstances.":""}
${todayLog&&/pain/i.test(todayLog)?"⚠️ PAIN LOGGED TODAY: "+todayLog+" — Do not recommend any workout. Show FLAG first.":""}
DATA: Last night sleep: ${sleepSummary}. Yesterday alcohol: ${yAlc||"none"}. Today's workout so far: ${todayActivity}. This week's workouts: ${weekWorkoutSummary}. Today food: ${liveProt}g protein (target ${protTgt}g), ${liveCarbs}g carbs, ${liveKcal}kcal.
TASK: Write exactly 3 sections:
1. One insight connecting her sleep/recovery to her data (cycle phase, yesterday's activity, or nutrition).
2. ${isEvening?"TONIGHT: wind-down or sleep prep tip for her cycle phase.":todayActivity==="no workout yet"?"TRAINING TODAY: based on this week's workout history and her readiness, suggest whether she should train today and what type (gym/cardio/yoga/rest). Be specific and decisive — one sentence.":"TRAINING: comment on today's completed workout in context of her week and recovery."}
3. One nutrition or energy insight.
Language: warm, decisive, no fluff. Only reference log entries from today/yesterday — nothing older.
FORMAT: each section = emoji + CAPS LABEL: **bold key point.** One sentence context. Total max 90 words. Cycle phase MUST appear in section 1.`
      : `You are Julia's personal health coach. Today is ${now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} (${cyclePhase}).
${isSunday?"Include a brief LAST WEEK highlight (1 sentence only).":"Do NOT mention last week at all."}
This week's workouts: ${weekWorkoutSummary}. This week's food: ${weekFoodSummary}. Sleep this week: ${weekSleep||"limited data"}.
TASK: Write 2–3 short insights connecting her data across this week. Look for patterns: does her eating pattern fit her cycle phase? Does her sleep correlate with activity or food? Any trend worth noting? Do NOT state obvious targets. Do NOT recommend specific exercises. Language: warm, forgiving.
FORMAT: each insight on its own line as: emoji + CAPS LABEL: **bold key point.** one sentence explaining the pattern. Total max 70 words. Cycle phase name MUST appear. Example format:
🌙 SLEEP PATTERN: **Your deep sleep averaged X minutes.** This correlates with Y.`;
    try {
      const txt = await callAI(p);
      if (type==="today") setAiToday(txt);
      else setAiWeek(txt);
    } catch(e) {
      if (type==="today") setAiToday("Error: "+e.message);
      else setAiWeek("Error: "+e.message);
    }
  }

  const latestSleepDate=(fitbitData.sleep||[]).reduce((m,s)=>s.date>m?s.date:m,"");
  const sevenDaysAgo=new Date(Date.now()-7*864e5).toLocaleDateString("en-CA",{timeZone:getTz()});
  const fitbitReady=latestSleepDate>=sevenDaysAgo; // false on seed data (Jun 16 is >7d ago)
  useEffect(()=>{ if(apiKey && fitbitReady) genAI("week"); },[apiKey, aiRefreshTick, latestSleepDate]);
  const todayFoodCount = (allFood[new Date().toLocaleDateString("en-CA",{timeZone:getTz()})]||[]).length;
  useEffect(()=>{ if((apiKey||IS_DEMO||profileData?.coach_content) && profileData && fitbitReady) generateAllCoachContent(); },[apiKey, latestSleepDate, profileData?.uid, aiRefreshTick]);
  // NEW-WORKOUT TRIGGER: when today's workout list gains an entry (sync or any
  // other path updating fitbitData), force one event-aware regeneration.
  // Hash guard mirrors the food/sleep pattern — same list never fires twice.
  const _todayKeyNow = new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
  const todayWorkoutHash = (fitbitData.workouts||[]).filter(w=>w.date===_todayKeyNow)
    .map(w=>w.type+"|"+(w.duration_min||"")).sort().join("||");
  useEffect(()=>{
    if(IS_DEMO||!apiKey||!profileData||!fitbitReady) return;
    const current = _todayKeyNow+":"+todayWorkoutHash;
    const stored = localStorage.getItem("coach_workout_hash") || profileData?.coach_content_workout_hash || "";
    if(stored===current) return;
    const persist = ()=>{
      localStorage.setItem("coach_workout_hash", current);
      supa("PATCH","profiles",{coach_content_workout_hash:current},"uid=eq."+UID).catch(()=>{});
    };
    const sepIdx = stored.indexOf(":");
    const storedDay = sepIdx>-1 ? stored.slice(0,sepIdx) : "";
    const storedHash = sepIdx>-1 ? stored.slice(sepIdx+1) : "";
    // New day, first run, or no workouts today: set baseline without regenerating
    // (the daily generation already covers those cases)
    if(storedDay!==_todayKeyNow || !todayWorkoutHash){ persist(); return; }
    const prevSet = new Set(storedHash.split("||").filter(Boolean));
    const added = todayWorkoutHash.split("||").filter(x=>!prevSet.has(x));
    persist();
    if(added.length===0) return; // a workout was removed/edited — no regen
    const [wType, wDur] = added[0].split("|");
    const cat = getActivityCategory(wType, profileData?.activity_mapping);
    const evt = `User just completed a ${cat!=="uncategorized"?cat:""} session (${wType}${wDur?`, ${wDur} min`:""}) today.`;
    console.log("New workout detected — regenerating coach:", evt);
    generateAllCoachContent(true, evt);
  },[todayWorkoutHash, apiKey, fitbitReady, profileData?.uid]);
  // Hydrate weekly review from the profile row when there's no local copy
  // (demo mode, or a visitor/new device on the owner link)
  useEffect(()=>{
    if(profileData?.weekly_review && (IS_DEMO || !weeklyReview?.text)){
      setWeeklyReview({text:profileData.weekly_review, dateRange:"", generatedAt:profileData.weekly_review_generated_at||new Date().toISOString(), dismissed:IS_DEMO?false:!!profileData.weekly_review_dismissed});
    }
  },[profileData?.uid]);
  // Hourly check so the 6h cache expiry actually triggers a regen while the app stays open
  useEffect(()=>{
    const iv=setInterval(()=>{ if(apiKey && profileData && fitbitReady) generateAllCoachContent(); },60*60000);
    return ()=>clearInterval(iv);
  },[apiKey, fitbitReady, profileData?.uid]);
  useEffect(()=>{ if(apiKey && profileData && fitbitReady && todayFoodCount>0) refreshNutritionOnly(); },[todayFoodCount, allFood]);
  useEffect(()=>{ if(apiKey && profileData && fitbitReady && shouldShowWeeklyReview()) generateWeeklyReview(); },[apiKey, latestSleepDate, profileData?.uid]);


  return (
    <div>
      {/* ── COACH CARD ─────────────────────────────────────── */}
      {!coachDismissed&&(()=>{
        if(!apiKey&&!coachContent) return null; // stored content renders even without a key
        if(coachLoading&&!coachContent) return (
          <Card style={{marginBottom:14,borderLeft:`3px solid ${C.pu}`}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",color:C.pu,marginBottom:6,textTransform:"uppercase"}}>🧠 Your coach</div>
            <div style={{fontSize:13,color:C.t3}}>Your coach is reviewing your night...</div>
          </Card>
        );
        if(!coachContent) return null;
        return (
          <Card style={{marginBottom:14,borderLeft:`3px solid ${C.pu}`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",color:C.pu,textTransform:"uppercase"}}>{coachContent.isWeekly?"📋 Weekly letter":"🧠 Your coach"}</div>
                  {coachContent._generatedAt&&<div style={{fontSize:10,color:C.t3}}>{"Updated "+new Date(coachContent._generatedAt).toLocaleTimeString("en-GB",{timeZone:getTz(),hour:"2-digit",minute:"2-digit"})}</div>}
                </div>
                <div style={{fontSize:13,color:coachContent.isLearning?C.t2:C.tx,lineHeight:1.65}}>{coachContent.headline}</div>
                {coachContent.why&&(
                  <div style={{overflow:"hidden",maxHeight:showWhy?"600px":"0",transition:"max-height .4s ease",marginTop:showWhy?6:0}}>
                    <div style={{fontSize:12,color:C.t2,lineHeight:1.6,paddingTop:4,borderTop:`.5px solid ${C.bd}`}}>{coachContent.why}</div>
                  </div>
                )}
                {coachContent.why&&!coachContent.isLearning&&(
                  <button onClick={()=>setShowWhy(v=>!v)} style={{background:"none",border:"none",padding:0,marginTop:6,fontSize:11,color:C.pu,cursor:"pointer",fontWeight:500}}>{showWhy?"▲ Less":"Why?"}</button>
                )}
              </div>
              <button onClick={()=>setCoachDismissed(true)} style={{background:"none",border:"none",fontSize:16,cursor:"pointer",color:C.t3,flexShrink:0,marginTop:-2}}>×</button>
            </div>
          </Card>
        );
      })()}

      {/* READINESS */}
      {(()=>{
        // ── Shared readiness calculation ─────────────────────────────────
        const todayIL2 = new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
        const lastSleep = getLastNightSleep(fitbitData, getTz());
        const sleepStale = isSleepDataStale(fitbitData, getTz());
        if(!lastSleep) return (
          <Card>
            <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>
              Readiness today — {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}
            </div>
            <div style={{fontSize:14,color:C.t2,padding:"10px 0"}}>{sleepStale?"No new sleep data yet — check your Fitbit sync.":"No sleep tracked last night — readiness score unavailable."}</div>
            <div style={{fontSize:11,color:C.t3}}>{sleepStale?"Pull down to sync, or open your Fitbit app.":"Wear your watch tonight to get a full readiness score tomorrow."}</div>
          </Card>
        );

        // Luteal phase detection
        const _rDatesArr = cycleLog?.period_start_dates?.length ? cycleLog.period_start_dates : cycleDates.filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d)).map(x=>x.d);
        let isLuteal = false;
        if(_rDatesArr.length){const _rRes=calculateCyclePhase(_rDatesArr,cycleLog?.avg_period_length||5);isLuteal=_rRes.phase==="luteal";}

        // "Yesterday" = calendar date of last sleep's date minus 1 day
        const yDate = lastSleep ? (()=>{
          const d = new Date(lastSleep.date+"T12:00:00");
          d.setDate(d.getDate()-1);
          return d.toISOString().slice(0,10);
        })() : new Date(new Date().getTime()-864e5).toLocaleDateString("en-CA",{timeZone:getTz()});

        // Sleep duration score — 28 pts
        const totalMin = lastSleep ? lastSleep.total : 0;
        const durScore = !lastSleep ? 0 : totalMin>=450?28:totalMin>=420?24:totalMin>=390?20:totalMin>=360?15:8;

        // Deep sleep % — 18 pts
        const deepPct = lastSleep&&lastSleep.total>0 ? lastSleep.deep/lastSleep.total*100 : 0;
        const deepScore = deepPct>=20?18:deepPct>=15?13:deepPct>=10?7:2;

        // REM sleep % — 14 pts (luteal thresholds apply)
        const remPct = lastSleep&&lastSleep.total>0 ? lastSleep.rem/lastSleep.total*100 : 0;
        const remScore = isLuteal
          ? (remPct>=17?14:remPct>=12?10:remPct>=8?5:1)
          : (remPct>=20?14:remPct>=15?10:remPct>=10?5:1);

        // Bedtime — 10 pts
        const bedtimeScore = (()=>{
          if(!lastSleep) return 3;
          const [bh,bm] = lastSleep.bedtime.split(":").map(Number);
          const bt = bh*60+bm;
          // convert to minutes past midnight (handle PM bedtimes as negative/large)
          const midnight = 0;
          const adjusted = bh>=12 ? bt-1440 : bt; // 22:00→-120, 23:30→-30, 00:00→0, 01:30→90
          if(adjusted<=-30) return 10; // ≤23:30
          if(adjusted<=0) return 7;    // ≤00:00
          if(adjusted<=30) return 5;   // ≤00:30
          if(adjusted<=60) return 3;   // ≤01:00
          return 1;
        })();

        // Training load — 12 pts
        // Check yesterday's workouts (yDate already accounts for the sleep record's date)
        const recentWorkouts = (fitbitData.workouts||[]).filter(w=>w.date===yDate);
        const cats = recentWorkouts.map(w=>getActivityCategory(w.type, profileData?.activity_mapping));
        const loadScore = recentWorkouts.length===0 ? 12
          : cats.some(c=>c==="mobility") && !cats.some(c=>c==="strength"||c==="cardio") ? 8
          : 6;

        // Protein — 10 pts
        const yFood = allFood[yDate]||[];
        const yProt = Math.round(yFood.reduce((s,e)=>s+(e.p||0),0));
        const protScore = yProt>=protTgt?10:yProt>=protTgt*0.75?7:yProt>=protTgt*0.5?4:0;

        // Alcohol penalty
        const alcEntries = logEntries.filter(e=>e.dt&&e.dt.slice(0,10)===yDate&&/\[alcohol\]/i.test(e.tag||""));
        const alcCount = alcEntries.length;
        const alcPenalty = alcCount===0?0:alcCount===1?3:alcCount===2?6:10;

        // RHR vs baseline — 8 pts
        const rhrRecords = [...(fitbitData.sleep||[])].sort((a,b)=>b.date.localeCompare(a.date)).filter(s=>s.rhr!=null);
        let rhrScore = 4;
        let rhrCalibrating = true;
        if(rhrRecords.length>=2){
          const sorted = [...rhrRecords].map(s=>s.rhr).sort((a,b)=>a-b);
          const mid = Math.floor(sorted.length/2);
          const baseline = sorted.length%2===0?(sorted[mid-1]+sorted[mid])/2:sorted[mid];
          const currentRhr = lastSleep?.rhr ?? rhrRecords[0]?.rhr; // fall back to most recent if no last-night data
          if(currentRhr!=null){
            rhrCalibrating = false;
            const diff = currentRhr-baseline;
            rhrScore = diff<=0?8:diff<=3?4:diff<=6?1:0;
          }
        }

        // Base total — exclude RHR from score if calibrating (no data)
        const rhrContrib = rhrCalibrating ? 0 : rhrScore;
        const baseBeforeAlc = Math.min(100, Math.max(20, durScore+deepScore+remScore+bedtimeScore+loadScore+protScore+rhrContrib));
        const base = Math.max(20, baseBeforeAlc-alcPenalty);

        // Sleep quality bonus (above 100)
        const bonusThresh1 = isLuteal ? [20,17] : [23,23];
        const bonusThresh2 = isLuteal ? [17,12] : [20,20];
        let bonus = 0;
        if(base>=60){
          if(deepPct>=bonusThresh1[0]&&remPct>=bonusThresh1[1]) bonus=8;
          else if(deepPct>=bonusThresh2[0]&&remPct>=bonusThresh2[1]) bonus=5;
        }

        const totalScore = base; // bonus displayed separately
        const scoreCol = totalScore>=85?C.tm:totalScore>=70?C.am:C.red;
        const scoreLabel = totalScore>=85?"Great":totalScore>=70?"Good":"Low";

        // Context note — lowest-scoring factor
        const factors = [
          {name:"sleep duration",pts:durScore,max:28},
          {name:"deep sleep",pts:deepScore,max:18},
          {name:"REM sleep",pts:remScore,max:14},
          {name:`bedtime (${lastSleep?.bedtime||"--:--"})`,pts:bedtimeScore,max:10},
          {name:"training load",pts:loadScore,max:12},
          {name:"protein",pts:protScore,max:10},
          ...(rhrCalibrating?[]:[{name:"RHR",pts:rhrScore,max:8}]),
        ];
        const lowestFactor = [...factors].sort((a,b)=>(a.pts/a.max)-(b.pts/b.max))[0];
        const allFull = factors.every(f=>f.pts===f.max);
        const contextNote = allFull
          ? "Strong recovery — all factors in the green."
          : alcPenalty>0
            ? `Main cost: alcohol penalty (−${alcPenalty}) + ${lowestFactor.name}.`
            : `Main cost: ${lowestFactor.name}.`;

        // Breakdown rows
        const h = Math.floor(totalMin/60);
        const mm = totalMin%60;
        const rows = [
          [`Sleep duration (${h}h ${mm}m)`, `${durScore}/28`, durScore>=28?C.tm:durScore>=20?C.am:C.red],
          [`Deep sleep (${lastSleep?.deep||0}m, ${Math.round(deepPct)}%)`, `${deepScore}/18`, deepScore>=18?C.tm:deepScore>=13?C.am:C.red],
          [`REM sleep (${lastSleep?.rem||0}m, ${Math.round(remPct)}%)${isLuteal?" ◦":""}`, `${remScore}/14`, remScore>=14?C.tm:remScore>=10?C.am:C.red],
          [`Bedtime ${lastSleep?.bedtime||"--:--"}`, `${bedtimeScore}/10`, bedtimeScore>=10?C.tm:bedtimeScore>=5?C.am:C.red],
          [`Training load yesterday`, `${loadScore}/12`, loadScore>=12?C.tm:loadScore>=8?C.am:C.red],
          [`Protein yesterday (${yProt}g)`, `${protScore}/10`, protScore>=10?C.tm:protScore>=7?C.am:C.red],
          ...(rhrCalibrating?[]:[[ `RHR vs baseline`, `${rhrScore}/8`, rhrScore>=8?C.tm:rhrScore>=4?C.am:C.red]]),
          ...(alcPenalty>0?[[`Alcohol (${alcCount} drink${alcCount>1?"s":""})`,`−${alcPenalty}`,C.red]]:[]),
        ];

        return (
          <Card>
            <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>
              Readiness today — {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}
            </div>
            {(()=>{
              // Circular readiness gauge — CSS-animated ring fill on load
              const R=40, CIRC=2*Math.PI*R;
              const off=CIRC*(1-Math.min(100,totalScore)/100);
              return (
                <div style={{display:"flex",alignItems:"center",gap:18,marginBottom:14}}>
                  <div style={{position:"relative",width:104,height:104,flexShrink:0}}>
                    <svg width="104" height="104" viewBox="0 0 104 104">
                      <circle cx="52" cy="52" r={R} fill="none" stroke={C.s2} strokeWidth="9"/>
                      <circle cx="52" cy="52" r={R} fill="none" stroke={scoreCol} strokeWidth="9"
                        strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={off}
                        transform="rotate(-90 52 52)"
                        style={{transition:"stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)"}}/>
                    </svg>
                    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      <div style={{fontSize:30,fontWeight:700,letterSpacing:-1,lineHeight:1,color:scoreCol}}>{totalScore}</div>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginTop:2}}>/ 100</div>
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:19,fontWeight:600,color:scoreCol,fontFamily:"'Playfair Display',Georgia,serif",fontStyle:"italic"}}>{scoreLabel}</div>
                    <div style={{fontSize:11.5,color:C.t3,lineHeight:1.5,marginTop:3}}>from last night's sleep, training load, protein & heart rate</div>
                  </div>
                </div>
              );
            })()}
            <div style={{display:"flex",flexDirection:"column",gap:0,border:`.5px solid ${C.bd}`,borderRadius:8,overflow:"hidden",marginBottom:10}}>
              {rows.map(([label,pts,col],i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"6px 10px",background:C.s2,borderBottom:i<rows.length-1?`.5px solid ${C.bd}`:"none"}}>
                  <span style={{color:C.t2}}>{label}</span>
                  <span style={{fontWeight:600,color:col}}>{pts}</span>
                </div>
              ))}
              {bonus>0&&(
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"6px 10px",background:C.tl}}>
                  <span style={{color:C.teal}}>✨ Sleep quality bonus (deep {Math.round(deepPct)}% + REM {Math.round(remPct)}%)</span>
                  <span style={{fontWeight:600,color:C.teal}}>{`+${bonus}`}</span>
                </div>
              )}
              {isLuteal&&(
                <div style={{fontSize:11,color:C.t3,padding:"5px 10px",background:C.s2,borderTop:`.5px solid ${C.bd}`}}>
                  ◦ Luteal phase — REM naturally lower
                </div>
              )}
            </div>
            <div style={{fontSize:11,color:C.t3,padding:"7px 10px",background:C.s2,borderRadius:8}}>
              {contextNote}
            </div>
          </Card>
        );
      })()}

      {/* ── YOUR BODY TODAY: last night / not changeable today ── */}
      <SecLabel>Your body today</SecLabel>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {/* SLEEP LAST NIGHT (detailed breakdown) */}
        <Card style={{marginBottom:0}}>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:12}}>
            Last night — {new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}
          </div>
          {(()=>{
            const todayStr=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
            const r=(fitbitData.sleep||[]).find(s=>s.date===todayStr);
            if(!r) return <div style={{color:C.t3,fontSize:13}}>Not tracked last night</div>;
            const h=Math.floor(r.total/60),m=r.total%60;
            const tot=r.deep+r.rem+r.light+r.awake;
            const todayNap=(fitbitData.naps||[]).find(n=>n.date===new Date().toLocaleDateString("en-CA",{timeZone:getTz()}));
            return (<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div>
                  <div style={{fontSize:22,fontWeight:600,letterSpacing:"-.5px"}}>{h}h {m}m</div>
                  <div style={{fontSize:11,color:C.t3}}>bedtime {r.bedtime}</div>
                </div>
                <div style={{fontSize:12,display:"flex",flexDirection:"column",gap:3,paddingTop:2}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#1a4a8a",fontWeight:500}}>Deep</span><span>{r.deep}m ({Math.round(r.deep/tot*100)}%)</span></div>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:C.sl,fontWeight:500}}>REM</span><span>{r.rem}m ({Math.round(r.rem/tot*100)}%)</span></div>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#7aa8d8",fontWeight:500}}>Light</span><span>{r.light}m</span></div>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:C.t3}}>Awake</span><span>{r.awake}m</span></div>
                </div>
              </div>
              <div style={{height:10,borderRadius:5,background:C.s2,overflow:"hidden",display:"flex"}}>
                <div style={{width:Math.round(r.deep/tot*100)+"%",background:"#1a4a8a"}}/>
                <div style={{width:Math.round(r.rem/tot*100)+"%",background:C.sl}}/>
                <div style={{width:Math.round(r.light/tot*100)+"%",background:"#7aa8d8"}}/>
                <div style={{width:Math.round(r.awake/tot*100)+"%",background:"#D3D1C7"}}/>
              </div>
              {todayNap&&(
                <div style={{marginTop:8,padding:"6px 8px",background:C.tl,borderRadius:6,fontSize:11,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:C.sl,fontWeight:500}}>&#128164; Nap at {todayNap.start}</span>
                  <span style={{color:C.sl}}>{todayNap.total}min · {todayNap.deep}m deep</span>
                </div>
              )}
            </>);
          })()}
        </Card>

        {/* RESTING HR + CYCLE PHASE alongside the sleep breakdown */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {(()=>{
            const todayStr=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
            const recs=[...(fitbitData.sleep||[])].sort((a,b)=>b.date.localeCompare(a.date)).filter(x=>x.rhr!=null);
            const cur=(fitbitData.sleep||[]).find(x=>x.date===todayStr)?.rhr ?? recs[0]?.rhr ?? null;
            return <Metric label="Resting HR" value={cur!=null?<span style={{color:C.sl}}>{cur}<span style={{fontSize:12,fontWeight:400}}> bpm</span></span>:<span style={{color:C.t3}}>—</span>} sub={cur!=null?"last night":"no data"} subColor={C.sl}/>;
          })()}
          <CyclePhaseMetric cycleDates={cycleDates} cycleLog={cycleLog}/>
        </div>
      </div>

      {/* TODAY'S INSIGHTS */}
      {(apiKey||coachContent)&&(
        <div style={s.aiCard}>
          <div style={{...s.aiLbl,justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.pu}}/>
              Today's insights
            </div>
            {coachContent?._generatedAt&&<div style={{fontSize:10,color:C.t3}}>{"Updated "+new Date(coachContent._generatedAt).toLocaleTimeString("en-GB",{timeZone:getTz(),hour:"2-digit",minute:"2-digit"})}</div>}
          </div>
          {(()=>{
            const loading_ = coachLoading && !coachContent;
            const DOMAIN_LABELS = {
              sleep_quality:"😴 Sleep", cycle_phase:"🌙 Cycle", protein_total:"🥗 Nutrition",
              training_load:"💪 Training", step_pattern:"👟 Movement", food_pattern:"🍽️ Food",
              bedtime_pattern:"🕐 Bedtime", recovery_general:"🔄 Recovery",
              weekly_trend:"📈 This week", milestone:"🏆 Milestone", tonight:"🌙 Tonight"
            };
            if(!coachContent&&!coachLoading&&!apiKey) return <div style={{fontSize:12,color:C.t3}}>{IS_DEMO?"Demo coach content not seeded yet.":"Add your API key in Settings to enable AI coaching."}</div>;
            const domainInsights = coachContent?.domain_insights||[];
            return (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {loading_ ? (
                  <>
                    <div style={{fontSize:12,color:C.t3}}>Loading...</div>
                    <div style={{fontSize:12,color:C.t3}}>Loading...</div>
                  </>
                ) : domainInsights.length>0 ? domainInsights.map((ins,i)=>(
                  <div key={ins.type+i}>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:".08em",color:C.t2,marginBottom:3}}>{DOMAIN_LABELS[ins.type]||ins.type}</div>
                    <div style={{fontSize:13,color:C.tx,lineHeight:1.6}}>{ins.content}</div>
                  </div>
                )) : coachContent?.nothing_new ? (
                  <div style={{fontSize:13,color:C.t2,lineHeight:1.6,fontStyle:"italic"}}>All looks steady today — nothing unusual to flag. Keep doing what you're doing.</div>
                ) : coachContent ? (
                  <div style={{fontSize:12,color:C.t3}}>—</div>
                ) : null}
                {coachContent?.micro_workout&&(
                  <div>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:".08em",color:C.t2,marginBottom:3}}>⚡ 5-min move</div>
                    <div style={{fontSize:13,color:C.tx,lineHeight:1.6}}>{coachContent.micro_workout}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── WHAT YOU CAN STILL DO TODAY: changeable today ── */}
      <SecLabel>What you can still do today</SecLabel>

      <div style={s.mg2}>
        <StepsMetric fitbitData={fitbitData} profileData={profileData}/>
        {(()=>{
          const todayStr=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
          const tws=(fitbitData.workouts||[]).filter(w=>w.date===todayStr);
          const types=[...new Set(tws.map(w=>w.type))];
          return <Metric label="Workouts today" value={<span style={{color:tws.length>0?C.pu:C.t3}}>{tws.length>0?tws.length:"—"}</span>} sub={types.length?types.join(" · "):"none yet"} subColor={C.pu}/>;
        })()}
      </div>

      {/* PROTEIN GOAL (extended) */}
      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>Protein goal today</div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,fontSize:13}}>
          <span style={{fontWeight:500}}>{Math.round(tp)}g logged</span>
          <span style={{color:C.t2}}>{protTgt}g target</span>
        </div>
        <div style={s.pb}><div style={s.pf(Math.min(100,Math.round(tp/protTgt*100)),C.am)}/></div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.t3}}>
          <span>{Math.min(100,Math.round(tp/protTgt*100))}%</span>
          <span>{Math.max(0,Math.round(protTgt-tp))}g remaining</span>
        </div>
      </Card>

      <hr style={s.hr}/>
      <SecLabel>{(()=>{
        const sun=getWeekStartDate();
        const sat=getWeekEndDate();
        const fmt=(d)=>d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
        return `This week — ${fmt(sun)} – ${fmt(sat)}`;
      })()}</SecLabel>

      <div style={s.mg}>
        <WeeklyStepsMetric fitbitData={fitbitData}/>
        <WeeklyWorkoutsMetric fitbitData={fitbitData}/>
        <WeeklySleepMetric fitbitData={fitbitData}/>
        <ProteinAvgMetric allFood={allFood} protTgt={protTgt}/>
      </div>

      {/* THIS WEEK SO FAR — data only, always visible */}
      {(()=>{
        const weekStart=getWeekStartDate();
        const weekKeys=Array.from({length:7},(_,i)=>{
          const d=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i);
          return d.toLocaleDateString("en-CA",{timeZone:getTz()});
        });
        const at=profileData?.activity_targets||{};
        const workoutsThisWeek=(fitbitData.workouts||[]).filter(w=>weekKeys.includes(w.date));
        const strengthDone=workoutsThisWeek.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="strength").length;
        const mobilityDone=workoutsThisWeek.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="mobility").length;
        const cardioDone=workoutsThisWeek.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="cardio").length;
        const totalDone=strengthDone+mobilityDone+cardioDone;
        const totalTarget=(at.strength||2)+(at.mobility||2)+(at.cardio||2);
        const rows=[
          ["Strength",strengthDone,at.strength||2],
          ["Mobility",mobilityDone,at.mobility||2],
          ["Cardio",cardioDone,at.cardio||2],
        ];
        return (
          <div style={s.aiCard}>
            <div style={s.aiLbl}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.pu}}/>
              This week so far
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:6}}>
              {rows.map(([label,done,target])=>(
                <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12}}>
                  <span style={{color:C.t2}}>{label}</span>
                  <span style={{fontWeight:600,color:done>=target?C.teal:C.tx}}>{done}<span style={{fontWeight:400,color:C.t3}}>/{target}</span></span>
                </div>
              ))}
              <div style={{borderTop:`1px solid ${C.bd}`,paddingTop:6,display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12}}>
                <span style={{color:C.t2,fontWeight:500}}>Total</span>
                <span style={{fontWeight:600,color:totalDone>=totalTarget?C.teal:C.tx}}>{totalDone}<span style={{fontWeight:400,color:C.t3}}>/{totalTarget}</span></span>
              </div>
            </div>
            <button onClick={()=>{
              const todayStr=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
              const stepsTotal=weekKeys.reduce((s,dk)=>{const r=(fitbitData.steps||[]).find(x=>x.date===dk);return s+(r?r.steps:0);},0);
              const weekSleepRecs=(fitbitData.sleep||[]).filter(x=>weekKeys.includes(x.date));
              const avgSleepMin=weekSleepRecs.length?Math.round(weekSleepRecs.reduce((s,r)=>s+r.total,0)/weekSleepRecs.length):0;
              const protDays=weekKeys.filter(dk=>dk<=todayStr&&(allFood[dk]||[]).reduce((s,e)=>s+(e.p||0),0)>=protTgt).length;
              const fmt=(d)=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
              const dayName=(d)=>d.toLocaleDateString("en-GB",{weekday:"short"});
              const sat=new Date(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+6);
              const satStr=sat.toLocaleDateString("en-CA",{timeZone:getTz()});
              // Covered period: week start through today (or the full week if it's over)
              const [ty2,tm2,td2]=todayStr.split("-").map(Number);
              const todayD=new Date(ty2,tm2-1,td2);
              const covEnd=todayStr>=satStr?sat:todayD;
              const isFullWeek=todayStr>=satStr;
              const period=isFullWeek
                ?`Full week · ${fmt(weekStart)} – ${fmt(sat)}`
                :`${dayName(weekStart)}–${dayName(covEnd)} so far · ${fmt(weekStart)} – ${fmt(covEnd)}`;
              const name=(profileData?.name||"My").split(" ")[0];
              shareStatsCard({
                heading:`${name==="My"?"My":name+"'s"} week`,
                subheading:period,
                rows:[
                  {label:"Total steps",value:stepsTotal.toLocaleString(),color:"#0f7b5f"},
                  {label:"Training sessions",value:`${totalDone} of ${totalTarget}`,color:"#4a42b0"},
                  {label:"Strength · Mobility · Cardio",value:`${strengthDone} · ${mobilityDone} · ${cardioDone}`,color:"#b35a1f"},
                  ...(avgSleepMin?[{label:"Avg sleep",value:`${Math.floor(avgSleepMin/60)}h ${avgSleepMin%60}m`,color:"#2d65a8"}]:[]),
                  ...(protDays?[{label:"Protein goal hit",value:`${protDays} day${protDays!==1?"s":""}`,color:"#a05f0a"}]:[]),
                ],
                footer:`shared ${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:getTz()})}`
              });
            }} style={{...s.btn("s"),...s.btnSm,fontSize:11,marginTop:4}}><Icon name="share" size={13}/> Share my week</button>
          </div>
        );
      })()}

      {/* WEEKLY REVIEW — Saturday evening + persistent until dismissed */}
      {shouldShowWeeklyReview()&&(
        <div style={s.aiCard}>
          <div style={s.aiLbl}>
            <div style={{width:6,height:6,borderRadius:"50%",background:C.pu}}/>
            Weekly review
            {weeklyReview?.dateRange&&<span style={{fontSize:10,color:C.t3,marginLeft:6}}>{weeklyReview.dateRange}</span>}
            <button onClick={()=>{const r={...weeklyReview};r.dismissed=true;setWeeklyReview(r);localStorage.setItem("weekly_review",JSON.stringify(r));}} style={{marginLeft:"auto",fontSize:10,background:"none",border:"none",color:C.t3,cursor:"pointer"}}>dismiss</button>
          </div>
          {weeklyReviewLoading&&!weeklyReview?.text
            ? <div style={{fontSize:12,color:C.t3}}><Spinner/>Writing your weekly review...</div>
            : weeklyReview?.text
              ? <BulletView text={weeklyReview.text}/>
              : <div style={{fontSize:12,color:C.t3}}>—</div>}
          {weeklyReview?.text&&!weeklyReviewLoading&&(
            <button onClick={()=>generateWeeklyReview(true)} style={{...s.btn("s"),...s.btnSm,fontSize:11,marginTop:8}}>Refresh</button>
          )}
        </div>
      )}

      {/* STEP BARS */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <Card style={{marginBottom:0}}>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>Daily steps this week</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:4,height:86}}>
            {(()=>{
              const now=new Date();
              const sundayBar=getWeekStartDate();
              const dayLabels=["S","M","T","W","T","F","S"];
              const weekSteps=dayLabels.map((_,i)=>{
                const d=new Date(sundayBar.getFullYear(),sundayBar.getMonth(),sundayBar.getDate()+i);
                const dateStr=d.toLocaleDateString("en-CA",{timeZone:getTz()});
                const rec=(fitbitData.steps||[]).find(s=>s.date===dateStr);
                const isFuture=d>now;
                const todayStr=now.toLocaleDateString("en-CA",{timeZone:getTz()});
                const isToday=dateStr===todayStr;
                return {d:dayLabels[i],s:rec?rec.steps:0,today:isToday,future:isFuture&&!isToday};
              });
              const maxStep=Math.max(...weekSteps.map(d=>d.s),1);
              return weekSteps.map((d,i)=>{
                const h=d.future?0:Math.max(Math.round((d.s/maxStep)*60),d.s>0?4:0);
                const col=d.future?C.s2:d.today?"#9FE1CB":d.s>=10000?"#0F6E56":C.tm;
                const lbl=d.future?"":d.s>=1000?(d.s/1000).toFixed(1)+"k":d.s>0?String(d.s):"";
                return <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <div style={{fontSize:8,color:C.t2,textAlign:"center",lineHeight:1.2}}>{lbl}</div>
                  <div style={{width:"100%",borderRadius:"3px 3px 0 0",height:h,background:col,minHeight:d.s>0?3:0}}/>
                  <div style={{fontSize:9,color:C.t3}}>{d.d}</div>
                </div>;
              });
            })()}
          </div>
        </Card>
        <Card style={{marginBottom:0}}>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>Sleep — last 7 days</div>
          {(()=>{
            const todayILs=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
            // Build array of last 7 calendar dates (oldest→newest)
            const dates=Array.from({length:7},(_,i)=>{
              const d=new Date(todayILs+"T12:00:00");
              d.setDate(d.getDate()-(6-i));
              return d.toISOString().slice(0,10);
            });
            const sleepByDate={};
            (fitbitData.sleep||[]).forEach(s=>{sleepByDate[s.date]=s;});
            return dates.map((date,i)=>{
              const d=sleepByDate[date];
              const dateObj=new Date(date+"T12:00:00");
              const lbl=dateObj.toLocaleDateString("en-GB",{weekday:"short",day:"numeric"});
              if(!d) return (
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,fontSize:11}}>
                  <span style={{width:42,color:C.t3,fontSize:10,flexShrink:0}}>{lbl}</span>
                  <div style={{flex:1,height:7,borderRadius:4,background:C.s2}}/>
                  <span style={{width:36,textAlign:"right",color:C.t3,fontSize:10}}>N/A</span>
                </div>
              );
              const tot=d.deep+d.rem+d.light+d.awake||1;
              const h=Math.floor(d.total/60),m=d.total%60;
              return <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,fontSize:11}}>
                <span style={{width:42,color:C.t3,fontSize:10,flexShrink:0}}>{lbl}</span>
                <div style={{flex:1,height:7,borderRadius:4,background:C.s2,overflow:"hidden",display:"flex"}}>
                  <div style={{width:Math.round(d.deep/tot*100)+"%",background:"#1a4a8a"}}/>
                  <div style={{width:Math.round(d.rem/tot*100)+"%",background:C.sl}}/>
                  <div style={{width:Math.round(d.light/tot*100)+"%",background:"#7aa8d8"}}/>
                </div>
                <span style={{width:36,textAlign:"right",color:C.t2,fontSize:11}}>{h}h{m}m</span>
              </div>;
            });
          })()}
        </Card>
      </div>

      {/* WORKOUTS LIST */}
      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:12}}>Workouts — last 7 days</div>
        {(()=>{
          const catStyle={strength:[C.pl,C.pu],mobility:[C.orl,C.or],cardio:[C.tl,C.teal]};
          const recent=[...(fitbitData.workouts||[])].sort((a,b)=>b.date.localeCompare(a.date)||b.type.localeCompare(a.type)).slice(0,10);
          if(!recent.length) return <div style={{fontSize:12,color:C.t3,textAlign:"center",padding:"12px 0"}}>No workouts logged yet</div>;
          return recent.map((w,i)=>{
            const cat=getActivityCategory(w.type, profileData?.activity_mapping);
            const [bg,col]=catStyle[cat]||[C.s2,C.t2];
            const dateObj=new Date(w.date);
            const dayLbl=dateObj.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
            const detail=[w.duration_min?w.duration_min+" min":null,w.avg_hr?w.avg_hr+"bpm":null].filter(Boolean).join(" · ")||"";
            return <div key={i} style={{...s.wi,borderBottom:i<recent.length-1?`.5px solid ${C.bd}`:"none"}}>
              <div><span style={{...s.badge(bg,col)}}>{w.type}</span><span style={{fontWeight:500}}>{dayLbl}</span></div>
              <div style={{fontSize:12,color:C.t2}}>{detail}</div>
            </div>;
          });
        })()}
      </Card>

      <hr style={s.hr}/>
      <SecLabel>Month — {new Date().toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:getTz()})}</SecLabel>

      <div style={s.mg}>
        <MonthlyMetrics fitbitData={fitbitData} allFood={allFood} protTgt={protTgt} profileData={profileData}/>
      </div>

      {/* HEATMAP */}
      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:12}}>Consistency — {new Date().toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:getTz()})}</div>
        <HeatmapGrid allFood={allFood} protTgt={protTgt} fitbitData={fitbitData} profileData={profileData}/>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",fontSize:10,color:C.t3,marginTop:8}}>
          <span><span style={{display:"inline-block",width:10,height:10,background:C.pl,border:`.5px solid ${C.pu}`,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/>Strength</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:C.orl,border:`.5px solid ${C.or}`,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/>Mobility</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:C.tl,border:`.5px solid ${C.teal}`,borderRadius:2,marginRight:3,verticalAlign:"middle"}}/>Cardio</span>
          <span><span style={{fontWeight:700,color:C.teal}}>10k</span> steps</span>
          <span><span style={{display:"inline-block",width:11,height:11,border:`2px solid ${C.tm}`,borderRadius:2,marginRight:2,verticalAlign:"middle"}}/>active day</span>
          <span><span style={{fontWeight:700,color:C.am,fontSize:9}}>P✓</span> protein goal hit</span>
        </div>
        <button onClick={()=>{
          const now3=new Date();
          const monthKey=now3.toLocaleDateString("en-CA",{timeZone:getTz()}).slice(0,7);
          const stepTarget=profileData?.step_target||8000;
          const mSteps=(fitbitData.steps||[]).filter(x=>x.date.startsWith(monthKey));
          const mWorkouts=(fitbitData.workouts||[]).filter(w=>w.date.startsWith(monthKey));
          const activeDates=new Set([...mSteps.filter(x=>x.steps>=stepTarget).map(x=>x.date),...mWorkouts.map(w=>w.date)]);
          const cat=(c)=>mWorkouts.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)===c).length;
          const totalSteps=mSteps.reduce((s,x)=>s+x.steps,0);
          const protDays=Object.entries(allFood).filter(([d,meals])=>d.startsWith(monthKey)&&meals.reduce((s,e)=>s+(e.p||0),0)>=protTgt).length;
          const name=(profileData?.name||"My").split(" ")[0];
          const todayIL3=now3.toLocaleDateString("en-CA",{timeZone:getTz()});
          const dayNum=parseInt(todayIL3.slice(8),10);
          const lastDay=new Date(parseInt(todayIL3.slice(0,4)),parseInt(todayIL3.slice(5,7)),0).getDate();
          const monthLabel=now3.toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:getTz()});
          const monthShort=now3.toLocaleDateString("en-GB",{month:"short",timeZone:getTz()});
          const monthPeriod=dayNum>=lastDay?`Full month · ${monthLabel}`:`${monthLabel} · 1–${dayNum} ${monthShort} so far`;
          shareStatsCard({
            heading:`${name==="My"?"My":name+"'s"} month`,
            subheading:monthPeriod,
            rows:[
              {label:"Active days",value:String(activeDates.size),color:"#0f7b5f"},
              {label:"Total steps",value:totalSteps.toLocaleString(),color:"#0f7b5f"},
              {label:"Strength sessions",value:String(cat("strength")),color:"#4a42b0"},
              {label:"Mobility · Cardio",value:`${cat("mobility")} · ${cat("cardio")}`,color:"#b35a1f"},
              ...(protDays?[{label:"Protein goal hit",value:`${protDays} days`,color:"#a05f0a"}]:[]),
            ],
            footer:`shared ${now3.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:getTz()})}`
          });
        }} style={{...s.btn("s"),...s.btnSm,fontSize:11,marginTop:10}}><Icon name="share" size={13}/> Share my month</button>
      </Card>

      {/* WEEK BY WEEK */}
      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:12}}>Week by week</div>
        {(()=>{
            const now2=new Date();
            const todayStr2=now2.toLocaleDateString("en-CA",{timeZone:getTz()});
            const [y2,m2,d2]=todayStr2.split("-").map(Number);
            const dow2=new Date(y2,m2-1,d2).getDay();
            // Current week Sunday (Israeli week starts Sunday)
            const currSun=new Date(y2,m2-1,d2-daysSinceWeekStart(dow2));
            // First tracked week: Sunday 7 Jun 2026 (June 1–6 was a partial pre-start week)
            const firstSun=new Date(2026,5,7);
            const fmt=(d)=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
            const fmtRange=(sun)=>{const sat=new Date(sun);sat.setDate(sun.getDate()+6);return `${fmt(sun)} – ${fmt(sat)}`;};
            const weeks=[];
            const sun=new Date(firstSun);
            while(sun<=currSun){
              const sat=new Date(sun);sat.setDate(sun.getDate()+6);
              const sunStr=sun.toLocaleDateString("en-CA",{timeZone:getTz()});
              const satStr=sat.toLocaleDateString("en-CA",{timeZone:getTz()});
              const isCurr=sun.getTime()===currSun.getTime();
              const wWorkouts=(fitbitData.workouts||[]).filter(wo=>wo.date>=sunStr&&wo.date<=satStr);
              const wSteps=(fitbitData.steps||[]).filter(s=>s.date>=sunStr&&s.date<=satStr);
              const totalSteps=wSteps.reduce((s,d)=>s+d.steps,0);
              const woTypes=[...new Set(wWorkouts.map(wo=>wo.type))];
              let detail="";
              if(totalSteps>0||wWorkouts.length>0){
                detail=`${totalSteps.toLocaleString()} steps · ${wWorkouts.length} session${wWorkouts.length!==1?"s":""}${woTypes.length?" · "+woTypes.join(", "):""}`;
              }
              weeks.push({label:`Week${isCurr?" ← current":""}`,range:fmtRange(new Date(sun)),detail,current:isCurr});
              sun.setDate(sun.getDate()+7);
            }
            return weeks;
        })().map((w,i,arr)=>(
          <div key={i} style={{...s.wi,borderBottom:i<arr.length-1?`.5px solid ${C.bd}`:"none",...(w.current?{background:C.tl,borderRadius:6,padding:"7px 8px"}:{})}}>
            <div><strong style={{fontSize:12,color:w.current?C.teal:C.tx}}>{w.label}</strong><span style={{fontSize:12,color:w.current?C.teal:C.t2,marginLeft:8}}>{w.range}</span></div>
            <div style={{fontSize:12,color:w.current?C.teal:C.t2}}>{w.detail}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function HeatmapGrid({allFood={}, protTgt=100, fitbitData={steps:[],workouts:[]}, profileData=null}) {
  const stepTarget=profileData?.step_target||8000;
  const today = new Date();
  const todayDay = today.getDate();
  const firstDay = new Date(today.getFullYear(),today.getMonth(),1).getDay();
  const daysInMonth = new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
  const month = today.getMonth()+1;
  const year = today.getFullYear();
  const pad = n=>String(n).padStart(2,"0");

  // Build lookup maps from fitbitData
  const stepsMap = {};
  (fitbitData.steps||[]).forEach(s=>{stepsMap[s.date]=s.steps;});
  const workoutMap = {};
  (fitbitData.workouts||[]).forEach(w=>{
    if(!workoutMap[w.date]) workoutMap[w.date]=[];
    workoutMap[w.date].push(w);
  });

  const days=["S","M","T","W","T","F","S"];
  const cells=[];
  days.forEach((d,i)=>cells.push(<div key={"lbl"+i} style={{fontSize:9,color:C.t3,textAlign:"center"}}>{d}</div>));
  for(let i=0;i<firstDay;i++) cells.push(<div key={"pad"+i}/>);
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${year}-${pad(month)}-${pad(d)}`;
    const wObjs=workoutMap[dateStr]||[];
    const steps=stepsMap[dateStr]||0;
    // Walks without a logged duration are auto-detected by Fitbit — don't count as active
    // Walks are auto-detected by Fitbit and too ambiguous — step count already captures movement
    const intentional=wObjs.filter(w=>w.type!=="walk"&&w.type!=="walking");
    const isActive=steps>=stepTarget||intentional.length>0;
    const cats=wObjs.map(w=>getActivityCategory(w.type, profileData?.activity_mapping));
    const hasStrength=cats.includes("strength");
    const hasMobility=cats.includes("mobility");
    const hasCardio=cats.includes("cardio")&&wObjs.some(w=>w.type!=="walk"&&w.type!=="walking");
    const types=wObjs.map(w=>w.type);
    const dayMeals=allFood[dateStr]||[];
    const dayProt=dayMeals.reduce((s,e)=>s+(e.p||0),0);
    const protHit=dayProt>=protTgt;
    cells.push(
      <div key={"d"+d} style={{borderRadius:4,background:C.s2,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",gap:2,padding:3,position:"relative",overflow:"hidden",minHeight:52,border:isActive&&d!==todayDay?`2px solid ${C.tm}`:"2px solid transparent",boxSizing:"border-box",...(d===todayDay?{outline:`2px solid ${C.tx}`,background:isActive?C.tl:C.s2}:{})}}>
        {steps>=10000&&<span style={{fontSize:7,fontWeight:700,color:C.teal,position:"absolute",top:2,right:2}}>10k</span>}
        {protHit&&<span style={{fontSize:7,fontWeight:700,color:C.am,position:"absolute",top:2,left:2}}>P✓</span>}
        {hasStrength&&<div style={{width:"100%",borderRadius:3,padding:"2px 3px",fontSize:9,fontWeight:600,textAlign:"center",background:C.pl,color:C.pu,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wObjs.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="strength").map(w=>w.type).join(", ")}</div>}
        {hasMobility&&<div style={{width:"100%",borderRadius:3,padding:"2px 3px",fontSize:9,fontWeight:600,textAlign:"center",background:C.orl,color:C.or,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wObjs.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="mobility").map(w=>w.type).join(", ")}</div>}
        {hasCardio&&<div style={{width:"100%",borderRadius:3,padding:"2px 3px",fontSize:9,fontWeight:600,textAlign:"center",background:C.tl,color:C.teal,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wObjs.filter(w=>getActivityCategory(w.type,profileData?.activity_mapping)==="cardio"&&w.type!=="walk"&&w.type!=="walking").map(w=>w.type).join(", ")}</div>}
      </div>
    );
  }
  return <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:8}}>{cells}</div>;
}

// ── SUPPLEMENT CHECKLIST COMPONENT ───────────────────────────────────────
const SUPPLEMENT_LIST = [
  "Vitamin A","Vitamin B12","Vitamin B Complex","Vitamin C","Vitamin D3","Vitamin D3+K2","Vitamin E","Vitamin K2",
  "Magnesium","Magnesium Bisglycinate","Magnesium Glycinate","Zinc","Iron","Calcium","Iodine","Selenium","Folate","Biotin",
  "Creatine","Creatine Monohydrate","Protein Powder","Whey Protein","Collagen","Collagen Peptides","BCAA","Beta-Alanine",
  "Caffeine","Pre-workout","Glutamine","Electrolytes",
  "Omega-3","Fish Oil","Multivitamin","Probiotics","Prebiotics","CoQ10","Alpha Lipoic Acid","NAC","Turmeric","Curcumin",
  "Ashwagandha","Rhodiola","Melatonin","L-Theanine","Maca"
];
const SUPP_TIMING = ["Morning","With meal","Evening","Before workout","Before bed"];

// Preserve stable ids for the original 6 supplements so existing supplement_log
// rows keep matching; unknown supplements get a slug id from their name.
const LEGACY_SUPP_IDS = {
  "Creatine":"creatine","Omega-3":"omega3","Magnesium bisglycinate":"magnesium",
  "D3 + K2":"d3k2","Collagen":"collagen","Multivitamin":"multi"
};
function suppId(name){
  return LEGACY_SUPP_IDS[name] || (name||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
}
// Build the checklist list from profileData.supplements ({name,dose,timing}).
function suppsFromProfile(profileData){
  const list=(profileData&&profileData.supplements)||[];
  return list.map(sup=>({id:suppId(sup.name),name:sup.name,time:sup.timing||sup.dose||""}));
}

function SupplementChecklist({suppState={}, setSupp, profileData}) {
  const SUPPS = suppsFromProfile(profileData);
  const done = SUPPS.filter(s=>suppState[s.id]).length;
  return (
    <Card style={{marginTop:8}}>
      <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>
        Supplements today — {done}/{SUPPS.length} taken
        {SUPPS.length>0&&done===SUPPS.length&&<span style={{color:C.tm,marginLeft:8}}>✓ all done</span>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
        {SUPPS.map(sup=>{
          const checked=!!suppState[sup.id];
          return (
            <div key={sup.id} onClick={()=>setSupp&&setSupp(sup.id,!checked)} style={{background:checked?C.tl:C.s2,border:`.5px solid ${checked?C.tm:C.bd}`,borderRadius:8,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}>
              <div style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${checked?C.tm:C.t3}`,background:checked?C.tm:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:10,flexShrink:0}}>{checked?"✓":""}</div>
              <div><div style={{fontSize:11,fontWeight:500,lineHeight:1.2}}>{sup.name}</div><div style={{fontSize:9,color:C.t3}}>{sup.time}</div></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SupplementStack({suppState={}, setSupp, profileData, onSaveSupps}) {
  const [editing, setEditing] = useState(false);
  const [localSupps, setLocalSupps] = useState(()=>profileData?.supplements||[]);
  const [savedMsg, setSavedMsg] = useState("");
  const [query, setQuery] = useState({});

  // Sync when profileData changes
  React.useEffect(()=>{ setLocalSupps(profileData?.supplements||[]); },[profileData?.supplements]);

  if(editing) return (
    <Card style={{marginTop:8}}>
      <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:10}}>My supplement stack</div>
      {localSupps.map((sup,i)=>{
        const q=query[i]||"";
        const suggestions=q?SUPPLEMENT_LIST.filter(s=>s.toLowerCase().includes(q.toLowerCase())).slice(0,6):[];
        return (
          <div key={i} style={{display:"flex",gap:8,marginBottom:10,alignItems:"flex-start",position:"relative"}}>
            <div style={{flex:2,position:"relative"}}>
              <input value={sup.name} onChange={e=>{const v=e.target.value;setLocalSupps(a=>a.map((x,j)=>j===i?{...x,name:v}:x));setQuery(q=>({...q,[i]:v}));}} placeholder="Supplement name" style={s.input}/>
              {suggestions.length>0&&<div style={{position:"absolute",top:"100%",left:0,right:0,background:C.sf,border:`.5px solid ${C.bd}`,borderRadius:8,zIndex:20,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}>
                {suggestions.map(sg=><div key={sg} onClick={()=>{setLocalSupps(a=>a.map((x,j)=>j===i?{...x,name:sg}:x));setQuery(q=>({...q,[i]:""}));}} style={{padding:"8px 12px",fontSize:13,cursor:"pointer"}}>{sg}</div>)}
              </div>}
            </div>
            <input value={sup.dose||""} onChange={e=>setLocalSupps(a=>a.map((x,j)=>j===i?{...x,dose:e.target.value}:x))} placeholder="Dose (e.g. 500mg)" style={{...s.input,flex:1}}/>
            <select value={sup.timing||""} onChange={e=>setLocalSupps(a=>a.map((x,j)=>j===i?{...x,timing:e.target.value}:x))} style={{...s.input,flex:1}}>
              <option value="">Timing</option>
              {SUPP_TIMING.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={()=>setLocalSupps(a=>a.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.t3,fontSize:18,cursor:"pointer",padding:"6px 4px",lineHeight:1}}>×</button>
          </div>
        );
      })}
      <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
        <button onClick={()=>setLocalSupps(a=>[...a,{name:"",dose:"",timing:""}])} style={{...s.btn("s"),...s.btnSm}}>+ Add supplement</button>
        <button onClick={async()=>{const clean=localSupps.filter(x=>x.name&&x.name.trim());await onSaveSupps(clean);setSavedMsg("Saved");setTimeout(()=>setSavedMsg(""),2000);setEditing(false);}} style={s.btn("p")}>Save</button>
        <button onClick={()=>{setLocalSupps(profileData?.supplements||[]);setEditing(false);}} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>
        {savedMsg&&<span style={{fontSize:12,color:C.teal}}>{savedMsg}</span>}
      </div>
    </Card>
  );

  const SUPPS = suppsFromProfile(profileData);
  const done = SUPPS.filter(s=>suppState[s.id]).length;
  return (
    <Card style={{marginTop:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3}}>
          Supplements today — {done}/{SUPPS.length} taken
          {SUPPS.length>0&&done===SUPPS.length&&<span style={{color:C.tm,marginLeft:8}}>✓ all done</span>}
        </div>
        <button onClick={()=>setEditing(true)} style={{...s.btn("s"),...s.btnSm,fontSize:10}}>Edit stack</button>
      </div>
      <div style={{fontSize:10,color:C.t3,marginBottom:8}}>Daily reminder — tap each supplement as you take it. Resets every morning.</div>
      {SUPPS.length===0
        ? <div style={{fontSize:12,color:C.t3}}>No supplements added yet. Tap Edit stack to set up your daily supplements.</div>
        : <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
          {SUPPS.map(sup=>{
            const checked=!!suppState[sup.id];
            return (
              <div key={sup.id} onClick={()=>setSupp&&setSupp(sup.id,!checked)} style={{background:checked?C.tl:C.s2,border:`.5px solid ${checked?C.tm:C.bd}`,borderRadius:8,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}>
                <div style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${checked?C.tm:C.t3}`,background:checked?C.tm:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:10,flexShrink:0}}>{checked?"✓":""}</div>
                <div><div style={{fontSize:11,fontWeight:500,lineHeight:1.2}}>{sup.name}</div><div style={{fontSize:9,color:C.t3}}>{sup.time}</div></div>
              </div>
            );
          })}
        </div>
      }
    </Card>
  );
}

const COMMON_FOOD_SENSITIVITIES = [
  "Vegetarian", "Vegan", "Pescatarian",
  "Gluten-free", "Celiac", "Lactose intolerant", "Dairy-free",
  "Nut allergy", "Peanut allergy", "Shellfish allergy", "Egg allergy", "Soy allergy",
  "Low FODMAP", "Kosher", "Halal",
  "Diabetic — carb-conscious"
];

function FoodSensitivities({profileData, onSave}) {
  const [list, setList] = useState(()=>profileData?.food_sensitivities||[]);
  const [input, setInput] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  React.useEffect(()=>{ setList(profileData?.food_sensitivities||[]); },[profileData?.food_sensitivities]);
  const suggestions = input
    ? COMMON_FOOD_SENSITIVITIES.filter(x=>x.toLowerCase().includes(input.toLowerCase())&&!list.includes(x)).slice(0,6)
    : [];
  async function save(next){
    setList(next);
    await onSave(next);
    setSavedMsg("Saved");
    setTimeout(()=>setSavedMsg(""),2000);
  }
  function add(val){
    const v=(val||"").trim();
    if(!v||list.includes(v)) { setInput(""); return; }
    save([...list,v]);
    setInput("");
  }
  return (
    <Card style={{marginTop:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3}}>Food sensitivities & restrictions</div>
        {savedMsg&&<span style={{fontSize:11,color:C.teal}}>{savedMsg}</span>}
      </div>
      <div style={{fontSize:10,color:C.t3,marginBottom:8}}>Your coach never suggests foods that conflict with these.</div>
      {list.length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {list.map(x=>(
            <span key={x} style={{...s.pill(C.al,C.am),display:"inline-flex",alignItems:"center",gap:6}}>
              {x}
              <span onClick={()=>save(list.filter(y=>y!==x))} style={{cursor:"pointer",fontWeight:600}}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{position:"relative"}}>
        <div style={{display:"flex",gap:8}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")add(input);}}
            placeholder="Type to add — e.g. Vegetarian, nut allergy..." style={{...s.input,flex:1}}/>
          <button onClick={()=>add(input)} disabled={!input.trim()} style={{...s.btn("s"),...s.btnSm,opacity:input.trim()?1:.5}}>Add</button>
        </div>
        {suggestions.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.sf,border:`.5px solid ${C.bd}`,borderRadius:8,zIndex:20,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}>
            {suggestions.map(sg=><div key={sg} onClick={()=>add(sg)} style={{padding:"8px 12px",fontSize:13,cursor:"pointer"}}>{sg}</div>)}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── FOOD TAB ──────────────────────────────────────────────────────────────
function TabFood({allFood, setAllFood, protTgt, apiKey, onFoodLogged, suppState={}, setSupp, profileData, onSaveSupps, onSaveSensitivities}) {
  const [foodDate, setFoodDate] = useState(tkey());
  const [showTxt, setShowTxt] = useState(false);
  const [txtInput, setTxtInput] = useState("");
  const [mealDate, setMealDate] = useState(tkey());
  const [eatenTime, setEatenTime] = useState(new Date().toTimeString().slice(0,5));
  const [analysing, setAnalysing] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editEntry, setEditEntry] = useState({});
  const [reanalysing, setReanalysing] = useState(false);

  const [rowBusy, setRowBusy] = useState(null);   // index of row being re-estimated, or "add"
  const [rowError, setRowError] = useState("");
  const [newIngText, setNewIngText] = useState("");
  const [pinned, setPinned] = useState(()=>{try{return JSON.parse(localStorage.getItem("pinned_meals")||"[]");}catch{return [];}});

  function togglePin(entry){
    setPinned(prev=>{
      const exists=prev.some(p=>p.n===entry.n);
      const next=exists?prev.filter(p=>p.n!==entry.n):[...prev,{n:entry.n,det:entry.det||null,p:entry.p||0,c:entry.c||0,f:entry.f||0,k:entry.k||0,parsed_items:entry.parsed_items||null}];
      try{localStorage.setItem("pinned_meals",JSON.stringify(next));}catch{}
      return next;
    });
  }

  // Pure copy — no AI call. Clones an already-estimated meal into targetDate.
  async function cloneEntryTo(entry, targetDate, time){
    const t=time||new Date().toTimeString().slice(0,5);
    const items=(entry.parsed_items||[]).map(i=>({...i,src:"copied"}));
    const newEntry={n:entry.n,det:entry.det,p:entry.p,c:entry.c,f:entry.f,k:entry.k,time:t,eaten_time:t,source:"copied",parsed_items:items.length?items:null};
    try{
      const rows=await supa("POST","food_log",{user_id:UID,log_date:targetDate,meal_time:t,eaten_time:t,name:newEntry.n,detail:newEntry.det||null,protein:newEntry.p,carbs:newEntry.c,fat:newEntry.f,kcal:newEntry.k,parsed_items:newEntry.parsed_items?JSON.stringify(newEntry.parsed_items):null});
      if(rows&&rows[0]) newEntry.dbid=rows[0].id;
    }catch(e){
      try{
        const rows2=await supa("POST","food_log",{user_id:UID,log_date:targetDate,name:newEntry.n,detail:newEntry.det||null,protein:newEntry.p,carbs:newEntry.c,fat:newEntry.f,kcal:newEntry.k});
        if(rows2&&rows2[0]) newEntry.dbid=rows2[0].id;
      }catch(e2){}
    }
    setAllFood(prev=>{
      const updated={...prev,[targetDate]:[...(prev[targetDate]||[]),newEntry]};
      if(!IS_DEMO) localStorage.setItem("jfood_backup",JSON.stringify(updated));
      return updated;
    });
    if(onFoodLogged) onFoodLogged();
  }

  async function repeatYesterday(){
    const yKey=tkey(new Date(Date.now()-864e5)); // previous biological day in the active tz
    const meals=allFood[yKey]||[];
    if(!meals.length){ setAiMsg("Nothing logged yesterday to repeat."); return; }
    for(const m of meals){ await cloneEntryTo(m, foodDate, m.eaten_time||m.time); }
    setAiMsg(`Copied ${meals.length} meal${meals.length>1?"s":""} from yesterday ✓`);
  }

  // Frequent/recent distinct meals (excluding pinned) for the quick-relog strip
  const quickChips=(()=>{
    const counts={}, latest={};
    Object.entries(allFood).forEach(([dk,list])=>{
      (list||[]).forEach(e=>{
        if(!e.n) return;
        counts[e.n]=(counts[e.n]||0)+1;
        if(!latest[e.n]||dk>latest[e.n].dk) latest[e.n]={dk,e};
      });
    });
    const pinnedNames=new Set(pinned.map(p=>p.n));
    return Object.keys(counts).filter(n=>!pinnedNames.has(n))
      .sort((a,b)=>counts[b]-counts[a]||latest[b].dk.localeCompare(latest[a].dk))
      .slice(0,6).map(n=>latest[n].e);
  })();

  // SCOPED re-estimate: ONE ingredient only — never the whole meal.
  // Used when a descriptor/unit changed or a new ingredient is added.
  async function estimateSingleItem(descriptor, qty, unit){
    const prompt=`Estimate macros for this single food item. For Israeli foods or brands use accurate Israeli nutritional values. Do not overestimate protein.${(profileData?.food_sensitivities||[]).length?` User's dietary profile: ${profileData.food_sensitivities.join(", ")} — resolve ambiguity consistently with it.`:""}
Return ONLY strict JSON, no prose:
{"name": "cleaned item name with any stated details", "qty": number, "unit": "g|ml|piece|tbsp|cup|slice", "p": number, "c": number, "f": number, "k": number}
All macro values are integers for the stated quantity.
Item: ${descriptor}${qty?` — ${qty}${unit||""}`:""}`;
    const res=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:300,messages:[{role:"user",content:prompt}]})
    });
    const d=await res.json();
    if(d.error) throw new Error(d.error.message);
    return JSON.parse(d.content[0].text.trim().replace(/```json|```/g,"").trim());
  }

  async function reestimateRow(ii){
    if(IS_DEMO){ showDemoToast(); return; }
    if(rowBusy!==null) return;
    if(!apiKey){ setRowError("Add your API key in Settings to re-estimate this item."); return; }
    const item=editEntry.parsed_items[ii];
    setRowBusy(ii); setRowError("");
    try{
      const fresh=await estimateSingleItem(item.name, item.qty, item.unit);
      const updated={name:fresh.name||item.name, qty:fresh.qty??item.qty, unit:fresh.unit||item.unit||"",
        p:fresh.p||0, c:fresh.c||0, f:fresh.f||0, k:fresh.k||0, src:"ai_estimate"};
      const newItems=[...editEntry.parsed_items]; newItems[ii]=updated;
      setEditEntry(p=>({...p,parsed_items:newItems}));
    }catch(e){ setRowError("Couldn't re-estimate — kept the previous values. "+e.message.slice(0,60)); }
    setRowBusy(null);
  }

  async function addIngredient(){
    if(IS_DEMO){ showDemoToast(); return; }
    const txt=newIngText.trim();
    if(!txt||rowBusy!==null) return;
    if(!apiKey){ setRowError("Add your API key in Settings to estimate ingredients."); return; }
    setRowBusy("add"); setRowError("");
    try{
      const fresh=await estimateSingleItem(txt, null, null);
      const item={name:fresh.name||txt, qty:fresh.qty||1, unit:fresh.unit||"", p:fresh.p||0, c:fresh.c||0, f:fresh.f||0, k:fresh.k||0, src:"ai_estimate"};
      setEditEntry(p=>({...p,parsed_items:[...(p.parsed_items||[]),item]}));
      setNewIngText("");
    }catch(e){ setRowError("Couldn't estimate that item. "+e.message.slice(0,60)); }
    setRowBusy(null);
  }

  // Re-run the AI nutrition analysis on the edited free-text description and
  // replace name/items/macros with the fresh result (same prompt as analyseText)
  async function reanalyseEdit(){
    if(IS_DEMO){ showDemoToast(); return; }
    const txt=(editEntry.det||"").trim();
    if(!txt||reanalysing) return;
    if(!apiKey){ setAiMsg("⚠️ Add your API key in Settings to re-analyse."); return; }
    setReanalysing(true);
    try{
      const prompt = `You are a precise nutrition analyst. Analyse this food log entry and return ONLY valid JSON.

Rules:
- Break down into individual items (each ingredient or component separately)
- Preserve exact quantities mentioned. If vague, assume a realistic serving and state it in the name
- Be accurate — do not overestimate protein
- For Israeli foods or brands, use accurate Israeli nutritional values
- Translate non-English to English but keep all quantities
- All macro values are integers representing the total for that item${(profileData?.food_sensitivities||[]).length?`
- User's dietary profile: ${profileData.food_sensitivities.join(", ")}. When an entry is ambiguous, resolve assumptions consistently with this profile (e.g. plant-based default for a vegan user's "yogurt")`:""}

Return format:
{
  "n": "meal name in English (brief summary)",
  "det": "description with quantities and assumptions",
  "parsed_items": [
    {"name": "Greek yogurt", "qty": 150, "unit": "g", "p": 13, "c": 6, "f": 0, "k": 79}
  ],
  "p": 13, "c": 6, "f": 0, "k": 79
}
Totals p/c/f/k must equal the sum of parsed_items. All values are integers.

Input: ${txt}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:800,messages:[{role:"user",content:prompt}]})
      });
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      const raw = d.content[0].text.trim().replace(/```json|```/g,"").trim();
      const fresh = JSON.parse(raw);
      setEditEntry(p=>({...p, n:fresh.n||p.n, det:fresh.det||txt,
        parsed_items:fresh.parsed_items||null,
        p:fresh.p||0, c:fresh.c||0, f:fresh.f||0, k:fresh.k||0}));
    }catch(e){ setAiMsg("Re-analyse error: "+e.message); }
    setReanalysing(false);
  }

  // Sort by eaten_time (when they ate it), falling back to logged time
  const food = [...(allFood[foodDate]||[])].sort((a,b)=>{
    const ta = a.eaten_time || a.time || "";
    const tb = b.eaten_time || b.time || "";
    return ta.localeCompare(tb);
  });
  const tp=food.reduce((s,e)=>s+(e.p||0),0);
  const tc=food.reduce((s,e)=>s+(e.c||0),0);
  const tf=food.reduce((s,e)=>s+(e.f||0),0);
  const tk=food.reduce((s,e)=>s+(e.k||0),0);
  const pct=Math.min(100,Math.round(tp/protTgt*100));

  const isToday = foodDate===tkey();
  const dateLabel = isToday?"Today":new Date(foodDate).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short"});

  function prevDay(){const d=new Date(foodDate);d.setDate(d.getDate()-1);setFoodDate(d.toISOString().slice(0,10));}
  function nextDay(){const d=new Date(foodDate);d.setDate(d.getDate()+1);if(d.toISOString().slice(0,10)<=tkey())setFoodDate(d.toISOString().slice(0,10));}

  async function analyseText() {
    if(IS_DEMO){ showDemoToast(); return; }
    if(!txtInput.trim()) return;
    if(!apiKey){ setAiMsg("⚠️ Add your Anthropic API key in ⚙ Settings to analyse meals — this device doesn't have it yet."); return; }
    setAnalysing(true); setAiMsg("Analysing meal...");
    try {
      const prompt = `You are a precise nutrition analyst. Analyse this food log entry and return ONLY valid JSON.

Rules:
- Break down into individual items (each ingredient or component separately)
- Preserve exact quantities mentioned. If vague, assume a realistic serving and state it in the name
- Be accurate — do not overestimate protein
- For Israeli foods or brands, use accurate Israeli nutritional values
- Translate non-English to English but keep all quantities
- All macro values are integers representing the total for that item${(profileData?.food_sensitivities||[]).length?`
- User's dietary profile: ${profileData.food_sensitivities.join(", ")}. When an entry is ambiguous, resolve assumptions consistently with this profile (e.g. plant-based default for a vegan user's "yogurt")`:""}

Return format:
{
  "n": "meal name in English (brief summary)",
  "det": "description with quantities and assumptions",
  "parsed_items": [
    {"name": "Greek yogurt", "qty": 150, "unit": "g", "p": 13, "c": 6, "f": 0, "k": 79},
    {"name": "Honey", "qty": 1, "unit": "tbsp", "p": 0, "c": 17, "f": 0, "k": 64}
  ],
  "p": 13, "c": 23, "f": 0, "k": 143
}
Totals p/c/f/k must equal the sum of parsed_items. All values are integers.

Input: ${txtInput}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body: JSON.stringify({model:"claude-sonnet-4-6",max_tokens:800,messages:[{role:"user",content:prompt}]})
      });
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      const raw = d.content[0].text.trim().replace(/```json|```/g,"").trim();
      const entry = JSON.parse(raw);
      entry.eaten_time = eatenTime;
      entry.time = eatenTime; // keep for display compat
      entry.source = "estimated";
      entry.parsed_items = entry.parsed_items ? entry.parsed_items.map(i=>({...i,src:"ai_estimate"})) : null;
      const targetDate = mealDate || foodDate;
      let saveErr = null;
      // Try full payload first, then fall back to core columns if schema mismatch
      try {
        const rows = await supa("POST","food_log",{
          user_id:UID, log_date:targetDate, meal_time:eatenTime, eaten_time:eatenTime,
          name:entry.n, detail:entry.det||null,
          protein:entry.p, carbs:entry.c, fat:entry.f, kcal:entry.k,
          parsed_items: entry.parsed_items ? JSON.stringify(entry.parsed_items) : null
        });
        if(rows&&rows[0]) entry.dbid = rows[0].id;
      } catch(e) {
        console.log("Full save failed, trying minimal:", e.message);
        try {
          const rows2 = await supa("POST","food_log",{
            user_id:UID, log_date:targetDate,
            name:entry.n, detail:entry.det||null,
            protein:entry.p, carbs:entry.c, fat:entry.f, kcal:entry.k
          });
          if(rows2&&rows2[0]) entry.dbid = rows2[0].id;
        } catch(e2) {
          saveErr = e2.message;
          console.log("Minimal save also failed:", e2.message);
        }
      }
      setAllFood(prev=>{
        const updated = {...prev,[targetDate]:[...(prev[targetDate]||[]),entry]};
        localStorage.setItem("jfood_backup", JSON.stringify(updated));
        return updated;
      });
      setAiMsg(saveErr ? entry.n + " saved locally only — DB error: "+saveErr.slice(0,60) : entry.n + " logged ✓");
      setTxtInput(""); setShowTxt(false);
      if(onFoodLogged) onFoodLogged();
    } catch(e) { setAiMsg("Error: " + e.message); }
    setAnalysing(false);
  }

  async function delFood(i) {
    const entry=food[i];
    if(entry?.dbid){try{await supa("DELETE","food_log",null,"id=eq."+entry.dbid);}catch(e){}}
    setAllFood(prev=>{
      const updated={...prev,[foodDate]:(prev[foodDate]||[]).filter((_,j)=>j!==i)};
      localStorage.setItem("jfood_backup",JSON.stringify(updated));
      return updated;
    });
  }

  async function saveEdit() {
    const newP=parseFloat(editEntry.p)||0,newC=parseFloat(editEntry.c)||0,newF=parseFloat(editEntry.f)||0;
    const newK=Math.round(newP*4+newC*4+newF*9);
    const updated={...food[editIdx],n:editEntry.n,p:newP,c:newC,f:newF,k:newK};
    if(updated.dbid){try{await supa("PATCH","food_log",{name:updated.n,protein:newP,carbs:newC,fat:newF,kcal:newK},"id=eq."+updated.dbid);}catch(e){}}
    setAllFood(prev=>{
      const next={...prev,[foodDate]:prev[foodDate].map((e,i)=>i===editIdx?updated:e)};
      localStorage.setItem("jfood_backup",JSON.stringify(next));
      return next;
    });
    setEditIdx(null);
  }

  const feedbackMsg = ()=>{
    if(tk===0) return "";
    const msgs=[];
    if(tp>=protTgt) msgs.push("Protein goal hit ✅");
    else msgs.push(`${Math.round(protTgt-tp)}g protein to go`);
    if(tc>250) msgs.push("carbs above range");
    if(tf>80) msgs.push("fat above range");
    if(tk>2200) msgs.push("calories above range");
    return msgs.join(" · ");
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <button onClick={prevDay} style={{...s.btn("s"),...s.btnSm}}>←</button>
        <span style={{flex:1,textAlign:"center",fontSize:13,fontWeight:500}}>{dateLabel}</span>
        <button onClick={nextDay} disabled={isToday} style={{...s.btn("s"),...s.btnSm,opacity:isToday?.5:1}}>→</button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[["kcal",Math.round(tk),""],["protein",Math.round(tp)+"g",C.am],["carbs",Math.round(tc)+"g",C.or],["fat",Math.round(tf)+"g",C.t2]].map(([l,v,col])=>(
          <div key={l} style={{background:C.sf,borderRadius:8,border:`.5px solid ${C.bd}`,padding:"10px 12px",textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:600,color:col||C.tx}}>{v}</div>
            <div style={{fontSize:10,color:C.t3,marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      <Card>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,fontSize:13}}>
          <span style={{fontWeight:500}}>Daily protein goal</span>
          <span style={{color:C.t2}}>{Math.round(tp)}g / {protTgt}g</span>
        </div>
        <div style={s.pb}><div style={s.pf(pct,C.am)}/></div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.t3,marginBottom:feedbackMsg()?8:0}}>
          <span>{pct}%</span><span>{Math.max(0,Math.round(protTgt-tp))}g remaining</span>
        </div>
        {feedbackMsg()&&<div style={{fontSize:11,color:C.am,textAlign:"center",paddingTop:8,borderTop:`.5px solid ${C.bd}`}}>{feedbackMsg()}</div>}
        {(()=>{
          if(food.length<2||tp<protTgt*0.7) return null;
          const lastP=food[food.length-1]?.p||0;
          const firstP=food[0]?.p||0;
          if(lastP/tp>0.5) return <div style={{fontSize:11,color:C.t3,marginTop:8,paddingTop:8,borderTop:`.5px solid ${C.bd}`}}>{Math.round(lastP)}g of your protein came from your last meal. Spreading it across meals supports muscle synthesis more effectively.</div>;
          if(firstP/tp>0.5) return <div style={{fontSize:11,color:C.t3,marginTop:8,paddingTop:8,borderTop:`.5px solid ${C.bd}`}}>Most of your protein came early in the day. Spreading it across meals helps your body use it more efficiently.</div>;
          return null;
        })()}
      </Card>

      {aiMsg&&<div style={{fontSize:12,color:C.teal,padding:"8px 12px",background:C.tl,borderRadius:8,marginBottom:10}}>{aiMsg}</div>}

      {/* QUICK RE-LOG — zero-API repeat of already-estimated meals */}
      {(quickChips.length>0||pinned.length>0||(allFood[tkey(new Date(Date.now()-864e5))]||[]).length>0)&&(
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6,marginBottom:8,WebkitOverflowScrolling:"touch"}}>
          {(allFood[tkey(new Date(Date.now()-864e5))]||[]).length>0&&(
            <button onClick={repeatYesterday} style={{...s.btn("p"),...s.btnSm,fontSize:11,whiteSpace:"nowrap",flexShrink:0}}><Icon name="repeat" size={12}/> Repeat yesterday</button>
          )}
          {pinned.map(p=>(
            <button key={"pin"+p.n} onClick={()=>cloneEntryTo(p,foodDate)} style={{...s.btn("s"),...s.btnSm,fontSize:11,whiteSpace:"nowrap",flexShrink:0,color:C.am}}>★ {p.n}</button>
          ))}
          {quickChips.map(e=>(
            <button key={"chip"+e.n} onClick={()=>cloneEntryTo(e,foodDate)} style={{...s.btn("s"),...s.btnSm,fontSize:11,whiteSpace:"nowrap",flexShrink:0}}>{e.n}</button>
          ))}
        </div>
      )}

      <button onClick={()=>{setMealDate(foodDate);setEatenTime(new Date().toTimeString().slice(0,5));setShowTxt(true);}} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:12,width:"100%",marginBottom:14,background:C.sf,border:`1.5px dashed ${C.bd}`,borderRadius:12,cursor:"pointer",fontFamily:"inherit",fontSize:13,color:C.t2}}>
        <Icon name="plus" size={15}/> Log a meal
      </button>

      {/* FOOD ENTRIES */}
      {food.length===0
        ? <div style={{textAlign:"center",padding:"24px 16px",color:C.t3}}><strong style={{display:"block",color:C.t2,marginBottom:4}}>No meals logged{isToday?"":" for this day"}</strong>{isToday?"Tap Type to log your first meal.":""}</div>
        : food.map((e,i)=>(
          <div key={i} style={{background:C.sf,borderRadius:8,border:`.5px solid ${C.bd}`,marginBottom:6,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",padding:"10px 14px"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:13,fontWeight:500}}>{e.n}</span>
                  
                </div>
                <div style={{fontSize:11,color:C.t2,marginTop:1}}>{e.det}</div>
                {e.time&&<div style={{fontSize:10,color:C.t3,marginTop:2}}>{e.time}</div>}
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,marginRight:8}}>
                <div style={{fontSize:14,fontWeight:600,color:C.tx}}>{Math.round(e.k||0)} kcal</div>
                <div style={{display:"flex",gap:4}}>
                  <span style={{...s.pill(C.al,C.am),fontSize:10}}>{Math.round(e.p||0)}g P</span>
                  <span style={{...s.pill(C.orl,C.or),fontSize:10}}>{Math.round(e.c||0)}g C</span>
                  <span style={{...s.pill(C.s2,C.t2),fontSize:10}}>{Math.round(e.f||0)}g F</span>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                <button onClick={()=>togglePin(e)} title={pinned.some(p=>p.n===e.n)?"Unpin":"Pin for quick re-log"} style={{background:"none",border:"none",color:pinned.some(p=>p.n===e.n)?C.am:C.t3,cursor:"pointer",fontSize:13,lineHeight:1}}>{pinned.some(p=>p.n===e.n)?"★":"☆"}</button>
                <button onClick={()=>{setEditIdx(i);setRowError("");setNewIngText("");setEditEntry({n:e.n,det:e.det||"",p:Math.round(e.p||0),c:Math.round(e.c||0),f:Math.round(e.f||0),k:Math.round(e.k||0),parsed_items:e.parsed_items?JSON.parse(JSON.stringify(e.parsed_items)):null});}} style={{background:"none",border:"none",color:C.t2,cursor:"pointer",fontSize:11}}>edit</button>
                <button onClick={()=>delFood(i)} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
              </div>
            </div>
          </div>
        ))
      }

      {/* TYPE MODAL */}
      {showTxt&&(
        <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setShowTxt(false);}}>
          <div style={s.modal}>
            <h3 style={{marginBottom:6,fontSize:16,fontWeight:600}}>Describe your meal</h3>
            <p style={{fontSize:13,color:C.t2,marginBottom:16}}>Type what you ate and how much.</p>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <div style={{flex:1}}><label style={{fontSize:11,color:C.t2,display:"block",marginBottom:3}}>Date</label><input type="date" value={mealDate} onChange={e=>setMealDate(e.target.value)} style={s.input}/></div>
              <div style={{flex:1}}><label style={{fontSize:11,color:C.t2,display:"block",marginBottom:3}}>When did you eat this?</label><input type="time" value={eatenTime} onChange={e=>setEatenTime(e.target.value)} style={s.input}/></div>
            </div>
            <textarea value={txtInput} onChange={e=>setTxtInput(e.target.value)} placeholder="e.g. 150g grilled chicken, mixed salad, olive oil dressing" style={{...s.input,resize:"vertical",minHeight:72,marginBottom:16}}/>
            {!apiKey&&<div style={{fontSize:12,color:C.am,marginBottom:12,lineHeight:1.5}}>⚠️ No API key on this device yet — open ⚙ Settings and paste your Anthropic key to enable meal analysis.</div>}
            {aiMsg&&aiMsg.startsWith("⚠️")&&<div style={{fontSize:12,color:C.red,marginBottom:12,lineHeight:1.5}}>{aiMsg}</div>}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowTxt(false)} style={s.btn("s")}>Cancel</button>
              <button onClick={analyseText} disabled={analysing||!txtInput.trim()} style={{...s.btn("p"),opacity:analysing||!txtInput.trim()?.6:1}}>{analysing?"Analysing...":"Analyse"}</button>
            </div>
          </div>
        </div>
      )}

      {/* SUPPLEMENTS */}
      <SupplementStack suppState={suppState} setSupp={setSupp} profileData={profileData} onSaveSupps={onSaveSupps}/>
      <FoodSensitivities profileData={profileData} onSave={onSaveSensitivities}/>

      {/* EDIT MODAL */}
      {editIdx!==null&&(()=>{
        const hasParsed = (editEntry.parsed_items||[]).length > 0;
        const totP = hasParsed ? editEntry.parsed_items.reduce((s,i)=>s+(i.p||0),0) : (editEntry.p||0);
        const totC = hasParsed ? editEntry.parsed_items.reduce((s,i)=>s+(i.c||0),0) : (editEntry.c||0);
        const totF = hasParsed ? editEntry.parsed_items.reduce((s,i)=>s+(i.f||0),0) : (editEntry.f||0);
        const totK = hasParsed ? editEntry.parsed_items.reduce((s,i)=>s+(i.k||0),0) : (editEntry.k||0);
        return (
          <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setEditIdx(null);}}>
            <div style={{...s.modal,maxHeight:"90vh",overflowY:"auto"}}>
              <h3 style={{marginBottom:4,fontSize:16,fontWeight:600}}>Edit meal</h3>
              <input value={editEntry.n||""} onChange={e=>setEditEntry(p=>({...p,n:e.target.value}))} style={{...s.input,marginBottom:12}}/>
              {hasParsed ? (
                <>
                  <div style={{fontSize:11,color:C.t3,marginBottom:6}}>Quantity changes recalculate instantly. Editing the text of an item shows ↻ — tap it to re-estimate that item.</div>
                  {editEntry.parsed_items.map((item,ii)=>{
                    // Dirty = descriptor or unit changed vs snapshot -> needs scoped re-estimate.
                    // Quantity-only changes scale locally and never hit the API.
                    const dirty=(item._oname!==undefined&&item.name!==item._oname)||(item._ounit!==undefined&&(item.unit||"")!==item._ounit);
                    const busy=rowBusy===ii;
                    const setQty=(newQty)=>{
                      if(newQty<0) newQty=0;
                      const orig=item._orig||item;
                      const base=item._origQty||item.qty||1;
                      const updated={...item,qty:newQty,_orig:orig,_origQty:base,src:"user_edited",
                        p:Math.round((orig.p||0)*newQty/base*10)/10,
                        c:Math.round((orig.c||0)*newQty/base*10)/10,
                        f:Math.round((orig.f||0)*newQty/base*10)/10,
                        k:Math.round((orig.k||0)*newQty/base)};
                      const newItems=[...editEntry.parsed_items];newItems[ii]=updated;
                      setEditEntry(p=>({...p,parsed_items:newItems}));
                    };
                    return (
                    <div key={ii} style={{padding:"8px 0",borderBottom:`.5px solid ${C.bd}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                        <input value={item.name} onChange={e=>{
                          const v=e.target.value;
                          const newItems=[...editEntry.parsed_items];
                          newItems[ii]={...item,name:v,_oname:item._oname!==undefined?item._oname:item.name,_ounit:item._ounit!==undefined?item._ounit:(item.unit||"")};
                          setEditEntry(p=>({...p,parsed_items:newItems}));
                        }} style={{...s.input,flex:1,padding:"5px 8px",fontSize:12}}/>
                        {dirty&&<button disabled={busy} onClick={()=>reestimateRow(ii)} title="Re-estimate this item" style={{...s.btn("p"),...s.btnSm,fontSize:11,padding:"4px 10px",opacity:busy?.6:1}}>{busy?"...":"↻"}</button>}
                        <button onClick={()=>{const ni=editEntry.parsed_items.filter((_,j)=>j!==ii);setEditEntry(p=>({...p,parsed_items:ni}));}} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        {(()=>{const step=/^(g|gr|gram|grams|ml)$/.test((item.unit||"").trim().toLowerCase())?10:1;return (<>
                        <button onClick={()=>setQty(Math.max(0,(parseFloat(item.qty)||0)-step))} style={{...s.btn("s"),padding:"3px 10px",fontSize:13}}>−</button>
                        <input type="number" value={item.qty} onChange={e=>setQty(parseFloat(e.target.value)||0)} style={{...s.input,width:64,padding:"4px 6px",textAlign:"center"}}/>
                        <button onClick={()=>setQty((parseFloat(item.qty)||0)+step)} style={{...s.btn("s"),padding:"3px 10px",fontSize:13}}>+</button>
                        </>);})()}
                        <span style={{flex:"0 0 30px",color:C.t3,fontSize:10}}>{item.unit}</span>
                        <span style={{marginLeft:"auto",fontSize:10,color:dirty?C.t3:C.am,whiteSpace:"nowrap",fontStyle:dirty?"italic":"normal"}}>{dirty?"stale — tap ↻":`${Math.round(item.k||0)}kcal · P:${Math.round(item.p)} C:${Math.round(item.c)} F:${Math.round(item.f)}`}</span>
                      </div>
                    </div>
                  );})}
                  {/* + ADD INGREDIENT */}
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 0"}}>
                    <input value={newIngText} onChange={e=>setNewIngText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addIngredient();}} placeholder="+ add ingredient — e.g. cucumber, 1 slice bread, 30g feta" style={{...s.input,flex:1,padding:"5px 8px",fontSize:12}}/>
                    <button disabled={!newIngText.trim()||rowBusy==="add"} onClick={addIngredient} style={{...s.btn("s"),...s.btnSm,fontSize:11,opacity:newIngText.trim()?1:.5}}>{rowBusy==="add"?"...":"Add"}</button>
                  </div>
                  {rowError&&<div style={{fontSize:11,color:C.red,marginBottom:4}}>{rowError}</div>}
                  <div style={{display:"flex",justifyContent:"flex-end",gap:10,padding:"6px 0",fontSize:12,fontWeight:600,color:C.t2,borderTop:`.5px solid ${C.bd}`,marginTop:4}}>
                    <span>P:{Math.round(totP)}</span><span>C:{Math.round(totC)}</span><span>F:{Math.round(totF)}</span><span style={{color:C.tx}}>{Math.round(totK)} kcal</span>
                  </div>
                </>
              ) : (
                <>
                  {/* Fallback for old meals without structured items: free text + full re-analyse */}
                  <label style={{fontSize:11,color:C.t2,display:"block",marginBottom:3}}>What you ate (edit and re-analyse to recalculate macros)</label>
                  <textarea value={editEntry.det||""} onChange={e=>setEditEntry(p=>({...p,det:e.target.value}))} rows={3} style={{...s.input,marginBottom:6,resize:"vertical",fontFamily:"inherit"}}/>
                  <button onClick={reanalyseEdit} disabled={reanalysing||!(editEntry.det||"").trim()} style={{...s.btn("s"),...s.btnSm,marginBottom:12,opacity:reanalysing?.6:1}}>
                    {reanalysing?<><Spinner/>Re-analysing...</>:"🔄 Re-analyse macros from text"}
                  </button>
                  <div style={{display:"flex",gap:8,marginBottom:4}}>
                    {[["Protein (g)","p"],["Carbs (g)","c"],["Fat (g)","f"]].map(([l,k])=>(
                      <div key={k} style={{flex:1}}>
                        <label style={{fontSize:11,color:C.t2,display:"block",marginBottom:3}}>{l}</label>
                        <input type="number" value={editEntry[k]||0} onChange={e=>setEditEntry(p=>({...p,[k]:e.target.value}))} style={s.input}/>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
                <button onClick={()=>setEditIdx(null)} style={s.btn("s")}>Cancel</button>
                <button onClick={async()=>{
                  const hasParsedSave=(editEntry.parsed_items||[]).length>0;
                  // Guardrail: a text-edited row must be re-estimated before saving —
                  // its macros describe the OLD descriptor and must never be persisted.
                  if(hasParsedSave&&editEntry.parsed_items.some(it=>(it._oname!==undefined&&it.name!==it._oname)||(it._ounit!==undefined&&(it.unit||"")!==it._ounit))){
                    setRowError("An edited item needs re-estimating (tap ↻) before saving — its macros are stale.");
                    return;
                  }
                  // Totals are always derived from the rows — never trusted independently
                  const newP=hasParsedSave?Math.round(editEntry.parsed_items.reduce((s,i)=>s+(i.p||0),0)):parseFloat(editEntry.p)||0;
                  const newC=hasParsedSave?Math.round(editEntry.parsed_items.reduce((s,i)=>s+(i.c||0),0)):parseFloat(editEntry.c)||0;
                  const newF=hasParsedSave?Math.round(editEntry.parsed_items.reduce((s,i)=>s+(i.f||0),0)):parseFloat(editEntry.f)||0;
                  const newK=hasParsedSave?Math.round(editEntry.parsed_items.reduce((s,i)=>s+(i.k||0),0)):Math.round(newP*4+newC*4+newF*9);
                  const cleanItems=hasParsedSave?editEntry.parsed_items.map(it=>Object.fromEntries(Object.entries(it).filter(([k2])=>!k2.startsWith("_")))):null;
                  const newDet=hasParsedSave?cleanItems.map(i2=>`${i2.name}${i2.qty?` (${i2.qty}${i2.unit||""})`:""}`).join(", "):(editEntry.det||food[editIdx].det);
                  const updated={...food[editIdx],n:editEntry.n,det:newDet,p:newP,c:newC,f:newF,k:newK,parsed_items:cleanItems};
                  if(updated.dbid){try{await supa("PATCH","food_log",{name:updated.n,detail:updated.det||null,protein:newP,carbs:newC,fat:newF,kcal:newK,parsed_items:cleanItems?JSON.stringify(cleanItems):null},"id=eq."+updated.dbid);}catch(e){}}
                  setAllFood(prev=>{
                    const next={...prev,[foodDate]:prev[foodDate].map((e,i)=>i===editIdx?updated:e)};
                    if(!IS_DEMO) localStorage.setItem("jfood_backup",JSON.stringify(next));
                    return next;
                  });
                  setEditIdx(null);
                }} style={s.btn("p")}>Save</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── CYCLE TAB ─────────────────────────────────────────────────────────────
function TabCycle({cycleDates, setCycleDates, cycleLog, setCycleLog}) {
  const [dateInput, setDateInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [periodLenInput, setPeriodLenInput] = useState("");
  const [savingPeriodLen, setSavingPeriodLen] = useState(false);
  const [editingPeriodLen, setEditingPeriodLen] = useState(false);

  // Show dates from cycle_logs if available, else fall back to legacy cycle_dates rows
  const periodDates = cycleLog?.period_start_dates?.length
    ? cycleLog.period_start_dates
    : cycleDates.filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d)).map(x=>x.d);

  const avgPeriodLen = cycleLog?.avg_period_length || 5;
  const lastPeriodStart = cycleLog?.last_period_start || periodDates[0] || null;
  const cycleCount = periodDates.length;

  // Avg cycle length: calculated from gaps between dates
  const calcAvgFromDates = (dates) => {
    const lens=[];
    for(let i=0;i<dates.length-1;i++) lens.push(Math.round((new Date(dates[i])-new Date(dates[i+1]))/864e5));
    return lens.length ? Math.round(lens.reduce((a,b)=>a+b,0)/lens.length) : null;
  };
  const calculatedAvgCycle = calcAvgFromDates(periodDates);
  const avgCycleLen = cycleLog?.avg_cycle_length || calculatedAvgCycle || 28;

  const info = periodDates.length ? calculateCyclePhase(periodDates, avgPeriodLen) : null;

  const lutealS = avgCycleLen - 14;
  const PHASES={
    menstrual:{n:"Menstrual",days:`Days 1–${avgPeriodLen}`,c:C.red,bg:C.rl},
    follicular:{n:"Follicular",days:`Days ${avgPeriodLen+1}–${lutealS-3}`,c:C.teal,bg:C.tl},
    ovulatory:{n:"Ovulatory",days:`Days ${lutealS-2}–${lutealS}`,c:C.am,bg:C.al},
    luteal:{n:"Luteal",days:`Days ${lutealS+1}–${avgCycleLen}`,c:C.pu,bg:C.pl},
  };
  const phase = info?.phase ? PHASES[info.phase] : null;

  function buildLog(dates, overridePeriodLen) {
    const lens=[];
    for(let i=0;i<dates.length-1;i++) lens.push(Math.round((new Date(dates[i])-new Date(dates[i+1]))/864e5));
    const avg=lens.length?Math.round(lens.reduce((a,b)=>a+b,0)/lens.length):28;
    return {uid:UID,period_start_dates:dates,avg_cycle_length:avg,avg_period_length:overridePeriodLen||avgPeriodLen,last_period_start:dates[0]};
  }

  async function addDate(){
    if(!dateInput||saving) return;
    setSaving(true);
    try {
      const {merged, avgCycleLength} = await saveCycleDates(dateInput, avgPeriodLen);
      const newLog = {uid:UID,period_start_dates:merged,avg_cycle_length:avgCycleLength,avg_period_length:avgPeriodLen,last_period_start:merged[0]};
      setCycleLog(newLog);
      setCycleDates(merged.map((d,i)=>({id:i,d,ok:true})));
      localStorage.setItem("jcycle_log",JSON.stringify(newLog));
      setDateInput("");
    } catch(e){
      console.error("Cycle save error:",e.message);
      const sorted=[dateInput,...periodDates].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>new Date(b)-new Date(a)).slice(0,6);
      const newLog=buildLog(sorted, avgPeriodLen);
      setCycleLog(newLog);
      setCycleDates(sorted.map((d,i)=>({id:i,d,ok:true})));
      localStorage.setItem("jcycle_log",JSON.stringify(newLog));
      setDateInput("");
    }
    setSaving(false);
  }

  async function delDate(dateStr){
    const newDates = periodDates.filter(d=>d!==dateStr);
    if(newDates.length===0){
      const empty={uid:UID,period_start_dates:[],avg_cycle_length:28,avg_period_length:avgPeriodLen,last_period_start:null};
      setCycleLog(empty);
      setCycleDates([]);
      localStorage.removeItem("jcycle_log");
      try{await supa("POST","cycle_logs",empty,"on_conflict=uid");}catch(e){}
      return;
    }
    const newLog=buildLog(newDates, avgPeriodLen);
    setCycleLog(newLog);
    setCycleDates(newDates.map((d,i)=>({id:i,d,ok:true})));
    localStorage.setItem("jcycle_log",JSON.stringify(newLog));
    try{await supa("POST","cycle_logs",newLog,"on_conflict=uid");}catch(e){}
  }

  async function savePeriodLen(){
    const v=parseInt(periodLenInput,10);
    if(!v||v<1||v>14) return;
    setSavingPeriodLen(true);
    const newLog={...buildLog(periodDates,v),avg_period_length:v};
    setCycleLog(newLog);
    localStorage.setItem("jcycle_log",JSON.stringify(newLog));
    try{await supa("POST","cycle_logs",newLog,"on_conflict=uid");}catch(e){}
    setPeriodLenInput("");
    setSavingPeriodLen(false);
    setEditingPeriodLen(false);
  }

  const fmtDate = d => d ? new Date(d+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"}) : "—";

  return (
    <div>
      {/* ── PHASE HERO: segmented cycle ring, day marker, serif phase name ── */}
      <Card style={{marginBottom:14}}>
        {info?.cycleDay?(()=>{
          const day=info.cycleDay, len=info.avgCycleLength||avgCycleLen;
          const R=44, CIRC=2*Math.PI*R, GAP=0.012; // small gap between phase arcs
          const segs=[
            ["menstrual",1,avgPeriodLen],
            ["follicular",avgPeriodLen+1,Math.max(avgPeriodLen+1,lutealS-3)],
            ["ovulatory",Math.max(avgPeriodLen+2,lutealS-2),lutealS],
            ["luteal",lutealS+1,len],
          ];
          // When late, the marker sits at the very end of the ring (period-due point)
          const markDay=info.isLate?len:day;
          const angleFor=(d)=>2*Math.PI*((d-0.5)/len)-Math.PI/2;
          const mx=55+R*Math.cos(angleFor(markDay)), my=55+R*Math.sin(angleFor(markDay));
          return (
            <div style={{display:"flex",alignItems:"center",gap:18}}>
              <div style={{position:"relative",width:110,height:110,flexShrink:0}}>
                <svg width="110" height="110" viewBox="0 0 110 110">
                  {segs.map(([key,from,to])=>{
                    const f0=(from-1)/len+GAP/2, f1=to/len-GAP/2;
                    if(f1<=f0) return null;
                    return <circle key={key} cx="55" cy="55" r={R} fill="none"
                      stroke={PHASES[key].c} strokeOpacity={info.phase===key?1:0.28} strokeWidth="9"
                      strokeLinecap="round" strokeDasharray={`${(f1-f0)*CIRC} ${CIRC}`}
                      strokeDashoffset={-f0*CIRC} transform="rotate(-90 55 55)"/>;
                  })}
                  <circle cx={mx} cy={my} r="6" fill={phase?phase.c:C.pi} stroke="#fff" strokeWidth="2.5"/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:C.t3}}>Day</div>
                  <div style={{fontSize:28,fontWeight:700,letterSpacing:-1,lineHeight:1,color:phase?phase.c:C.tx}}>{day}</div>
                  <div style={{fontSize:9,color:info.isLate?C.am:C.t3,marginTop:2}}>{info.isLate?`+${info.daysLate} late`:`of ${len}`}</div>
                </div>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:20,fontWeight:600,color:info.isLate?C.am:(phase?phase.c:C.pi),fontFamily:"'Playfair Display',Georgia,serif",fontStyle:"italic"}}>{getPhaseDisplayText(info)}</div>
                {info.isLate
                  ? <div style={{fontSize:11.5,color:C.t2,marginTop:5}}>Was expected ~ {fmtDate(info.nextPeriod)}. Log the start when it arrives.</div>
                  : info.nextPeriod&&<div style={{fontSize:11.5,color:C.t2,marginTop:5}}>Next period ~ {fmtDate(info.nextPeriod)}</div>}
                {(info.confidence==="very_low"||info.confidence==="no_data")
                  ? <div style={{fontSize:10.5,color:C.am,marginTop:5,lineHeight:1.5}}>Rough estimate — cycles vary or data is thin. More dates will sharpen this.</div>
                  : info.cyclesUsedForCalculation>0&&<div style={{fontSize:10.5,color:C.t3,marginTop:5}}>based on {info.cyclesUsedForCalculation} logged cycle{info.cyclesUsedForCalculation!==1?"s":""}</div>}
              </div>
            </div>
          );
        })():(
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.pi,fontFamily:"'Playfair Display',Georgia,serif",fontStyle:"italic",marginBottom:4}}>Add your cycle dates to get started</div>
            <div style={{fontSize:12,color:C.t2}}>Enter your last period start date below.</div>
          </div>
        )}
      </Card>

      {/* ── CYCLE NUMBERS: three stat tiles (period length editable in place) ── */}
      {lastPeriodStart&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
          <div style={s.mc}>
            <div style={s.ml}>Avg cycle</div>
            <div style={{...s.mv,color:C.pi}}>{avgCycleLen}<span style={{fontSize:12,fontWeight:400}}> d</span></div>
            <div style={{...s.ms,color:C.t3}}>{info?.cyclesUsedForCalculation>0?`from ${info.cyclesUsedForCalculation} cycle${info.cyclesUsedForCalculation!==1?"s":""}`:"default"}</div>
          </div>
          <div style={{...s.mc,position:"relative"}}>
            <div style={s.ml}>Avg period</div>
            {editingPeriodLen?(
              <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                <input type="number" min="2" max="10" value={periodLenInput} onChange={e=>setPeriodLenInput(e.target.value)} style={{...s.input,width:46,padding:"3px 6px",textAlign:"center"}} autoFocus/>
                <button onClick={savePeriodLen} disabled={savingPeriodLen||!periodLenInput} style={{...s.btn("p"),padding:"3px 8px",fontSize:11}}>✓</button>
                <button onClick={()=>{setEditingPeriodLen(false);setPeriodLenInput("");}} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:13}}>×</button>
              </div>
            ):(
              <>
                <div style={{...s.mv,color:C.pi}}>{avgPeriodLen}<span style={{fontSize:12,fontWeight:400}}> d</span></div>
                <div style={{...s.ms,color:C.t3}}>days of flow</div>
                <button title="Edit period length" onClick={()=>{setEditingPeriodLen(true);setPeriodLenInput(String(avgPeriodLen));}} style={{position:"absolute",top:8,right:8,background:"none",border:"none",color:C.t3,cursor:"pointer",padding:2}}><Icon name="log" size={11}/></button>
              </>
            )}
          </div>
          <div style={s.mc}>
            <div style={s.ml}>Next period</div>
            <div style={{...s.mv,color:C.pi,fontSize:16}}>{info?.nextPeriod?new Date(info.nextPeriod+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"—"}</div>
            <div style={{...s.ms,color:C.t3}}>{info?.nextPeriod?new Date(info.nextPeriod+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long"}):"estimate"}</div>
          </div>
        </div>
      )}

      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:8}}>Cycle history</div>
        <p style={{fontSize:11.5,color:C.t2,marginBottom:12}}>Add each period start date (day 1 = first day of full flow). More dates → sharper predictions for your coach.</p>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <input type="date" value={dateInput} onChange={e=>setDateInput(e.target.value)} style={{...s.input,flex:1}}/>
          <button onClick={addDate} disabled={saving} style={{...s.btn("p"),...s.btnSm}}>{saving?"Saving...":"Add"}</button>
        </div>
        {periodDates.length===0
          ? <div style={{textAlign:"center",padding:"12px 0",color:C.t3,fontSize:13}}><strong style={{display:"block",color:C.t2}}>No dates added yet</strong>Add your most recent period start date above.</div>
          : periodDates.map((d,i)=>(
            <div key={d} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:i<periodDates.length-1?`.5px solid ${C.bd}`:"none",fontSize:12}}>
              <strong>{fmtDate(d)}</strong>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {i===0&&<span style={{...s.pill(C.tl,C.teal),fontSize:10}}>Most recent</span>}
                <button onClick={()=>delDate(d)} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:18,lineHeight:1,padding:"0 4px"}}>×</button>
              </div>
            </div>
          ))
        }
      </Card>

      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:12}}>Phase guide</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {Object.entries(PHASES).map(([key,p])=>(
            <div key={key} style={{padding:10,background:p.bg,borderRadius:10,border:info?.phase===key?`1.5px solid ${p.c}`:"1.5px solid transparent"}}>
              <div style={{fontSize:11,fontWeight:600,color:p.c,marginBottom:4}}>{p.n.toUpperCase()} · {p.days}{info?.phase===key&&<span style={{marginLeft:6,fontSize:9,fontWeight:700}}>← NOW</span>}</div>
              <div style={{fontSize:11,color:C.t2,lineHeight:1.5}}>
                {key==="menstrual"?"Lower intensity. Gentle yoga, walking. Iron-rich foods. Rest is productive.":
                 key==="follicular"?"Rising energy. Best window for new challenges and heavier strength work.":
                 key==="ovulatory"?"Peak strength. Ideal for gym sessions. High protein supports performance.":
                 "Fatigue rises. Higher protein and magnesium. Scale back from day 22."}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── LOG TAB ───────────────────────────────────────────────────────────────
const LOG_ENTRY_TYPES = [
  { id: "post_workout", label: "Post-Workout", icon: "💪" },
  { id: "pain_discomfort", label: "Pain / Discomfort", icon: "⚠️" },
  { id: "sleep_note", label: "Sleep Note", icon: "😴" },
  { id: "energy_mood", label: "Energy / Mood", icon: "⚡" },
  { id: "life_context", label: "Life Context", icon: "🌍" },
  { id: "general_note", label: "General Note", icon: "📝" },
];
const TAG_LABELS={post_workout:"💪 Post-Workout",pain_discomfort:"⚠️ Pain / Discomfort",sleep_note:"😴 Sleep Note",energy_mood:"⚡ Energy / Mood",life_context:"🌍 Life Context",general_note:"📝 General Note"};
const TAG_STYLE={post_workout:[C.orl,C.or],pain_discomfort:[C.rl,C.red],sleep_note:[C.sll,C.sl],energy_mood:[C.al,C.am],life_context:[C.pl,C.pu],general_note:[C.s2,C.t2]};
// MIGRATION NOTE: old entries keep their original tag value in the database
// (data integrity); the UI remaps them to the nearest new category for display only.
const LEGACY_TAG_MAP={pain:"pain_discomfort",spine:"pain_discomfort",medical:"life_context",life:"life_context",feedback:"post_workout",postworkout:"post_workout",training:"post_workout",mood:"energy_mood",energy:"energy_mood",sleep:"sleep_note",correction:"general_note",alcohol:"general_note"};
const displayTag=(tag)=>TAG_LABELS[tag]?tag:(LEGACY_TAG_MAP[tag]||"general_note");
const LOG_CONFIRMATION_MESSAGES = {
  post_workout: "Got it — noted for your coach.",
  pain_discomfort: "Noted. Your coach will keep this in mind.",
  sleep_note: "Got it — this helps explain your sleep data.",
  energy_mood: "Noted — thanks for sharing how you're feeling.",
  life_context: "Got it — this gives your coach helpful context.",
  general_note: "Saved — noted for your coach.",
};

function TabLog({logEntries, setLogEntries}) {
  const [selTag, setSelTag] = useState("post_workout");
  const [txt, setTxt] = useState("");
  const [confirmMsg, setConfirmMsg] = useState("");

  async function addEntry(){
    if(!txt.trim()) return;
    const newEntry={id:Date.now(),dt:new Date().toISOString(),tag:selTag,txt:txt.trim()};
    try {
      const rows=await supa("POST","journal_entries",{user_id:UID,tag:selTag,txt:txt.trim()});
      if(rows&&rows[0]){newEntry.id=rows[0].id;newEntry.dt=rows[0].created_at;}
    }catch(e){}
    setLogEntries(prev=>{
      const updated=[newEntry,...prev];
      if(!IS_DEMO) localStorage.setItem("jlog_backup",JSON.stringify(updated));
      return updated;
    });
    setTxt("");
    setConfirmMsg(LOG_CONFIRMATION_MESSAGES[selTag]||"Saved.");
    setTimeout(()=>setConfirmMsg(""),2000);
  }

  async function delEntry(id){
    setLogEntries(prev=>prev.filter(e=>e.id!==id));
    try{await supa("DELETE","journal_entries",null,"id=eq."+id);}catch(e){}
  }

  return (
    <div>
      <div style={s.aiCard}>
        <div style={s.aiLbl}><div style={{width:6,height:6,borderRadius:"50%",background:C.pu}}/>How the AI coach uses this log</div>
        <div style={{fontSize:12,color:C.tx,lineHeight:1.65}}>Every entry is read before generating recommendations. Log how workouts felt, pain or discomfort, sleep notes, energy and mood, or life context. The coach adjusts based on what you log here.</div>
      </div>

      <Card>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:12}}>Add entry</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
          {LOG_ENTRY_TYPES.map(t=>{
            const [bg,col]=TAG_STYLE[t.id]||[C.s2,C.t2];
            const active=selTag===t.id;
            return <button key={t.id} onClick={()=>setSelTag(t.id)} style={{fontSize:11,fontWeight:500,padding:"4px 10px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",background:bg,color:col,border:`1.5px solid ${active?col:"transparent"}`,opacity:active?1:.55}}>{t.icon} {t.label}</button>;
          })}
        </div>
        <textarea value={txt} onChange={e=>setTxt(e.target.value)} placeholder="Be specific — e.g. felt strong on push-ups today, energy dipped mid-afternoon." style={{...s.input,resize:"vertical",minHeight:72,marginBottom:10}}/>
        <button onClick={addEntry} style={s.btn("p")}>Save entry</button>
        {confirmMsg&&<div style={{fontSize:12,color:C.teal,padding:"8px 12px",background:C.tl,borderRadius:8,marginTop:10}}>{confirmMsg}</div>}
      </Card>

      <SecLabel>All entries</SecLabel>
      {logEntries.length===0
        ? <div style={{textAlign:"center",padding:"24px 16px",color:C.t3}}><strong style={{display:"block",color:C.t2,marginBottom:4}}>No entries yet</strong>Start logging to build your health history.</div>
        : logEntries.map(e=>{
          const dTag=displayTag(e.tag); // legacy tags remapped for display only
          const [bg,col]=TAG_STYLE[dTag]||[C.s2,C.t2];
          const d=new Date(e.dt);
          const ds=d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
          return (
            <div key={e.id} style={{...s.card,marginBottom:8,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{...s.pill(bg,col),fontSize:10}}>{TAG_LABELS[dTag]}</span>
                  <span style={{fontSize:10,color:C.t3}}>{ds}</span>
                </div>
                <button onClick={()=>delEntry(e.id)} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:14,padding:2}}>×</button>
              </div>
              <div style={{fontSize:12,lineHeight:1.6}}>{e.txt}</div>
            </div>
          );
        })
      }
    </div>
  );
}

// ── PROFILE TAB ───────────────────────────────────────────────────────────
// Compute age in whole years from a YYYY-MM-DD birth date
function calcAge(birthDate){
  if(!birthDate) return "";
  const b=new Date(birthDate); if(isNaN(b)) return "";
  const now=new Date();
  let age=now.getFullYear()-b.getFullYear();
  const m=now.getMonth()-b.getMonth();
  if(m<0||(m===0&&now.getDate()<b.getDate())) age--;
  return age;
}

const GOAL_CARDS = [
  {id:"sleep_better", label:"I want to sleep better"},
  {id:"build_strength", label:"I want to get stronger"},
  {id:"improve_mobility", label:"I want to move better and feel less stiff"},
  {id:"more_energy", label:"I want more energy and better recovery"},
  {id:"improve_endurance", label:"I want to improve my fitness and endurance"},
  {id:"build_consistency", label:"I want to build consistent healthy habits"},
  {id:"body_composition", label:"I want to feel better in my body"},
];

const GOAL_SUBS = {
  sleep_better:{label:"Sleep better",prompt:"What matters most to you?",options:[
    {id:"longer",label:"Sleep longer",input:{type:"number",label:"Minimum hours/night",default:7,unit:"hours"}},
    {id:"earlier",label:"Sleep earlier",input:{type:"time",label:"In bed by",default:"23:00"}},
    {id:"quality",label:"Better quality sleep",note:"tracked automatically from your data"},
    {id:"all",label:"All of the above"},
  ]},
  build_strength:{label:"Build strength",prompt:"How do you want to measure progress?",options:[
    {id:"sessions",label:"Hit my weekly strength sessions"},
    {id:"progressive",label:"Lift heavier over time",note:"coming soon — log manually in journal for now"},
  ]},
  improve_mobility:{label:"Improve mobility",prompt:"How do you want to measure progress?",options:[
    {id:"sessions",label:"Hit my weekly mobility sessions"},
    {id:"feel",label:"Feel less stiff and move more freely",note:"tracked via journal entries"},
  ]},
  more_energy:{label:"More energy & recovery",prompt:"How do you want to measure progress?",options:[
    {id:"readiness",label:"Improve my readiness score over time"},
    {id:"both",label:"Improve readiness AND feel more energised day-to-day"},
  ]},
  improve_endurance:{label:"Improve endurance",prompt:"How do you want to measure progress?",options:[
    {id:"sessions",label:"Hit my weekly cardio sessions"},
    {id:"base",label:"Build my aerobic base over time",note:"tracked via session duration trend"},
  ]},
  build_consistency:{label:"Build consistency",prompt:"How do you want to measure progress?",options:[
    {id:"active_days",label:"Hit my active days per week"},
    {id:"daily",label:"Build a daily movement habit"},
  ]},
  body_composition:{label:"Improve body composition",prompt:"How do you want to measure progress?",options:[
    {id:"body_fat",label:"Reduce body fat %",input:{type:"number",label:"Target body fat %",unit:"%",optional:true}},
    {id:"muscle",label:"Build muscle and feel stronger"},
    {id:"both",label:"Build muscle AND reduce body fat"},
  ]},
};

function getDefaultActivityTargets(goals) {
  const ids = (goals||[]).map(g => g.id);
  if (ids.includes("build_strength") && ids.includes("improve_mobility") && ids.includes("improve_endurance")) return {strength:2,mobility:2,cardio:1};
  if (ids.includes("build_strength") && ids.includes("improve_mobility")) return {strength:2,mobility:2,cardio:1};
  if (ids.includes("build_strength") && ids.includes("improve_endurance")) return {strength:2,mobility:1,cardio:2};
  if (ids.includes("improve_mobility") && ids.includes("improve_endurance")) return {strength:2,mobility:2,cardio:1};
  if (ids.includes("build_strength") || ids.includes("body_composition")) return {strength:3,mobility:1,cardio:1};
  if (ids.includes("improve_mobility")) return {strength:2,mobility:2,cardio:1};
  if (ids.includes("improve_endurance")) return {strength:2,mobility:1,cardio:2};
  return {strength:2,mobility:1,cardio:2};
}

function getDefaultProteinTarget(weightKg, goals) {
  if (!weightKg) return null;
  const ids = (goals||[]).map(g => g.id);
  const multiplier = (ids.includes("build_strength") || ids.includes("body_composition")) ? 2.0 : 1.6;
  return Math.round(parseFloat(weightKg) * multiplier);
}

function StructuredView({text}) {
  if(!text) return null;
  return (
    <div>
      {text.split('\n').map((line,i)=>{
        const t=line.trim();
        if(!t) return <div key={i} style={{height:6}}/>;
        if(/^⚠/.test(t)) return <div key={i} style={{background:C.al,borderRadius:6,padding:"6px 10px",fontSize:12,color:C.am,marginBottom:6,lineHeight:1.5}}>{t}</div>;
        if(/^[A-Z][A-Z &/()-]{2,}$/.test(t)) return <div key={i} style={{fontSize:10,fontWeight:700,letterSpacing:".1em",color:C.t3,marginTop:12,marginBottom:4}}>{t}</div>;
        if(/^[•\-]/.test(t)) return <div key={i} style={{display:"flex",gap:8,marginBottom:4,fontSize:13}}><span style={{color:C.pu,flexShrink:0,marginTop:1}}>•</span><span style={{color:C.tx,lineHeight:1.55}}>{t.replace(/^[•\-]\s*/,"")}</span></div>;
        return <div key={i} style={{fontSize:12,color:C.t2,marginBottom:3,lineHeight:1.55}}>{t}</div>;
      })}
    </div>
  );
}

function WorkoutView({text, healthNotes, apiKey, onUpdatePlan, onClearFlag}) {
  const [suggesting, setSuggesting] = React.useState({});
  if(!text) return null;

  // Strip markdown the model may emit (#, **bold**, bullets, --- rules)
  const clean=(l)=>l.replace(/^#{1,6}\s*/,"").replace(/^[-*+]\s+/,"").replace(/\*\*/g,"").replace(/^\d+\.\s+/,"").trim();

  // First pass: collect all ⚠️ FLAGGED lines
  const flagged = {};
  text.split('\n').forEach(line=>{
    const t=clean(line);
    const m=t.match(/^⚠️\s*(?:FLAGGED:)?\s*(.+?)\s*[—\-]\s*(.+)$/i);
    if(m&&/^⚠/.test(t)) flagged[m[1].trim().toLowerCase()]=m[2].trim();
  });

  // Second pass: build sections.
  // Header = markdown heading, or a line with no lowercase letters (allows
  // digits/punctuation like "STRENGTH DAY 1 — FULL BODY (~60 MIN)"), or a
  // short line ending in ':'. Nothing is ever dropped — unmatched lines
  // render as plain notes inside the current section.
  const sections=[];
  let cur=null;
  const ensure=()=>{ if(!cur){cur={title:null,exercises:[]};sections.push(cur);} return cur; };
  text.split('\n').forEach(raw=>{
    const isMdHeading=/^#{1,6}\s+/.test(raw.trim());
    const t=clean(raw);
    if(!t||/^[-–—_*=]{3,}$/.test(t)) return;           // blank or horizontal rule
    if(/^⚠/.test(t)) return;                            // flags handled above
    const noLower=!/[a-z]/.test(t) && /[A-Z]/.test(t) && t.length<=70;
    if(isMdHeading||noLower||(/:$/.test(t)&&t.length<=48)){
      cur={title:t.replace(/:$/,""),exercises:[]};sections.push(cur);return;
    }
    const sec=ensure();
    const dash=t.indexOf(' — ')>-1?t.indexOf(' — '):t.indexOf(' - ');
    if(dash>-1){
      const name=t.slice(0,dash).trim();
      const cols=t.slice(dash+3).split(/\s*·\s*/).map(x=>x.trim()).filter(Boolean);
      sec.exercises.push({name,cols,raw:t});
    } else {
      sec.exercises.push({name:t,cols:[],raw:t,note:true}); // keep it visible
    }
  });

  async function suggest(ex, reason) {
    setSuggesting(s=>({...s,[ex.name]:{loading:true}}));
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:150,messages:[{role:"user",content:
          `Workout plan:\n${text}\n\nHealth restrictions: ${healthNotes||"none"}\n\n"${ex.name}" is flagged: ${reason}\n\nSuggest ONE safe replacement that targets similar muscles. Reply with just the exercise line in this exact format (copy the weight/sets/rest style from the rest of the plan): Exercise name — weight · sets×reps · rest\nNo explanation.`
        }]})
      });
      const d=await res.json();
      setSuggesting(s=>({...s,[ex.name]:{loading:false,suggestion:d.content?.[0]?.text?.trim()||""}}));
    }catch(e){setSuggesting(s=>({...s,[ex.name]:{loading:false,error:true}}));}
  }

  function accept(oldName, suggestion) {
    const newLines=text.split('\n')
      .filter(l=>!(/^⚠/.test(l.trim())&&l.toLowerCase().includes(oldName.toLowerCase())))
      .map(l=>l.trim().toLowerCase().startsWith(oldName.toLowerCase())?suggestion:l);
    onUpdatePlan(newLines.join('\n'));
    setSuggesting(s=>{const n={...s};delete n[oldName];return n;});
  }

  return (
    <div>
      {sections.map((sec,si)=>(
        <div key={si} style={{marginBottom:18}}>
          {sec.title&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:C.t3,marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.s2}`}}>{sec.title}</div>}
          {sec.exercises.map((ex,ei)=>{
            const flagKey=Object.keys(flagged).find(k=>ex.name.toLowerCase().includes(k)||k.includes(ex.name.toLowerCase()));
            const reason=flagKey?flagged[flagKey]:null;
            const sug=suggesting[ex.name];
            // Non-exercise line (a coaching note / progression sentence) — show as prose
            if(ex.note) return <div key={ei} style={{fontSize:12,color:C.t2,lineHeight:1.6,padding:"4px 0"}}>{ex.name}</div>;
            return (
              <div key={ei} style={{marginBottom:reason?10:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 0",borderBottom:`1px solid ${C.s2}`,opacity:reason?0.55:1}}>
                  <span style={{flex:1,fontSize:13,color:reason?C.am:C.tx,fontWeight:400,textDecoration:reason?"line-through":"none"}}>{ex.name}</span>
                  {ex.cols[0]&&<span style={{fontSize:11,color:C.t2,minWidth:52,textAlign:"right",whiteSpace:"nowrap"}}>{ex.cols[0]}</span>}
                  {ex.cols[1]&&<span style={{fontSize:11,color:C.t2,minWidth:46,textAlign:"right",whiteSpace:"nowrap"}}>{ex.cols[1]}</span>}
                  {ex.cols[2]&&<span style={{fontSize:11,color:C.t3,minWidth:44,textAlign:"right",whiteSpace:"nowrap"}}>{ex.cols[2]}</span>}
                </div>
                {reason&&(
                  <div style={{background:"rgba(245,158,11,0.08)",borderRadius:6,padding:"7px 10px",marginTop:3,marginLeft:0}}>
                    <div style={{fontSize:11,color:C.am,marginBottom:6,lineHeight:1.5}}>⚠️ {reason}</div>
                    {!sug&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>suggest(ex,reason)} style={{...s.btn("s"),...s.btnSm,fontSize:11}}>Suggest replacement</button>
                      {onClearFlag&&<button onClick={()=>onClearFlag(ex.name)} style={{...s.btn("s"),...s.btnSm,fontSize:11,color:C.teal}}>✓ Cleared with my doctor</button>}
                    </div>}
                    {sug?.loading&&<span style={{fontSize:11,color:C.t2}}>Finding safe alternative...</span>}
                    {sug?.suggestion&&(
                      <div>
                        <div style={{fontSize:12,color:C.tx,marginBottom:6,padding:"5px 8px",background:C.s2,borderRadius:5,lineHeight:1.5}}>{sug.suggestion}</div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>accept(ex.name,sug.suggestion)} style={{...s.btn("p"),...s.btnSm,fontSize:11}}>Use this</button>
                          <button onClick={()=>setSuggesting(sg=>({...sg,[ex.name]:null}))} style={{...s.btn("s"),...s.btnSm,fontSize:11}}>Try again</button>
                          <button onClick={()=>setSuggesting(sg=>({...sg,[ex.name]:undefined}))} style={{...s.btn("s"),...s.btnSm,fontSize:11}}>Dismiss</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TabProfile({suppState, setSupp, profileData, setProfileData, fitbitData={workouts:[]}, apiKey}) {
  // Section A — editable personal info
  const [pa, setPa] = useState({
    name: profileData?.name||"",
    birth_date: profileData?.birth_date||"",
    gender: profileData?.gender||"female",
    height_cm: profileData?.height_cm||"",
    weight_kg: profileData?.weight_kg||"",
    body_fat_pct: profileData?.body_fat_pct||"",
    body_fat_target_pct: profileData?.body_fat_target_pct||"",
    // timezone lives in Settings, not here
  });
  const [savedA, setSavedA] = useState("");
  const [editPersonal, setEditPersonal] = useState(!profileData?.name);

  // Section B — settings & targets local state
  // Goals (new card-based flow)
  const [selectedGoals, setSelectedGoals] = useState((profileData?.goals||[]).map(g=>g.id));
  const [goalSubs, setGoalSubs] = useState(()=>{
    const m={};
    (profileData?.goals||[]).forEach(g=>{m[g.id]={option:g.definition,inputValue:g.target_value||g.target_bedtime||""};});
    return m;
  });
  const [editGoals, setEditGoals] = useState(!(profileData?.goals?.length>0));
  const [savedGoals, setSavedGoals] = useState("");
  // Activity targets
  const defaultTargets = getDefaultActivityTargets(profileData?.goals);
  const [targets, setTargets] = useState(()=>{
    const raw = profileData?.activity_targets;
    if(!raw) return defaultTargets;
    const m = {strength: raw.strength||defaultTargets.strength, mobility: raw.mobility||raw.movement||defaultTargets.mobility, cardio: raw.cardio||defaultTargets.cardio};
    // If total ≠ 5 (e.g. old saved 2+2+2=6), use goal-derived defaults instead
    return (m.strength+m.mobility+m.cardio)===5 ? m : defaultTargets;
  });
  const [editTargets, setEditTargets] = useState(()=>{
    const raw = profileData?.activity_targets;
    if(!raw) return true;
    const m = {strength:raw.strength||0, mobility:raw.mobility||raw.movement||0, cardio:raw.cardio||0};
    return (m.strength+m.mobility+m.cardio) !== 5;
  });
  const [savedTargets, setSavedTargets] = useState("");
  const [mapping, setMapping] = useState(profileData?.activity_mapping||{});
  const [savedMapping, setSavedMapping] = useState("");
  // Goal Foundations
  const calcProt = getDefaultProteinTarget(pa.weight_kg||profileData?.weight_kg, profileData?.goals);
  const [foundTargets, setFoundTargets] = useState({
    step_target: profileData?.step_target||8000,
    protein_target: profileData?.protein_target||(calcProt||100),
  });
  const [editFoundations, setEditFoundations] = useState(!profileData?.step_target);
  const [savedFoundations, setSavedFoundations] = useState("");
  // Supplement dropdown state
  const [suppDropdowns, setSuppDropdowns] = useState({});
  const [supps, setSupps] = useState(profileData?.supplements||[]);
  const [savedSupps, setSavedSupps] = useState("");
  const [healthNotes, setHealthNotes] = useState(profileData?.health_notes||"");
  const [editNotes, setEditNotes] = useState(!profileData?.health_notes);
  const [notesOpen, setNotesOpen] = useState(false);
  const [processingNotes, setProcessingNotes] = useState(false);
  const [savedNotes, setSavedNotes] = useState("");
  const [workoutPlan, setWorkoutPlan] = useState(profileData?.workout_plan||"");
  const [editPlan, setEditPlan] = useState(!profileData?.workout_plan);
  const [processingPlan, setProcessingPlan] = useState(false);
  const [savedPlan, setSavedPlan] = useState("");
  const [cycleTracking, setCycleTracking] = useState(profileData?.cycle_tracking!==false);
  const [equip, setEquip] = useState(profileData?.activity_targets?.equipment||"gym");
  const [showIntake, setShowIntake] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState(null); // index of expanded past plan
  const [planErr, setPlanErr] = useState("");
  const [showTweak, setShowTweak] = useState(false);
  const [tweakText, setTweakText] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakErr, setTweakErr] = useState("");

  // Occasional plan updates in plain words ("swapped leg press for hack squat",
  // "tried 40kg, felt fine") — applied surgically, no per-session logging ritual.
  async function tweakPlan(){
    const txt=tweakText.trim();
    if(!txt||!apiKey||tweaking) return;
    setTweaking(true); setTweakErr("");
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:2500,messages:[{role:"user",content:
`You are the client's personal trainer. The client tells you, in passing, an update about their workout plan. Apply it to the plan SURGICALLY.

CLIENT SAYS: "${txt}"

RULES:
- Change ONLY the lines the comment requires (a swapped exercise, an updated weight, a removed/added movement). Every other line must remain byte-identical — same headers, same format, same order.
- If they say something worked or they moved up in weight, update that exercise's numbers accordingly.
- If they swapped a machine/exercise, replace that line with the new one in the same format (Exercise name — weight · sets×reps · rest), estimating sensible numbers from the old line.
- If the comment conflicts with the health restrictions below, still apply it but append: ⚠️ FLAGGED: [exercise] — [reason]. Honour clearances — never flag anything a physician cleared.
- If the comment is unclear or doesn't relate to the plan, return the plan unchanged.
Return ONLY the full updated plan text, nothing else.

HEALTH NOTES: ${healthNotes||"none"}

CURRENT PLAN:
${workoutPlan}`}]})});
      const d=await res.json();
      if(d.error) throw new Error(d.error.message);
      const updated=d.content?.[0]?.text?.trim()||"";
      if(updated){
        setWorkoutPlan(updated);
        await persist({workout_plan:updated}); // evolution of the same plan — no history entry
        setAssessment("");try{localStorage.removeItem("plan_assessment");}catch{}
        setTweakText(""); setShowTweak(false);
        setSavedPlan("Plan updated ✓");setTimeout(()=>setSavedPlan(""),2500);
      }
    }catch(e){ setTweakErr("Couldn't apply that — "+e.message.slice(0,80)); }
    setTweaking(false);
  }
  const [intake, setIntake] = useState(()=>({experience:"returning",session_min:60,style:"mix",notes:"",...(profileData?.activity_targets?.training_prefs||{})}));
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState(()=>{try{return localStorage.getItem("plan_assessment")||"";}catch{return "";}});

  // Shared trainer context block for both Suggest and Assess — the chain:
  // goals -> weekly activity targets -> health notes -> equipment -> actual recent training level
  function trainerContext(){
    const goals=(profileData?.goals||[]).map(g=>`${g.label}${g.definition?` (${g.definition})`:''}${g.target_value?` — target: ${g.target_value} ${g.target_unit||''}`:''}`).join("\n- ")||"general fitness";
    const at=profileData?.activity_targets||{};
    const pa=profileData||{};
    const age=pa.birth_date?Math.floor((new Date()-new Date(pa.birth_date))/31557600000):40;
    const w=pa.weight_kg||60, h=pa.height_cm||165;
    const bmr=pa.gender==="male"?(10*w+6.25*h-5*age+5):(10*w+6.25*h-5*age-161);
    const recent=[...(fitbitData?.workouts||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14)
      .map(x=>`${x.date} ${x.type}${x.duration_min?` ${x.duration_min}min`:''}${x.avg_hr?` avg ${x.avg_hr}bpm`:''}`).join("\n")||"no recent data";
    const equipLabel={gym:"full gym (machines, barbells, dumbbells, cables)",home:"home setup (dumbbells, bands, bodyweight)",bodyweight:"bodyweight only, no equipment"}[equip]||equip;
    const cleared=(profileData?.activity_targets?.cleared_exercises||[]);
    const clearedLine=(cleared.length?`\n- DOCTOR-CLEARED EXCEPTIONS: the client's physician explicitly approved these exercises despite the restrictions — do NOT flag, remove, or replace them: ${cleared.join(", ")}`:"")
      +`\n- CLEARANCE RULE: clearances stated in the health notes (e.g. a CLEARANCES section, "doctor cleared me for...") OVERRIDE the restrictions they refer to. Never flag or avoid anything covered by a clearance; if cleared for all activity, treat no movement as restricted.`;
    const prefs=profileData?.activity_targets?.training_prefs||{};
    const expLabel={new:"new to structured training — start conservative, prioritise form and confidence",returning:"returning after a break — rebuild volume gradually from a former base",regular:"trains regularly (6+ months) — normal progressive programming"}[prefs.experience]||"experience level unknown — assume returning after a break";
    const styleLabel={machines:"prefers machines (guided movements)",free:"prefers free weights",mix:"comfortable mixing machines and free weights"}[prefs.style]||"no equipment-style preference stated";
    const prefsLine=`\n- Session length: ~${prefs.session_min||60} minutes per strength session INCLUDING warm-up and rest between sets — the plan must genuinely fit this\n- Experience: ${expLabel}\n- Equipment style: ${styleLabel}`
      +(prefs.notes?`\n- CLIENT'S OWN COMMENTS (treat this as your client talking to you — address every point directly in your choices): "${prefs.notes}"`:"");
    return `CLIENT PROFILE:
- ${pa.gender||"female"}, ${age} years old, ${w}kg, ${h}cm (BMR ~${Math.round(bmr)} kcal/day)
- Goals:
- ${goals}
- Weekly schedule (fixed — the plan MUST fit exactly this): Strength ${at.strength||2}x, Mobility ${at.mobility||2}x, Cardio ${at.cardio||2}x per week
- Training setting: ${equipLabel}
- Health restrictions (hard constraints, never violate): ${healthNotes||"none"}${clearedLine}${prefsLine}
- Actual training last 14 days (calibrate difficulty to this real level, not an imagined one):
${recent}`;
  }

  // "Cleared with my doctor": remove the ⚠️ flag line for this exercise from the
  // plan and remember the exception so no AI pass (organise/suggest/assess) re-flags it.
  async function clearFlaggedExercise(name){
    const newPlan=workoutPlan.split("\n").filter(l=>!(/^⚠/.test(l.trim())&&l.toLowerCase().includes(name.toLowerCase()))).join("\n");
    setWorkoutPlan(newPlan);
    const at=profileData?.activity_targets||{};
    const cleared=[...new Set([...(at.cleared_exercises||[]),name])];
    await persist({workout_plan:newPlan, activity_targets:{...at, cleared_exercises:cleared}});
  }

  // Save a NEW plan: archive the outgoing one into plan_history (last 6),
  // so the coach can progress from it and the user can restore it.
  // Small tweaks (flag clears, replacement accepts) update workout_plan
  // directly and deliberately do NOT create history entries.
  async function persistPlan(newPlan){
    let history=profileData?.plan_history||[];
    const prev=(profileData?.workout_plan||"").trim(); // last PERSISTED plan, not edit-box state
    if(prev&&prev!==newPlan.trim()){
      history=[{plan:prev,saved_at:new Date().toISOString()},...history].slice(0,6);
    }
    setWorkoutPlan(newPlan);
    setProfileData(p=>({...p,workout_plan:newPlan,plan_history:history}));
    try{
      await supa("POST","profiles",{uid:UID,workout_plan:newPlan,plan_history:history},"on_conflict=uid");
    }catch(e){
      // plan_history column may not exist yet — never let that lose the plan itself
      console.log("Plan+history save failed, saving plan only:",e.message);
      try{ await supa("POST","profiles",{uid:UID,workout_plan:newPlan},"on_conflict=uid"); }
      catch(e2){ setPlanErr("Plan created but couldn't save to the server — "+e2.message.slice(0,120)); }
    }
  }

  // Persist intake answers, then generate — the wizard is the entry point
  async function runIntakeAndSuggest(){
    setShowIntake(false);
    const at=profileData?.activity_targets||{};
    await persist({activity_targets:{...at, equipment:equip, training_prefs:{experience:intake.experience,session_min:intake.session_min,style:intake.style,notes:(intake.notes||"").trim()}}});
    await suggestPlan();
  }

  async function suggestPlan(){
    if(!apiKey||processingPlan) return;
    setProcessingPlan(true); setPlanErr("");
    const prevPlanBlock=workoutPlan.trim()?`

CURRENT PLAN (the client has been running this — design the NEW plan as a progression of it, not a reset):
${workoutPlan}

CONTINUITY RULES:
- Carry working weights FORWARD and progress them; never drop back to beginner weights on exercises the client already does.
- Keep exercises that are working unless the client's comments ask for change; if they asked to mix things up, vary the movements but preserve the progression level.
- If the client's comments mention an exercise that hurts or feels wrong, replace it and briefly note the swap inline (e.g. "replacing lat pulldown per your note").`:"";
    const prompt=`You are an experienced, evidence-based personal trainer. Design a complete weekly workout plan for this client.

${trainerContext()}${prevPlanBlock}

REQUIREMENTS:
- The week must contain EXACTLY the scheduled sessions: each strength session fully written out (if 2-3 strength days, use an appropriate split), plus the mobility and cardio sessions.
- Each strength session must genuinely FIT the stated session length including a 5-min warm-up and realistic rest between sets — count the minutes; a 30-min session is 4-5 exercises max, a 60-min session 6-8.
- Match the stated experience level: volume, exercise complexity, and coaching cues appropriate to it.
- Respect the equipment-style preference (machines vs free weights vs mix) and only use equipment available in the training setting. Name SPECIFIC machines/equipment (e.g. "leg press machine", "seated cable row") so the client can find them in the gym.
- Calibrate starting weights and difficulty to the client's actual recent training, not an idealised athlete.
- Every exercise must respect the health restrictions — never include a conflicting movement; choose a safe alternative that serves the same goal instead. Honour clearances per the CLEARANCE RULE.
- Serve the stated goals directly (e.g. push-up progression work if that is a goal).

FORMAT (exactly):
- ALL CAPS section headers, one per session, including the time budget (e.g. STRENGTH DAY 1 — FULL BODY (~60 MIN), MOBILITY (~30 MIN)).
- Each exercise on its own line: Exercise name — weight · sets×reps · rest.
- End with a PROGRESSION section: 2-3 lines on when and how to increase weight/reps.
- If anything still conflicts with restrictions add: ⚠️ FLAGGED: Exercise — reason.
- PLAIN TEXT ONLY: no markdown at all — no #, no **bold**, no ---, no bullet dashes. Headers are bare ALL-CAPS lines.
Return ONLY the plan, nothing else.`;
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:4000,messages:[{role:"user",content:prompt}]})});
      const d=await res.json();
      if(d.error) throw new Error(d.error.message||JSON.stringify(d.error));
      const plan=d.content?.[0]?.text?.trim()||"";
      if(!plan) throw new Error("The coach returned an empty plan. Try again.");
      await persistPlan(plan);
      setEditPlan(false);
      setAssessment("");try{localStorage.removeItem("plan_assessment");}catch{}
      setPlanErr("");
      setSavedPlan(d.stop_reason==="max_tokens"?"Plan created ✓ (long plan — check the end is complete)":"Plan created ✓");
      setTimeout(()=>setSavedPlan(""),4000);
    }catch(e){
      console.log("Build plan error:",e.message);
      setPlanErr("Couldn't design the plan — "+(e.message||"unknown error").slice(0,160));
    }
    setProcessingPlan(false);
  }

  async function assessPlan(){
    if(!apiKey||!workoutPlan.trim()||assessing) return;
    setAssessing(true);
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1200,messages:[{role:"user",content:
`You are an experienced, evidence-based personal trainer reviewing a client's current workout plan. Be honest and specific — this is a professional assessment, not encouragement.

${trainerContext()}

THE PLAN AS WRITTEN:
${workoutPlan}
${(profileData?.plan_history||[]).length?`
PREVIOUS PLAN (saved ${new Date(profileData.plan_history[0].saved_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}) — compare for PROGRESSION (are weights/reps moving forward, stalling, or regressing?):
${profileData.plan_history[0].plan}
`:""}
Assess it and answer in EXACTLY this structure (plain text, these ALL-CAPS labels):
VERDICT: One or two sentences — done at the weekly schedule above, will this plan realistically achieve the stated goals? Yes / mostly / no, and why.
SAFETY: Any exercise conflicting with the health restrictions, each on its own line as "⚠️ Exercise — reason". If none: "No safety conflicts found."
WHAT'S WORKING: 2-3 short bullets on what to keep.
GAPS & FIXES: 3-5 short bullets — missing movement patterns, volume or intensity gaps vs the goals, and CONCRETE progression targets (specific weights, reps or timelines, e.g. "leg press: work from 35kg to 50kg over ~8 weeks, add 2.5kg when 3x12 feels easy").${(profileData?.plan_history||[]).length?`
PROGRESSION: 1-2 sentences comparing this plan to the previous one — which exercises moved forward, which stalled, and whether the pace is right.`:""}
ALIGNMENT: One sentence — do the weekly activity targets themselves match the goals, or should they change?
Max 250 words total. No intro, no outro.`}]})});
      const d=await res.json();
      if(d.error) throw new Error(d.error.message);
      const raw=d.content?.[0]?.text?.trim()||"";
      const stamp=new Date().toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:getTz()});
      const txt=`Assessed ${stamp} — based on your current health notes, goals and targets.\n\n${raw}`;
      setAssessment(txt);
      try{localStorage.setItem("plan_assessment",txt);}catch{}
    }catch(e){ setAssessment("Assessment error: "+e.message); }
    setAssessing(false);
  }

  // Persist a partial update to Supabase + local state
  async function persist(patch, setFlag){
    setProfileData(p=>({...p,...patch}));
    try{
      const payload={uid:UID,...patch};
      console.log("Saving profile payload:", JSON.stringify(payload));
      await supa("POST","profiles",payload,"on_conflict=uid");
      if(setFlag) setFlag("Saved ✓");
    }
    catch(e){
      console.error("Profile save error:", e.message);
      if(setFlag) setFlag("Error: "+e.message.slice(0,200));
    }
  }

  async function aiCall(prompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:2000,messages:[{role:"user",content:prompt}]})
    });
    const d=await res.json();
    return d.content?.[0]?.text||"";
  }

  async function analyseNotes(raw) {
    if(!apiKey||!raw.trim()) return raw;
    setProcessingNotes(true);
    try{
      const result = await aiCall(
        `Read the following health notes and extract ONLY the medically relevant information. Rewrite it as a clean, very concise structured summary using ALL CAPS section headers and bullet points starting with •. Fix spelling and grammar. Be very brief — max 3 bullets per section. Use only sections that apply: CONDITIONS, RESTRICTIONS, CLEARANCES, SYMPTOMS, FOLLOW-UP. If something looks like an exercise restriction or contraindication, include it under RESTRICTIONS.\n\nCRITICAL: if the notes say a doctor/physician CLEARED the person for any activity (fully or specific exercises), you MUST preserve that verbatim under a CLEARANCES section — clearances are as medically relevant as restrictions and must never be dropped or softened. A clearance overrides earlier restrictions it refers to.\n\nReturn ONLY the formatted text, nothing else.\n\nHealth notes:\n${raw}`
      );
      return result.trim();
    }catch(e){return raw;}
    finally{setProcessingNotes(false);}
  }

  async function analysePlan(raw, notes) {
    if(!apiKey||!raw.trim()) return raw;
    setProcessingPlan(true);
    try{
      const result = await aiCall(
        `Read the following workout plan and reformat it as a clean, scannable workout plan. Use ALL CAPS section headers (LOWER BODY, UPPER BODY, CORE, CARDIO, MOBILITY, etc.). Each exercise on its own line: Exercise name — weight · sets×reps · rest time. Fix exercise names and capitalisation. Group exercises into the correct sections.\n\nIf the health notes below mention restrictions or injuries that conflict with any exercise in the plan, add a line: ⚠️ FLAGGED: [exercise] — [reason from health notes]\nCLEARANCE RULE: if the health notes contain a CLEARANCES section or state a physician cleared the person (fully or for specific movements), those clearances OVERRIDE the restrictions they refer to — do NOT flag anything covered by a clearance. If cleared for all activity, flag nothing.\n${(profileData?.activity_targets?.cleared_exercises||[]).length?`\nEXCEPTIONS — the client's physician explicitly cleared these exercises; NEVER flag them: ${profileData.activity_targets.cleared_exercises.join(", ")}\n`:""}\nReturn ONLY the formatted workout plan, nothing else.\n\nHealth notes: ${notes||"none"}\n\nWorkout plan:\n${raw}`
      );
      return result.trim();
    }catch(e){return raw;}
    finally{setProcessingPlan(false);}
  }

  // Unique activity types seen in fitbit data, for the mapping section
  const seenTypes=[...new Set((fitbitData.workouts||[]).map(w=>(w.type||"").toLowerCase()).filter(Boolean))];

  const lbl={fontSize:11,color:C.t2,display:"block",marginBottom:3};
  const fieldWrap={marginBottom:10};
  const saveRow={display:"flex",alignItems:"center",gap:10,marginTop:6};

  return (
    <div>
      <SecLabel>Personal info</SecLabel>
      <Card style={{marginBottom:14}}>
        {editPersonal ? (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
              <div style={fieldWrap}><label style={lbl}>Name</label>
                <input type="text" value={pa.name} onChange={e=>setPa(p=>({...p,name:e.target.value}))} style={s.input}/></div>
              <div style={fieldWrap}><label style={lbl}>Birth date</label>
                <input type="date" value={pa.birth_date} onChange={e=>setPa(p=>({...p,birth_date:e.target.value}))} style={s.input}/>
                <div style={{fontSize:11,color:C.t3,marginTop:3}}>Age: {calcAge(pa.birth_date)||"—"}</div></div>
              <div style={fieldWrap}><label style={lbl}>Gender</label>
                <select value={pa.gender} onChange={e=>setPa(p=>({...p,gender:e.target.value}))} style={s.input}>
                  <option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                </select></div>
              <div style={fieldWrap}><label style={lbl}>Height (cm)</label>
                <input type="number" step="0.1" value={pa.height_cm} onChange={e=>setPa(p=>({...p,height_cm:e.target.value}))} style={s.input}/></div>
              <div style={fieldWrap}><label style={lbl}>Weight (kg)</label>
                <input type="number" step="0.1" value={pa.weight_kg} onChange={e=>setPa(p=>({...p,weight_kg:e.target.value}))} style={s.input}/></div>
              <div style={fieldWrap}><label style={lbl}>Body fat % (from body scan)</label>
                <input type="number" step="0.1" value={pa.body_fat_pct} onChange={e=>setPa(p=>({...p,body_fat_pct:e.target.value}))} style={s.input}/></div>
            </div>
            <div style={saveRow}>
              <button onClick={async()=>{
                await persist({
                  name:pa.name, birth_date:pa.birth_date||null, gender:pa.gender,
                  height_cm:pa.height_cm===""?null:parseFloat(pa.height_cm),
                  weight_kg:pa.weight_kg===""?null:parseFloat(pa.weight_kg),
                  body_fat_pct:pa.body_fat_pct===""?null:parseFloat(pa.body_fat_pct),
                }, setSavedA);
                setEditPersonal(false);
              }} style={s.btn("p")}>Save</button>
              {pa.name&&<button onClick={()=>setEditPersonal(false)} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>}
              {savedA&&<span style={{fontSize:12,color:C.teal}}>{savedA}</span>}
            </div>
          </>
        ) : (
          /* ── IDENTITY HERO: avatar, name, one stat line — not a form readout ── */
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:54,height:54,borderRadius:"50%",background:C.pl,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:"'Playfair Display',Georgia,serif",fontStyle:"italic",fontSize:26,fontWeight:600,color:C.pu}}>
              {(pa.name||"?").charAt(0).toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Playfair Display',Georgia,serif",fontStyle:"italic",fontSize:20,fontWeight:600,letterSpacing:"-.3px"}}>{pa.name||"—"}</div>
              <div style={{fontSize:12,color:C.t2,marginTop:3}}>
                {[calcAge(pa.birth_date)?calcAge(pa.birth_date)+" yrs":null, pa.height_cm?pa.height_cm+" cm":null, pa.weight_kg?pa.weight_kg+" kg":null, pa.body_fat_pct?pa.body_fat_pct+"% fat":null].filter(Boolean).join("  ·  ")||"Tap edit to fill in your details"}
              </div>
            </div>
            <button title="Edit personal info" onClick={()=>setEditPersonal(true)} style={{width:34,height:34,borderRadius:"50%",background:C.s2,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:C.t2,flexShrink:0}}>
              <Icon name="log" size={14}/>
            </button>
          </div>
        )}
      </Card>

      {/* BMI / BMR — value-first stat tiles; the science lives in the tooltip */}
      {(pa.weight_kg||profileData?.weight_kg)&&(pa.height_cm||profileData?.height_cm)?(()=>{
        const w=parseFloat(pa.weight_kg||profileData?.weight_kg||0);
        const h=parseFloat(pa.height_cm||profileData?.height_cm||1);
        const age=calcAge(pa.birth_date||profileData?.birth_date)||30;
        const bmi=w/(h/100)**2;
        // Mifflin-St Jeor BMR
        const bmr=pa.gender==="female"?(10*w+6.25*h-5*age-161):(10*w+6.25*h-5*age+5);
        const tiles=[
          ["BMI",bmi.toFixed(1),"healthy range 18.5–25","Body Mass Index — weight relative to height. Doesn't distinguish muscle from fat."],
          ["BMR",Math.round(bmr).toLocaleString(),"kcal/day at rest","Basal Metabolic Rate — calories your body burns at rest, before any activity. Your daily calorie floor."],
        ];
        return (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            {tiles.map(([l,v,sub,tip])=>(
              <div key={l} title={tip} style={s.mc}>
                <div style={s.ml}>{l}</div>
                <div style={{...s.mv,color:C.sl}}>{v}</div>
                <div style={{...s.ms,color:C.t3}}>{sub}</div>
              </div>
            ))}
          </div>
        );
      })():null}

      {/* ── SECTION B — GOALS & TARGETS ───────────────────────────────── */}
      <SecLabel>Goals &amp; Targets</SecLabel>

      {/* Goals */}
      <Card style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:10}}>Goals</div>
        {editGoals ? (
          <>
            <div style={{fontSize:17,fontWeight:600,marginBottom:16}}>What's the main thing you want to improve right now?</div>
            {selectedGoals.length>=3&&<div style={{fontSize:12,color:C.or,marginBottom:8}}>Maximum 3 goals — deselect one to add another.</div>}
            {GOAL_CARDS.map(gc=>{
              const sel=selectedGoals.includes(gc.id);
              return (
                <div key={gc.id}>
                  <div onClick={()=>{
                    if(sel){
                      setSelectedGoals(prev=>prev.filter(x=>x!==gc.id));
                    } else {
                      if(selectedGoals.length>=3) return;
                      setSelectedGoals(prev=>[...prev,gc.id]);
                    }
                  }} style={{padding:"12px 14px",border:`1.5px solid ${sel?C.pu:C.bd}`,background:sel?C.pl:C.sf,borderRadius:10,cursor:"pointer",fontSize:14,marginBottom:8}}>
                    {gc.label}
                  </div>
                  {sel&&GOAL_SUBS[gc.id]&&(
                    <div style={{marginLeft:16,marginBottom:12,padding:"12px 14px",background:C.s2,borderRadius:10}}>
                      <div style={{fontStyle:"italic",color:C.t2,fontSize:13,marginBottom:8}}>{GOAL_SUBS[gc.id].prompt}</div>
                      {GOAL_SUBS[gc.id].options.map(opt=>{
                        const subSel=goalSubs[gc.id]?.option===opt.id;
                        return (
                          <div key={opt.id}>
                            <div onClick={()=>setGoalSubs(prev=>({...prev,[gc.id]:{...(prev[gc.id]||{}),option:opt.id}}))} style={{padding:"8px 12px",border:`1.5px solid ${subSel?C.pu:C.bd}`,background:subSel?C.pl:C.sf,borderRadius:8,cursor:"pointer",fontSize:13,marginBottom:6}}>
                              {opt.label}
                              {opt.note&&<span style={{fontSize:11,color:C.t3,marginLeft:8}}>— {opt.note}</span>}
                            </div>
                            {subSel&&opt.input&&(
                              <div style={{marginLeft:12,marginBottom:8}}>
                                <label style={{fontSize:11,color:C.t2,display:"block",marginBottom:3}}>{opt.input.label}</label>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <input type={opt.input.type} defaultValue={goalSubs[gc.id]?.inputValue||opt.input.default||""} onChange={e=>setGoalSubs(prev=>({...prev,[gc.id]:{...(prev[gc.id]||{}),inputValue:e.target.value}}))} style={{...s.input,width:120}}/>
                                  {opt.input.unit&&<span style={{fontSize:12,color:C.t2}}>{opt.input.unit}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {(()=>{
              const ready=selectedGoals.length>0&&selectedGoals.every(id=>goalSubs[id]?.option);
              return (
                <div style={saveRow}>
                  {!ready&&<div style={{fontSize:11,color:C.t3,marginBottom:8}}>Choose at least one goal to continue — your coach uses these to personalise everything.</div>}
                  <button disabled={!ready} onClick={()=>{
                    const goalObjects=selectedGoals.map(id=>{
                      const card=GOAL_CARDS.find(g=>g.id===id);
                      const sub=GOAL_SUBS[id];
                      const subData=goalSubs[id]||{};
                      const chosenOpt=sub?.options.find(o=>o.id===subData.option);
                      const hasInput=chosenOpt?.input;
                      return {
                        id,
                        label:card?.label||id,
                        definition:subData.option||null,
                        target_value:hasInput&&subData.inputValue?subData.inputValue:null,
                        target_bedtime:hasInput?.type==="time"&&subData.inputValue?subData.inputValue:null,
                        target_unit:chosenOpt?.input?.unit||null,
                      };
                    });
                    persist({goals:goalObjects}, setSavedGoals);
                    // Recalculate protein target based on new goals
                    const newProt = getDefaultProteinTarget(pa.weight_kg||profileData?.weight_kg, goalObjects);
                    if(newProt) setFoundTargets(prev=>({...prev, protein_target:newProt}));
                    setEditGoals(false);
                  }} style={{...s.btn("p"),opacity:ready?1:0.5,cursor:ready?"pointer":"default"}}>Save goals</button>
                  {selectedGoals.length>0&&<button onClick={()=>setEditGoals(false)} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>}
                  {savedGoals&&<span style={{fontSize:12,color:C.teal}}>{savedGoals}</span>}
                </div>
              );
            })()}
          </>
        ) : (
          <>
            {(profileData?.goals||[]).length===0
              ? <div style={{fontSize:13,color:C.t3,marginBottom:10}}>No goals set yet.</div>
              : <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
                  {(profileData?.goals||[]).map((g,i)=>{
                    const opt=GOAL_SUBS[g.id]?.options.find(o=>o.id===g.definition);
                    const defLabel=g.definition?(opt?.label||g.definition.replace(/_/g," ")):null;
                    return (
                      <div key={i} style={{background:C.pl,borderRadius:12,padding:"9px 13px",maxWidth:"100%"}}>
                        <div style={{fontSize:12.5,fontWeight:600,color:C.pu}}>{g.label}</div>
                        {defLabel&&<div style={{fontSize:10.5,color:C.t2,marginTop:2}}>{defLabel}{g.target_value?" · "+g.target_value+(g.target_unit?" "+g.target_unit:""):""}</div>}
                      </div>
                    );
                  })}
                </div>
            }
            <button onClick={()=>setEditGoals(true)} style={{...s.btn("s"),...s.btnSm}}>Edit goals</button>
          </>
        )}
      </Card>

      {/* Activity targets */}
      <Card style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:6}}>Activity targets — sessions per week</div>
        {editTargets ? (
          <>
            {(()=>{
              // Recommend a 5-session split from the PRIMARY goal — the missing
              // link in the goals -> targets chain
              const gids=(profileData?.goals||[]).map(g=>g.id||"");
              let rec=null, why="";
              if(gids.some(g=>/strength|muscle/.test(g))){rec={strength:3,mobility:1,cardio:1};why="strength-building goal";}
              else if(gids.some(g=>/body_comp|composition|fat/.test(g))){rec={strength:2,mobility:1,cardio:2};why="body-composition goal";}
              else if(gids.some(g=>/cardio|endurance|fitness/.test(g))){rec={strength:1,mobility:1,cardio:3};why="cardio goal";}
              else if(gids.length){rec={strength:2,mobility:2,cardio:1};why="balanced default for your goals";}
              if(!rec) return null;
              const same=rec.strength===(targets.strength||0)&&rec.mobility===(targets.mobility||0)&&rec.cardio===(targets.cardio||0);
              return (
                <div style={{background:C.pl,borderRadius:10,padding:"10px 12px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.pu}}>Recommended for your {why}</div>
                    <div style={{fontSize:11,color:C.t2,marginTop:2}}>{rec.strength} strength · {rec.mobility} mobility · {rec.cardio} cardio per week</div>
                  </div>
                  {!same&&<button onClick={()=>setTargets(rec)} style={{...s.btn("p"),...s.btnSm,fontSize:11}}>Apply</button>}
                  {same&&<span style={{fontSize:11,color:C.teal,fontWeight:600}}>✓ set</span>}
                </div>
              );
            })()}
            {[
              {k:"strength",label:"Strength",color:C.pu,desc:"Exercises that challenge your muscles against resistance — building muscle mass, bone density, and metabolic health.",examples:"weight training, resistance machines, bodyweight exercises, CrossFit, circuit training"},
              {k:"mobility",label:"Mobility",color:C.or,desc:"Movement that improves your range of motion, flexibility, and body control. Reduces injury risk and keeps your joints healthy.",examples:"yoga, Pilates, stretching, core training"},
              {k:"cardio",label:"Cardio",color:C.teal,desc:"Activities that raise your heart rate — improving endurance, heart health, and energy levels.",examples:"running, cycling, swimming, hiking, elliptical, HIIT"},
            ].map(({k,label,color,desc,examples})=>(
              <div key={k} style={{marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <div style={{fontWeight:600,color,fontSize:14}}>{label}</div>
                  <div style={{textAlign:"right"}}>
                    <input type="number" min="1" max="5" value={targets[k]??1} onChange={e=>setTargets(t=>({...t,[k]:parseInt(e.target.value)||1}))} style={{...s.input,width:64,textAlign:"center",fontSize:18,fontWeight:700,padding:"6px 0"}}/>
                    <div style={{fontSize:10,color:C.t3,marginTop:2}}>sessions per week</div>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.t2,lineHeight:1.6,marginBottom:2}}>{desc}</div>
                <div style={{fontSize:10,color:C.t3}}>Examples: {examples}</div>
              </div>
            ))}
            {(()=>{
              const total=(targets.strength||0)+(targets.mobility||0)+(targets.cardio||0);
              return (
                <>
                  <div style={{background:C.s2,borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                    <div style={{fontSize:13,color:total===5?C.teal:C.am,fontWeight:600,marginBottom:3}}>{total} sessions / week = {total*4} sessions / month{total!==5?" — aim for 5 total":""}</div>
                    <div style={{fontSize:11,color:C.t3}}>Based on your goals and longevity research. Adjust to whatever works for your life.</div>
                  </div>
                  <div style={saveRow}>
                    <button disabled={total!==5||(targets.strength||0)<1||(targets.mobility||0)<1||(targets.cardio||0)<1} onClick={()=>{persist({activity_targets:targets}, setSavedTargets);setEditTargets(false);}} style={{...s.btn("p"),opacity:(total===5&&(targets.strength||0)>=1&&(targets.mobility||0)>=1&&(targets.cardio||0)>=1)?1:0.5}}>Save targets</button>
                    {profileData?.activity_targets&&<button onClick={()=>setEditTargets(false)} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>}
                    {savedTargets&&<span style={{fontSize:12,color:C.teal}}>{savedTargets}</span>}
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              {["strength","mobility","cardio"].map(k=>{
                const colors={strength:[C.pu,C.pl],mobility:[C.or,C.orl],cardio:[C.teal,C.tl]};
                const [col,bg]=colors[k]||[C.t2,C.s2];
                return (
                  <div key={k} style={{background:bg,borderRadius:12,padding:"12px 6px",textAlign:"center"}}>
                    <div style={{fontSize:24,fontWeight:700,color:col,lineHeight:1}}>{targets[k]||0}</div>
                    <div style={{fontSize:9.5,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:col,marginTop:4}}>{k}</div>
                    <div style={{fontSize:9,color:C.t3,marginTop:1}}>per week</div>
                  </div>
                );
              })}
            </div>
            {(()=>{const tot=(targets.strength||0)+(targets.mobility||0)+(targets.cardio||0);return <div style={{fontSize:11,color:C.t3,marginBottom:8}}>{tot} sessions/week · {tot*4}/month</div>;})()}
            <button onClick={()=>setEditTargets(true)} style={{...s.btn("s"),...s.btnSm}}>Edit targets</button>
          </>
        )}
      </Card>

      {/* Goal Foundations */}
      <Card style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:10}}>Goal Foundations</div>
        {editFoundations&&<div style={{fontSize:11,color:C.t2,marginBottom:12,lineHeight:1.6}}>These numbers power your coach and your tracking. They're calculated from your goals and profile — adjust them if needed.</div>}
        {editFoundations ? (
          <>
            <div style={{marginBottom:12}}>
              <label style={lbl}>Daily step target</label>
              <input type="number" value={foundTargets.step_target} onChange={e=>setFoundTargets(t=>({...t,step_target:e.target.value}))} style={{...s.input,width:140}}/>
              <div style={{fontSize:11,color:C.t3,marginTop:3}}>Steps are the simplest measure of daily movement. 8,000–10,000/day is the evidence-based sweet spot.</div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={lbl}>Daily protein target (g)</label>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <input type="number" value={foundTargets.protein_target} onChange={e=>setFoundTargets(t=>({...t,protein_target:e.target.value}))} style={{...s.input,width:140}}/>
                <span style={{fontSize:12,color:C.t2}}>g</span>
              </div>
              {!(pa.weight_kg||profileData?.weight_kg)&&<div style={{fontSize:11,color:C.t3,marginTop:3}}>Add your weight in Personal Info to get a personalised protein target.</div>}
              <div style={{fontSize:11,color:C.t3,marginTop:3}}>Protein supports muscle repair and satiety. Aim for 1.6–2g per kg of body weight when training.</div>
            </div>
            <div style={saveRow}>
              <button onClick={()=>{persist({step_target:Number(foundTargets.step_target),protein_target:Number(foundTargets.protein_target)},setSavedFoundations);setEditFoundations(false);}} style={s.btn("p")}>Save</button>
              {profileData?.step_target&&<button onClick={()=>setEditFoundations(false)} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>}
              {savedFoundations&&<span style={{fontSize:12,color:C.teal}}>{savedFoundations}</span>}
            </div>
          </>
        ) : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              {[["Daily steps",foundTargets.step_target?.toLocaleString(),C.teal,C.tl],["Daily protein",foundTargets.protein_target+"g",C.am,C.al]].map(([label,val,col,bg])=>(
                <div key={label} style={{background:bg,borderRadius:12,padding:"12px 10px",textAlign:"center"}}>
                  <div style={{fontSize:20,fontWeight:700,color:col,lineHeight:1}}>{val}</div>
                  <div style={{fontSize:9.5,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:col,marginTop:4}}>{label}</div>
                </div>
              ))}
            </div>
            <button onClick={()=>setEditFoundations(true)} style={{...s.btn("s"),...s.btnSm}}>Edit</button>
          </>
        )}
      </Card>

      <SecLabel>Health Notes</SecLabel>
      <Card style={{marginBottom:14}}>
        {editNotes ? (
          <>
            <div style={{fontSize:11,color:C.t2,marginBottom:8,lineHeight:1.6}}>Describe any injuries, restrictions, or medical context. Just write it out — AI will structure it when you save.</div>
            {!healthNotes&&<button onClick={()=>setHealthNotes("All good — no injuries or restrictions to report.")} style={{...s.btn("s"),...s.btnSm,marginBottom:8}}>I'm all good right now</button>}
            <textarea value={healthNotes} onChange={e=>setHealthNotes(e.target.value)} placeholder="Write anything — conditions, surgeries, restrictions, symptoms. AI will organise it." style={{...s.input,resize:"vertical",minHeight:90,marginBottom:8}}/>
            <div style={saveRow}>
              <button disabled={processingNotes||!healthNotes.trim()} onClick={async()=>{
                const structured=await analyseNotes(healthNotes);
                setHealthNotes(structured);
                await persist({health_notes:structured},setSavedNotes);
                setEditNotes(false);
                // Health notes changed — any existing plan assessment is stale
                setAssessment("");try{localStorage.removeItem("plan_assessment");}catch{}
                // Re-check the plan's flags against the NEW notes (flags live in the
                // plan text, so they'd otherwise stay stale forever)
                if(workoutPlan.trim()&&apiKey){
                  const rechecked=await analysePlan(workoutPlan,structured);
                  if(rechecked&&rechecked.trim()){setWorkoutPlan(rechecked);await persist({workout_plan:rechecked});}
                  setSavedNotes("Saved ✓ — plan re-checked against new notes");
                }
              }} style={{...s.btn("p"),opacity:processingNotes?0.6:1}}>{processingNotes?"Analysing...":"Analyse & Save"}</button>
              {healthNotes&&!processingNotes&&<button onClick={async()=>{await persist({health_notes:healthNotes},setSavedNotes);setEditNotes(false);setAssessment("");try{localStorage.removeItem("plan_assessment");}catch{}
                if(workoutPlan.trim()&&apiKey){const rc=await analysePlan(workoutPlan,healthNotes);if(rc&&rc.trim()){setWorkoutPlan(rc);await persist({workout_plan:rc});}setSavedNotes("Saved ✓ — plan re-checked against new notes");}
              }} style={{...s.btn("s"),...s.btnSm}}>Save as-is</button>}
              {healthNotes&&<button onClick={()=>setEditNotes(false)} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>}
              {savedNotes&&<span style={{fontSize:12,color:C.teal}}>{savedNotes}</span>}
            </div>
            {!apiKey&&<div style={{fontSize:11,color:C.am,marginTop:6}}>Add your API key in Settings to enable AI analysis.</div>}
          </>
        ) : (
          <>
            {/* Collapsed by default — long medical prose shouldn't dominate the page */}
            <div style={{maxHeight:notesOpen?"none":96,overflow:"hidden",position:"relative"}}>
              <StructuredView text={healthNotes}/>
              {!notesOpen&&<div style={{position:"absolute",left:0,right:0,bottom:0,height:44,background:`linear-gradient(to bottom, rgba(255,255,255,0), ${C.sf})`}}/>}
            </div>
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <button onClick={()=>setNotesOpen(v=>!v)} style={{...s.btn("s"),...s.btnSm}}>{notesOpen?"Show less":"Show all"}</button>
              <button onClick={()=>setEditNotes(true)} style={{...s.btn("s"),...s.btnSm}}>Edit</button>
            </div>
          </>
        )}
      </Card>

      <SecLabel>Workout plan</SecLabel>
      <Card style={{marginBottom:14}}>
        {editPlan ? (
          <>
            <div style={{fontSize:11,color:C.t2,marginBottom:8,lineHeight:1.6}}>Write your exercises any way you like — weights, reps, whatever you know. AI will organise it and flag anything that conflicts with your health notes. Or let the AI trainer design the whole plan from your goals, targets and health notes.</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{fontSize:11,color:C.t2,whiteSpace:"nowrap"}}>Training setting:</span>
              <select value={equip} onChange={e=>{const v=e.target.value;setEquip(v);persist({activity_targets:{...(profileData?.activity_targets||{}),equipment:v}});}} style={{...s.input,flex:1}}>
                <option value="gym">Full gym</option>
                <option value="home">Home — dumbbells & bands</option>
                <option value="bodyweight">Bodyweight only</option>
              </select>
            </div>
            {apiKey&&<button disabled={processingPlan} onClick={()=>setShowIntake(true)} style={{...s.btn("p"),marginBottom:10,width:"100%",justifyContent:"center"}}>
              {processingPlan?<><Spinner/>Designing your plan...</>:<><Icon name="dumbbell" size={14} color="#fff"/> {workoutPlan.trim()?"Design a new plan (replaces current)":"Design a plan for me"}</>}
            </button>}
            {planErr&&<div style={{fontSize:11.5,color:C.red,background:C.rl,borderRadius:8,padding:"8px 10px",marginBottom:10,lineHeight:1.5}}>{planErr}</div>}
            <textarea value={workoutPlan} onChange={e=>setWorkoutPlan(e.target.value)} placeholder="e.g. leg press 35kg 3x12, lat pulldown 20kg 3x12, plank 3x45s... or use Build a plan above" style={{...s.input,resize:"vertical",minHeight:110,marginBottom:8}}/>
            <div style={saveRow}>
              <button disabled={processingPlan||!workoutPlan.trim()} onClick={async()=>{
                const structured=await analysePlan(workoutPlan,healthNotes);
                await persistPlan(structured);
                setSavedPlan("Saved ✓");
                setEditPlan(false);
              }} style={{...s.btn("p"),opacity:processingPlan?0.6:1}}>{processingPlan?"Organising...":"Organise & Save"}</button>
              {workoutPlan&&!processingPlan&&<button onClick={async()=>{await persistPlan(workoutPlan);setSavedPlan("Saved ✓");setEditPlan(false);}} style={{...s.btn("s"),...s.btnSm}}>Save as-is</button>}
              {workoutPlan&&<button onClick={()=>setEditPlan(false)} style={{...s.btn("s"),...s.btnSm}}>Cancel</button>}
              {savedPlan&&<span style={{fontSize:12,color:C.teal}}>{savedPlan}</span>}
            </div>
            {!apiKey&&<div style={{fontSize:11,color:C.am,marginTop:6}}>Add your API key in Settings to enable AI organisation.</div>}
          </>
        ) : (
          <>
            <WorkoutView text={workoutPlan} healthNotes={healthNotes} apiKey={apiKey} onUpdatePlan={async(newPlan)=>{setWorkoutPlan(newPlan);await persist({workout_plan:newPlan});}} onClearFlag={clearFlaggedExercise}/>
            <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
              {apiKey&&<button disabled={tweaking} onClick={()=>{setShowTweak(true);setTweakErr("");}} style={{...s.btn("p"),...s.btnSm}}>{tweaking?<><Spinner/>Updating...</>:<><Icon name="repeat" size={13} color="#fff"/> Update my plan</>}</button>}
              <button onClick={()=>setEditPlan(true)} style={{...s.btn("s"),...s.btnSm}}>Edit</button>
              {apiKey&&<button disabled={assessing} onClick={assessPlan} style={{...s.btn("s"),...s.btnSm,opacity:assessing?.6:1}}>{assessing?<><Spinner/>Assessing...</>:<><Icon name="target" size={13}/> Assess my plan</>}</button>}
              {apiKey&&<button disabled={processingPlan} onClick={()=>setShowIntake(true)} style={{...s.btn("s"),...s.btnSm,opacity:processingPlan?.6:1}}>{processingPlan?<><Spinner/>Designing...</>:<><Icon name="dumbbell" size={13}/> Design a new plan</>}</button>}
            </div>
            {planErr&&<div style={{fontSize:11.5,color:C.red,background:C.rl,borderRadius:8,padding:"8px 10px",marginTop:10,lineHeight:1.5}}>{planErr}</div>}
            {savedPlan&&<div style={{fontSize:12,color:C.teal,marginTop:10}}>{savedPlan}</div>}
            {assessment&&(
              <div style={{marginTop:12,padding:"12px 14px",background:C.pl,borderRadius:10,borderLeft:`3px solid ${C.pu}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:C.pu}}>Trainer assessment</div>
                  <button onClick={()=>{setAssessment("");try{localStorage.removeItem("plan_assessment");}catch{}}} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:14}}>×</button>
                </div>
                <AssessmentView text={assessment}/>
              </div>
            )}
            {/* Previous plans — quiet history with view + restore */}
            {(profileData?.plan_history||[]).length>0&&(
              <div style={{marginTop:12}}>
                <button onClick={()=>setHistoryOpen(v=>!v)} style={{background:"none",border:"none",padding:0,fontSize:11,color:C.t3,cursor:"pointer",fontWeight:500}}>
                  {historyOpen?"▾":"▸"} {profileData.plan_history.length} previous plan{profileData.plan_history.length!==1?"s":""} remembered
                </button>
                {historyOpen&&profileData.plan_history.map((h,i)=>(
                  <div key={i} style={{marginTop:8,background:C.s2,borderRadius:10,padding:"9px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{flex:1,fontSize:11.5,fontWeight:500,color:C.t2}}>Saved {new Date(h.saved_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</span>
                      <button onClick={()=>setHistoryView(historyView===i?null:i)} style={{...s.btn("s"),...s.btnSm,fontSize:10,padding:"3px 9px"}}>{historyView===i?"Hide":"View"}</button>
                      <button onClick={async()=>{if(window.confirm("Restore this plan? Your current plan will be kept in history."))await persistPlan(h.plan);}} style={{...s.btn("s"),...s.btnSm,fontSize:10,padding:"3px 9px"}}>Restore</button>
                    </div>
                    {historyView===i&&<div style={{marginTop:8,fontSize:11,color:C.t2,lineHeight:1.6,whiteSpace:"pre-wrap",maxHeight:220,overflowY:"auto"}}>{h.plan}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Activity mapping — moved here, after Workout Plan */}
      {(()=>{
        const needsDecision2 = seenTypes.filter(t=>getActivityCategory(t,{})==="uncategorized"&&!mapping[t]);
        const userOverrides2 = seenTypes.filter(t=>mapping[t]&&mapping[t]!==DEFAULT_ACTIVITY_MAPPING[t]);
        if(needsDecision2.length===0&&userOverrides2.length===0) return null;
        return (
          <Card style={{marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:C.t3,marginBottom:6}}>Activity mapping</div>
            <div style={{fontSize:11,color:C.t2,marginBottom:10,lineHeight:1.6}}>These activity types from your Fitbit data need categorising. Everything else is auto-mapped.</div>
            {needsDecision2.map(t=>(
              <div key={t} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{flex:1,fontSize:13,fontWeight:500}}>{t}</span>
                <select value={mapping[t]||""} onChange={e=>{const v=e.target.value;setMapping(m=>({...m,[t]:v}));if(e.target.value)persist({activity_mapping:{...mapping,[t]:v}});}} style={{...s.input,width:170}}>
                  <option value="">— categorise —</option>
                  <option value="strength">Strength</option>
                  <option value="mobility">Mobility</option>
                  <option value="cardio">Cardio</option>
                </select>
              </div>
            ))}
            {userOverrides2.length>0&&(
              <>
                <div style={{fontSize:11,color:C.t3,marginTop:8,marginBottom:6}}>Your overrides</div>
                {userOverrides2.map(t=>(
                  <div key={t} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,fontSize:12}}>
                    <span style={{flex:1,color:C.t2}}>{t}</span>
                    <span style={{color:C.tx,fontWeight:500}}>{mapping[t]}</span>
                    <button onClick={()=>{const m={...mapping};delete m[t];setMapping(m);persist({activity_mapping:m});}} style={{fontSize:10,background:"none",border:`1px solid ${C.bd}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",color:C.t3}}>reset</button>
                  </div>
                ))}
              </>
            )}
          </Card>
        );
      })()}

      {/* ── COACH MEMORY SUMMARY (after 28 days) ─────────────── */}
      {(()=>{
        const firstSleep=(fitbitData.sleep||[]).map(s=>s.date).sort()[0];
        if(!firstSleep) return null;
        const daysInApp=Math.round((new Date()-new Date(firstSleep+"T12:00:00"))/864e5);
        if(daysInApp<28) return null;
        return <CoachMemoryCard profileData={profileData} fitbitData={fitbitData} apiKey={apiKey}/>;
      })()}

      {/* ── QUICK PLAN UPDATE: surgical free-text tweaks, no logging ritual ── */}
      {showTweak&&(
        <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setShowTweak(false);}}>
          <div style={s.modal}>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:4}}>Update my plan</h3>
            <p style={{fontSize:12,color:C.t2,marginBottom:6}}>Tell your coach what changed and it'll update just that part — the rest of your plan stays exactly as is.</p>
            <div style={{fontSize:10.5,color:C.t3,marginBottom:8,lineHeight:1.5}}>e.g. "swapped leg press for hack squat" · "moved up to 40kg on rows, felt good" · "drop the plank, add dead bug" · "the shoulder press hurts, replace it"</div>
            <textarea value={tweakText} onChange={e=>{setTweakText(e.target.value);setTweakErr("");}} rows={3} autoFocus
              placeholder="What did you change or want to change?"
              style={{...s.input,resize:"vertical",marginBottom:tweakErr?4:12,fontFamily:"inherit"}}/>
            {tweakErr&&<div style={{fontSize:11,color:C.red,marginBottom:10}}>{tweakErr}</div>}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowTweak(false)} style={s.btn("s")}>Cancel</button>
              <button disabled={!tweakText.trim()||tweaking} onClick={tweakPlan} style={{...s.btn("p"),opacity:tweakText.trim()&&!tweaking?1:.5}}>{tweaking?<><Spinner/>Applying...</>:"Apply update"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PLAN INTAKE WIZARD: the coach asks before prescribing ── */}
      {showIntake&&(
        <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setShowIntake(false);}}>
          <div style={{...s.modal,maxHeight:"90vh",overflowY:"auto"}}>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:4}}>Let's design your plan</h3>
            <p style={{fontSize:12,color:C.t2,marginBottom:16}}>A few questions first — like a trainer would ask. Your goals, weekly targets and health notes are already included.</p>

            <label style={{fontSize:12,fontWeight:600,color:C.t2,display:"block",marginBottom:6}}>How experienced are you with training?</label>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
              {[["new","New to structured training","start with the basics, focus on form"],["returning","Coming back after a break","rebuild gradually from a former base"],["regular","Training regularly 6+ months","normal progressive programming"]].map(([v,l,d])=>(
                <div key={v} onClick={()=>setIntake(p=>({...p,experience:v}))} style={{padding:"10px 12px",border:`1.5px solid ${intake.experience===v?C.pu:C.bd}`,background:intake.experience===v?C.pl:C.sf,borderRadius:10,cursor:"pointer"}}>
                  <div style={{fontSize:13,fontWeight:500}}>{l}</div>
                  <div style={{fontSize:11,color:C.t3}}>{d}</div>
                </div>
              ))}
            </div>

            <label style={{fontSize:12,fontWeight:600,color:C.t2,display:"block",marginBottom:6}}>How long is a session for you?</label>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
              {[30,45,60,90].map(m=>(
                <button key={m} onClick={()=>setIntake(p=>({...p,session_min:m}))} style={{...s.btn(intake.session_min===m?"p":"s"),padding:"10px 0",justifyContent:"center"}}>{m}m</button>
              ))}
            </div>

            <label style={{fontSize:12,fontWeight:600,color:C.t2,display:"block",marginBottom:6}}>Where do you train?</label>
            <select value={equip} onChange={e=>setEquip(e.target.value)} style={{...s.input,marginBottom:14}}>
              <option value="gym">Full gym</option>
              <option value="home">Home — dumbbells & bands</option>
              <option value="bodyweight">Bodyweight only</option>
            </select>

            {equip==="gym"&&(<>
              <label style={{fontSize:12,fontWeight:600,color:C.t2,display:"block",marginBottom:6}}>Machines or free weights?</label>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:14}}>
                {[["machines","Machines"],["mix","Mix"],["free","Free weights"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setIntake(p=>({...p,style:v}))} style={{...s.btn(intake.style===v?"p":"s"),padding:"9px 0",justifyContent:"center",fontSize:12}}>{l}</button>
                ))}
              </div>
            </>)}

            <label style={{fontSize:12,fontWeight:600,color:C.t2,display:"block",marginBottom:4}}>Tell your coach anything else <span style={{fontWeight:400,color:C.t3}}>(optional)</span></label>
            <div style={{fontSize:10.5,color:C.t3,marginBottom:6,lineHeight:1.5}}>What you've been doing and how it felt · machines or exercises you like or dislike · anything that doesn't feel right · "I want to mix things up" · days that work best</div>
            <textarea value={intake.notes||""} onChange={e=>setIntake(p=>({...p,notes:e.target.value}))} rows={3}
              placeholder="e.g. I've been doing the leg press and it feels great, but the lat pulldown hurts my shoulder — and I'm bored of my current routine, surprise me"
              style={{...s.input,resize:"vertical",marginBottom:14,fontFamily:"inherit"}}/>

            {workoutPlan.trim()&&<p style={{fontSize:11,color:C.am,marginBottom:12}}>Your current plan is remembered and used for continuity — the new one progresses from it rather than starting over.</p>}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowIntake(false)} style={s.btn("s")}>Cancel</button>
              <button onClick={runIntakeAndSuggest} style={s.btn("p")}><Icon name="dumbbell" size={14} color="#fff"/> Design my plan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Renders coach prose as scannable rows. Each line shaped "emoji LABEL: text"
// becomes a labelled bullet; falls back to plain paragraphs otherwise.
function BulletView({text, style={}}){
  const lines=(text||"").split("\n").map(l=>l.trim()).filter(Boolean);
  const rows=lines.map(l=>{
    const m=l.match(/^([\p{Emoji}☀-➿️]+)?\s*([A-Z][A-Z '&/]{2,40}):\s*(.+)$/u);
    if(m) return {emoji:(m[1]||"").trim(), label:m[2].trim(), body:m[3].trim()};
    return {body:l.replace(/^[-•*]\s*/,"")};
  });
  const labelled=rows.filter(r=>r.label).length>=2; // only treat as bullets if it really is one
  if(!labelled) return <div style={{fontSize:13,color:C.tx,lineHeight:1.7,...style}}>{text}</div>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:9}}>
      {rows.map((r,i)=>(
        <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start"}}>
          <span style={{fontSize:15,lineHeight:1.3,flexShrink:0,width:20,textAlign:"center"}}>{r.emoji||"•"}</span>
          <div style={{flex:1}}>
            {r.label&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".06em",color:C.t3}}>{r.label}</div>}
            <div style={{fontSize:12.5,color:C.tx,lineHeight:1.55,marginTop:r.label?1:0}}>{r.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Renders the trainer assessment as structured sections instead of a text blob
function AssessmentView({text}){
  const SECTIONS={
    "VERDICT":{label:"Verdict",color:C.pu,bg:C.pl},
    "SAFETY":{label:"Safety",color:C.red,bg:C.rl},
    "WHAT'S WORKING":{label:"What's working",color:C.teal,bg:C.tl},
    "GAPS & FIXES":{label:"Gaps & fixes",color:C.am,bg:C.al},
    "PROGRESSION":{label:"Progression",color:C.or,bg:C.orl},
    "ALIGNMENT":{label:"Alignment",color:C.sl,bg:C.sll},
  };
  const lines=(text||"").split("\n");
  const blocks=[]; let cur=null; let stamp="";
  lines.forEach(line=>{
    const t=line.trim(); if(!t) return;
    if(/^Assessed /.test(t)&&!cur){ stamp=t; return; }
    const m=t.match(/^(VERDICT|SAFETY|WHAT'S WORKING|GAPS & FIXES|PROGRESSION|ALIGNMENT):?\s*(.*)$/);
    if(m){ cur={key:m[1],items:m[2]?[m[2]]:[]}; blocks.push(cur); }
    else if(cur){ cur.items.push(t.replace(/^[-•]\s*/,"")); }
    else { blocks.push({key:null,items:[t]}); }
  });
  if(!blocks.length) return <div style={{fontSize:12,color:C.tx,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{text}</div>;
  return (
    <div>
      {stamp&&<div style={{fontSize:10,color:C.t3,marginBottom:10}}>{stamp}</div>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {blocks.map((b,i)=>{
          const sec=SECTIONS[b.key]||{label:b.key||"",color:C.t2,bg:C.s2};
          return (
            <div key={i} style={{background:C.sf,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${sec.color}`}}>
              {b.key&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".07em",textTransform:"uppercase",color:sec.color,marginBottom:4}}>{sec.label}</div>}
              {b.items.map((it,j)=>(
                <div key={j} style={{fontSize:12,color:C.tx,lineHeight:1.6,marginBottom:j<b.items.length-1?4:0,display:"flex",gap:6}}>
                  {b.items.length>1&&<span style={{color:sec.color,flexShrink:0}}>·</span>}
                  <span>{it}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CoachMemoryCard({profileData, fitbitData, apiKey}) {
  const CACHE_KEY="coach_memory_"+new Date().toLocaleDateString("en-CA",{timeZone:getTz()}).slice(0,7); // per-month
  // Stored summary from the profile row renders for any visitor; localStorage is a speed cache only
  const [memory, setMemory] = React.useState(()=>{
    if(IS_DEMO) return profileData?.coach_memory||null;
    try{return localStorage.getItem(CACHE_KEY)||profileData?.coach_memory||null;}catch{return profileData?.coach_memory||null;}
  });
  const [loading, setLoading] = React.useState(false);

  async function generate() {
    if(IS_DEMO||!apiKey||loading) return;
    setLoading(true);
    const bl=profileData?.behavioral_baseline||{};
    const patterns=(profileData?.detected_patterns||[]).map(p=>`- ${p.description}`).join('\n')||'still learning';
    const goals=(profileData?.goals||[]).map(g=>g.label).join(', ')||'general fitness';
    const prompt=`You are a personal AI health coach. Write a "what I know about you" summary for this user.\n\nProfile: ${profileData?.name||'Julia'}, ${profileData?.gender||'female'}, goals: ${goals}\nBehavioral baseline: typical sleep ${bl.typical_sleep_hours||'?'}h, bedtime ${bl.typical_bedtime||'?'}, avg deep sleep ${bl.avg_deep_sleep_pct||'?'}%\nDetected patterns:\n${patterns}\nHealth notes: ${profileData?.health_notes||'none'}\n\nReturn 4–5 bullets, each a distinct thing you've learned about them, grouped by topic. Reference their actual baseline and strongest patterns; include one thing that makes them unique. Warm, direct, first person, so they feel genuinely seen.\n\nFORMAT — return ONLY these lines, each: topic emoji + short CAPS label + colon + one sentence. No intro or outro. Example shape:\n😴 YOUR SLEEP: <one sentence>\n💪 IN TRAINING: <one sentence>\n🥗 WITH FOOD: <one sentence>\n🌙 YOUR CYCLE: <one sentence>\n✨ WHAT STANDS OUT: <one sentence>`;
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:400,messages:[{role:"user",content:prompt}]})});
      const d=await res.json();
      const txt=d.content?.[0]?.text?.trim()||"";
      if(txt){setMemory(txt);try{localStorage.setItem(CACHE_KEY,txt);}catch{} supa("POST","profiles",{uid:UID,coach_memory:txt},"on_conflict=uid").catch(()=>{});}
    }catch(e){console.log("Memory card error:",e.message);}
    setLoading(false);
  }

  React.useEffect(()=>{ if(!memory&&apiKey) generate(); },[apiKey]);

  return (
    <div>
      <SecLabel>What your coach knows about you</SecLabel>
      <Card style={{marginBottom:14,borderLeft:`3px solid ${C.pu}`}}>
        {loading&&<div style={{fontSize:13,color:C.t2,display:"flex",alignItems:"center",gap:8}}><Spinner/>Generating your coach summary...</div>}
        {memory&&<BulletView text={memory}/>}
        {!loading&&memory&&!IS_DEMO&&<button onClick={()=>{setMemory(null);try{localStorage.removeItem(CACHE_KEY);}catch{}}} style={{...s.btn("s"),...s.btnSm,marginTop:10,fontSize:11}}>Regenerate</button>}
        {!loading&&!memory&&!apiKey&&<div style={{fontSize:12,color:C.t3}}>Add your API key in Settings to generate your coach summary.</div>}
      </Card>
    </div>
  );
}

function CycleHeaderPill({cycleDates, cycleLog, onPress}) {
  const lastPeriodStart = cycleLog?.last_period_start || cycleDates.filter(x=>x.ok).sort((a,b)=>new Date(b.d)-new Date(a.d))[0]?.d || null;
  let label="cycle", bg=C.pil, col=C.pi;
  const _hDatesArr = cycleLog?.period_start_dates?.length ? cycleLog.period_start_dates : (lastPeriodStart?[lastPeriodStart]:[]);
  if(_hDatesArr.length){
    const {phase,cycleDay}=calculateCyclePhase(_hDatesArr,cycleLog?.avg_period_length||5);
    label=`Day ${cycleDay} · ${phase}`;
    bg=phase==="menstrual"?C.rl:phase==="follicular"?C.tl:phase==="ovulatory"?C.al:C.pl;
    col=phase==="menstrual"?C.red:phase==="follicular"?C.teal:phase==="ovulatory"?C.am:C.pu;
  }
  return <button onClick={onPress} style={{fontSize:11,fontWeight:500,padding:"4px 10px",borderRadius:20,background:bg,color:col,border:"none",cursor:"pointer",fontFamily:"inherit"}}>{label}</button>;
}

// ── MAIN APP ──────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dash");
  const [apiKey, setApiKey] = useState(()=>IS_DEMO?"":(localStorage.getItem("jkey")||""));
  const [profileData, setProfileData] = useState(null);
  // protTgt now derives from profileData (falls back to 100 during load)
  const protTgt = profileData?.protein_target || 100;

  const [cycleDates, setCycleDates] = useState(()=>{
    try{const b=localStorage.getItem("jcycle_backup");return b?JSON.parse(b):[]}catch{return [];}
  });
  const [cycleLog, setCycleLog] = useState(()=>{
    try{const b=localStorage.getItem("jcycle_log");return b?JSON.parse(b):null;}catch{return null;}
  });
  const [suppState, setSuppState] = useState({});
  const [fitbitData, setFitbitData] = useState(FITBIT_SEED); // starts with seed, Supabase overwrites
  // Pre-load from localStorage immediately so data shows before Supabase responds
  const [allFood, setAllFood] = useState(()=>{
    try{const b=localStorage.getItem("jfood_backup");return b?JSON.parse(b):{}}catch{return {};}
  });
  const [logEntries, setLogEntries] = useState(()=>{
    try{const b=localStorage.getItem("jlog_backup");return b?JSON.parse(b):[]}catch{return [];}
  });
  const [showSett, setShowSett] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [ghConnected, setGhConnected] = useState(()=>isGTokenValid(getGToken()));
  const [ghSyncing, setGhSyncing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([{role:"ai",txt:"Hi Julia! I have full context on your sleep, workouts, nutrition and health log. What would you like to know?"}]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Updated Mon 15 Jun 2026, 10:15");
  const [settKey, setSettKey] = useState(apiKey);
  const [settProt, setSettProt] = useState(100);
  const [settTimezone, setSettTimezone] = useState(getTz());
  const [settCycle, setSettCycle] = useState(true);
  const [settWeekStart, setSettWeekStart] = useState("sunday");
  const [unlockKey, setUnlockKey] = useState("");
  const [unlockMsg, setUnlockMsg] = useState("");
  const [settErr, setSettErr] = useState("");
  const [aiRefreshTick, setAiRefreshTick] = useState(0);

  // Keep Settings modal protein field in sync once profile loads
  useEffect(()=>{ if(profileData?.protein_target) setSettProt(profileData.protein_target); },[profileData?.protein_target]);
  // Publish the profile timezone to the module-level helper used by metric components
  useEffect(()=>{ if(profileData?.timezone) setActiveTz(profileData.timezone); },[profileData?.timezone]);
  useEffect(()=>{ if(profileData?.week_start){setActiveWeekStart(profileData.week_start);setSettWeekStart(profileData.week_start);} },[profileData?.week_start]);

  // Intelligence layer — runs once after data loads, then after each sync
  const _intelligenceTs = React.useRef(0);
  useEffect(()=>{
    if(!profileData||!fitbitData||(fitbitData.sleep||[]).length<3) return;
    const now=Date.now();
    if(now-_intelligenceTs.current<60000) return; // debounce: 60s minimum between runs
    _intelligenceTs.current=now;
    const last30=buildLast30Days(fitbitData,allFood,cycleDates,profileData);
    runPatternDetection(profileData,fitbitData,allFood,cycleDates).then(patterns=>{
      setProfileData(p=>({...p,detected_patterns:patterns}));
      return buildBehavioralBaseline(last30);
    }).then(baseline=>{
      if(baseline) setProfileData(p=>({...p,behavioral_baseline:baseline}));
      return checkMilestones(profileData,last30);
    }).then(newM=>{
      if(newM.length>0){
        setProfileData(p=>({...p,triggered_milestones:[...(p?.triggered_milestones||[]),...newM.map(m=>m.id)]}));
      }
    }).catch(e=>console.log("Intelligence layer:",e.message));
  },[fitbitData?.sleep?.length,Object.keys(allFood).length]);

  useEffect(()=>{
    // Handle Google OAuth callback (token or error in URL hash) — owner only
    if(!IS_DEMO && (window.location.hash.includes("access_token")||window.location.hash.includes("error="))) {
      const handled = handleGoogleCallback();
      if(handled) {
        setGhConnected(true);
        // Auto-sync after connecting
        setTimeout(()=>ghFullSync(setSyncStatus, setFitbitData).catch(()=>{}), 500);
      }
    }
    async function load(){
      setSyncStatus("syncing...");
      // Load settings first (legacy protein target captured for profile default)
      let legacyProt = parseInt(localStorage.getItem("jprot")||"100")||100;
      if(!IS_DEMO){ // demo never loads an API key — zero AI calls in demo
        try{
          let rows=await supa("GET","settings",null,"user_id=eq."+UID+"&select=*");
          // Legacy fallback: the key may be stored under the old "julia" user_id.
          // Critical for the installed PWA, which has no localStorage jkey to fall back on.
          if((!rows||!rows.length||!rows[0].anthropic_key)){
            try{
              const legacy=await supa("GET","settings",null,"user_id=eq.julia&select=*");
              if(legacy&&legacy.length&&legacy[0].anthropic_key){
                rows=legacy;
                // Re-save under the current UID so future loads find it directly
                supa("POST","settings",{user_id:UID,anthropic_key:legacy[0].anthropic_key},"on_conflict=user_id").catch(()=>{});
              }
            }catch(e){}
          }
          if(rows&&rows.length){
            if(rows[0].anthropic_key){setApiKey(rows[0].anthropic_key);localStorage.setItem("jkey",rows[0].anthropic_key);}
            if(rows[0].protein_target){legacyProt=rows[0].protein_target;localStorage.setItem("jprot",String(rows[0].protein_target));}
          }
        }catch(e){}
      }

      // ── Load profile (and migrate / create default if missing) ───────────
      try{
        const profiles = await supa("GET","profiles",null,`uid=eq.${UID}`);
        let prof = profiles && profiles[0] ? profiles[0] : null;
        if (prof) {
          // Auto-detect timezone if missing
          if (!prof.timezone) {
            prof.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            try{ await supa("POST","profiles",{...prof},"on_conflict=uid"); }catch(e){}
          }
          // Restore Google token from Supabase if localStorage is empty or expired
          if(!IS_DEMO && prof.google_access_token && prof.google_token_expiry) {
            const expiresAt = new Date(prof.google_token_expiry).getTime();
            if(expiresAt > Date.now()+60000 && !isGTokenValid(getGToken())) {
              setGToken({access_token:prof.google_access_token, expires_at:expiresAt});
              setGhConnected(true);
            }
          }
          setProfileData(prof);
        } else if (IS_DEMO) {
          // Demo profile row missing (seed not run) — minimal Maya placeholder,
          // NEVER Julia's hardcoded personal data
          setProfileData({uid:UID,name:"Maya",gender:"female",protein_target:110,step_target:8000,
            active_days_target:20,activity_targets:{strength:3,mobility:1,cardio:1},
            activity_mapping:{},timezone:"Asia/Jerusalem",supplements:[],cycle_tracking:true,onboarding_complete:true});
        } else {
          // No profile — run one-time migration of known hardcoded data
          const migrated = {
            uid:"julia", // TODO: replace with auth user ID when Supabase Auth is added
            name:"Julia Serebro",
            birth_date:"1985-11-29",
            gender:"female",
            goals:[
              {id:"build_strength",label:"Build strength",definition:"progressive_overload",target_value:null,target_unit:null},
              {id:"body_composition",label:"Improve body composition",definition:"reduce_body_fat",target_value:null,target_unit:null},
              {id:"sleep_quality",label:"Sleep better",definition:"more_deep_rem",target_value:null,target_unit:null}
            ],
            activity_mapping:{"workout":"strength"},
            activity_targets:{strength:2,mobility:2,cardio:2},
            step_target:8000,
            protein_target:legacyProt,
            active_days_target:20,
            height_cm:166,
            supplements:[
              {name:"Creatine",dose:"5g",timing:"Morning with food"},
              {name:"Omega-3",dose:"standard",timing:"With meal"},
              {name:"Magnesium bisglycinate",dose:"standard",timing:"Evening"},
              {name:"D3 + K2",dose:"standard",timing:"Morning with fat"},
              {name:"Collagen",dose:"standard",timing:"With vitamin C"},
              {name:"Multivitamin",dose:"standard",timing:"With meal"}
            ],
            health_notes:"L4-L5 disc herniation with nerve root compression, history of radicular leg pain now largely resolved. T9-T10 thoracic spinal cord compression, surgically decompressed. Loaded hip extension movements currently restricted pending MRI clearance. Physiotherapy consultation planned.",
            cycle_tracking:true,
            timezone:getTz(),
            fitbit_connected:true,
            onboarding_complete:true
          };
          try{ await supa("POST","profiles",{...migrated},"on_conflict=uid"); }catch(e){ console.log("Profile migration save:",e.message); }
          setProfileData(migrated);
        }
      }catch(e){
        console.log("Profile load error:",e.message);
        // Fallback default so the app still renders
        setProfileData({
          uid: UID,
          name: IS_DEMO ? "Maya" : "Julia",
          birth_date: IS_DEMO ? null : "1985-11-29",
          gender: "female",
          protein_target: legacyProt,
          step_target: 8000,
          active_days_target: 20,
          activity_targets: {strength:2, mobility:2, cardio:2},
          activity_mapping: {"workout":"strength"},
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          supplements: [],
          cycle_tracking: true,
          onboarding_complete: false
        });
      }
      // Load data
      try{
        const [food,log,cyc,supp,fitbit,cycLog]=await Promise.all([
          supa("GET","food_log",null,"user_id=eq."+UID+"&order=created_at.asc&select=*"),
          supa("GET","journal_entries",null,"user_id=eq."+UID+"&order=created_at.desc&limit=100"),
          supa("GET","cycle_dates",null,"user_id=eq."+UID+"&order=date.asc"),
          supa("GET","supplement_log",null,"user_id=eq."+UID+"&log_date=eq."+tkey()),
          supa("GET","fitness_cache",null,"user_id=eq."+UID+"&limit=1"),
          supa("GET","cycle_logs",null,"uid=eq."+UID+"&limit=1").catch(()=>null),
        ]);
        // DEMO: the seeded data has fixed dates that go stale. Shift every date
        // forward so the newest seeded sleep is always "last night" — the demo
        // stays permanently fresh without re-running the seed script.
        let demoShift=0;
        if(IS_DEMO){
          try{
            const sl=fitbit?.[0]?.data?.sleep||[];
            const newest=sl.reduce((m,x)=>x.date>m?x.date:m,"");
            if(newest){
              const todayIL=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
              demoShift=Math.round((new Date(todayIL+"T12:00:00")-new Date(newest+"T12:00:00"))/864e5);
            }
          }catch(e){}
        }
        const dShift=(ds)=>{
          if(!demoShift||!ds) return ds;
          const d=new Date(ds+"T12:00:00"); d.setDate(d.getDate()+demoShift);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        };

        // Also load legacy "julia" food entries (pre-UID-migration) — owner only,
        // demo must never touch Julia's rows
        let legacyFood=[];
        if(!IS_DEMO){try{legacyFood=await supa("GET","food_log",null,"user_id=eq.julia&order=created_at.asc&select=*");}catch(e){}}
        const allFoodRows=[...(legacyFood||[]),...(food||[])];
        const foodMap={};
        allFoodRows.forEach(r=>{
          const dateKey=dShift(r.log_date);
          if(!foodMap[dateKey])foodMap[dateKey]=[];
          let parsedItems=null;
          try{if(r.parsed_items)parsedItems=typeof r.parsed_items==="string"?JSON.parse(r.parsed_items):r.parsed_items;}catch(e){}
          foodMap[dateKey].push({dbid:r.id,n:r.name,det:r.detail,p:r.protein,c:r.carbs,f:r.fat,k:r.kcal,time:r.meal_time||r.eaten_time,eaten_time:r.eaten_time||r.meal_time,parsed_items:parsedItems});
        });
        // Merge backup: only recover local-only entries for dates Supabase has NO data for
        // (owner only — demo never reads or writes local backups)
        if(!IS_DEMO){
          try {
            const backup = JSON.parse(localStorage.getItem("jfood_backup")||"{}");
            Object.entries(backup).forEach(([date, entries]) => {
              if(foodMap[date]?.length>0) return; // Supabase has data for this date — trust it
              const localOnly = (entries||[]).filter(e=>!e.dbid);
              if(localOnly.length>0) foodMap[date] = localOnly;
            });
          } catch(e){}
        }
        setAllFood(foodMap);
        if(!IS_DEMO) localStorage.setItem("jfood_backup",JSON.stringify(foodMap));
        const logData=(log||[]).map(r=>({id:r.id,dt:demoShift?new Date(new Date(r.created_at).getTime()+demoShift*864e5).toISOString():r.created_at,tag:r.tag,txt:r.txt}));
        setLogEntries(logData);
        if(!IS_DEMO) localStorage.setItem("jlog_backup",JSON.stringify(logData));

        // Load cycle data — prefer cycle_logs (merge-based) over cycle_dates (row-based)
        const cycLogRecord = cycLog?.[0] || null;
        if(cycLogRecord?.period_start_dates?.length) {
          // cycle_logs is authoritative (demo: dates shifted with everything else)
          const dates = cycLogRecord.period_start_dates.map(dShift);
          if(demoShift){ cycLogRecord.period_start_dates=dates; cycLogRecord.last_period_start=dShift(cycLogRecord.last_period_start); }
          const parsed = dates.map((d,i)=>({id:i,d,ok:true}));
          setCycleDates(parsed);
          setCycleLog(cycLogRecord);
          if(!IS_DEMO){
            localStorage.setItem("jcycle_backup",JSON.stringify(parsed));
            localStorage.setItem("jcycle_log",JSON.stringify(cycLogRecord));
          }
        } else {
          // Fall back to cycle_dates rows — and migrate them into cycle_logs
          const cycleParsed=(cyc||[]).map(r=>({id:r.id,d:r.date,ok:r.confirmed}));
          if(cycleParsed.length>0){
            setCycleDates(cycleParsed);
            if(!IS_DEMO) localStorage.setItem("jcycle_backup",JSON.stringify(cycleParsed));
            // Migrate to cycle_logs silently
            const dates=cycleParsed.filter(x=>x.ok).map(x=>x.d).sort((a,b)=>new Date(b)-new Date(a)).slice(0,6);
            if(dates.length>0){
              const cycleLens=[]; for(let i=0;i<dates.length-1;i++) cycleLens.push(Math.round((new Date(dates[i])-new Date(dates[i+1]))/864e5));
              const avg=cycleLens.length?Math.round(cycleLens.reduce((a,b)=>a+b,0)/cycleLens.length):28;
              const migrated={uid:UID,period_start_dates:dates,avg_cycle_length:avg,last_period_start:dates[0]};
              supa("POST","cycle_logs",migrated,"on_conflict=uid").then(()=>{setCycleLog(migrated);localStorage.setItem("jcycle_log",JSON.stringify(migrated));}).catch(()=>{});
            }
          } else {
            const cb=localStorage.getItem("jcycle_backup");
            if(cb){try{const parsed=JSON.parse(cb);if(parsed.length>0)setCycleDates(parsed);}catch(ex){}}
            const cl=localStorage.getItem("jcycle_log");
            if(cl){try{setCycleLog(JSON.parse(cl));}catch(ex){}}
          }
        }
        // Only load supplements for TODAY - reset daily
        const todayKey2=new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
        const ss={};
        (supp||[]).forEach(r=>{if(r.taken&&r.log_date===todayKey2)ss[r.supplement]=true;});
        setSuppState(ss);
        // Load fitbit data from Supabase.
        // Owner: merge FITBIT_SEED + legacy "julia" + UUID rows.
        // Demo: fitness_cache row for demo_maya ONLY — never Julia's seed or legacy data.
        let legacyData=null;
        if(!IS_DEMO){
          try{
            const legacyFit=await supa("GET","fitness_cache",null,"user_id=eq.julia&limit=1");
            if(legacyFit&&legacyFit[0]&&legacyFit[0].data) legacyData=legacyFit[0].data;
          }catch(ex){}
        }
        if(fitbit&&fitbit[0]&&fitbit[0].data){
          console.log("✓ Fitness data loaded from Supabase, synced_at:",fitbit[0].synced_at);
          const supaData=fitbit[0].data;
          if(IS_DEMO){
            setFitbitData({
              sleep:(supaData.sleep||[]).map(x=>({...x,date:dShift(x.date)})).sort((a,b)=>b.date.localeCompare(a.date)),
              naps:(supaData.naps||[]).map(x=>({...x,date:dShift(x.date)})),
              steps:(supaData.steps||[]).map(x=>({...x,date:dShift(x.date)})).sort((a,b)=>a.date.localeCompare(b.date)),
              workouts:(supaData.workouts||[]).map(x=>({...x,date:dShift(x.date)})).sort((a,b)=>b.date.localeCompare(a.date)),
              synced_at:new Date().toISOString()
            });
          } else {
          // Merge: seed → legacy "julia" → UUID (newest wins per date)
          const mergeByDate=(...arrs)=>{
            const m={};
            arrs.forEach(arr=>(arr||[]).forEach(x=>{m[x.date]=x;}));
            return Object.values(m);
          };
          const mergeWorkouts=(...arrs)=>{
            const m={};
            arrs.forEach(arr=>(arr||[]).forEach(w=>{m[w.date+'|'+w.type]=w;}));
            return Object.values(m);
          };
          setFitbitData({
            sleep: mergeByDate(FITBIT_SEED.sleep,legacyData?.sleep,supaData.sleep).sort((a,b)=>b.date.localeCompare(a.date)),
            naps: supaData.naps||legacyData?.naps||FITBIT_SEED.naps||[],
            steps: mergeByDate(FITBIT_SEED.steps,legacyData?.steps,supaData.steps).sort((a,b)=>a.date.localeCompare(b.date)),
            workouts: mergeWorkouts(FITBIT_SEED.workouts,legacyData?.workouts,supaData.workouts).sort((a,b)=>b.date.localeCompare(a.date)),
            synced_at: supaData.synced_at
          });
          }
        } else if(IS_DEMO){
          console.log("⚠ No demo fitness_cache — run seed_demo.py");
          setFitbitData({sleep:[],naps:[],steps:[],workouts:[]});
        } else {
          console.log("⚠ No fitness_cache in Supabase, using FITBIT_SEED");
          setFitbitData(FITBIT_SEED);
        }
        setSyncStatus("Synced "+new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}));
      // Auto-sync Google Health if token is valid (never in demo)
      if(!IS_DEMO && isGTokenValid(getGToken())) {
        // On first connection (no historical pull yet), show a specific loading message
        const profSnap = await supa("GET","profiles",null,"uid=eq."+UID+"&limit=1").catch(()=>[]);
        const needsHistorical = profSnap?.[0]?.fitbit_connected && !profSnap?.[0]?.historical_pull_complete;
        if(needsHistorical) setSyncStatus("Your coach is reviewing the last 14 days...");
        ghFullSync(setSyncStatus, setFitbitData).then(()=>{
          if(needsHistorical){
            supa("PATCH","profiles",{historical_pull_complete:true,historical_pull_date:new Date().toISOString()},"uid=eq."+UID).catch(()=>{});
          }
        }).catch(e=>console.log("Auto-sync:",e.message));
      }
      }catch(e){
        const msg = e.message||String(e);
        setSyncStatus("sync error: "+msg.slice(0,40));
        console.error("Supabase load error:", e);
        if(IS_DEMO){
          // Demo has no local backups and must never fall back to Julia's seed
          setFitbitData({sleep:[],naps:[],steps:[],workouts:[]});
          return;
        }
        // Fall back to localStorage backup
        const backup=localStorage.getItem("jlog_backup");
        if(backup) try{setLogEntries(JSON.parse(backup));}catch(ex){}
        const foodBackup=localStorage.getItem("jfood_backup");
        if(foodBackup) try{setAllFood(JSON.parse(foodBackup));}catch(ex){}
        const cycleBackup=localStorage.getItem("jcycle_backup");
        if(cycleBackup) try{setCycleDates(JSON.parse(cycleBackup));}catch(ex){}
        // Use seed data as fallback
        setFitbitData(FITBIT_SEED);
      }
    }
    load();
  },[]);

  // Proactive token refresh: renew silently ~10 min before expiry so the user
  // never sees a login screen. Skipped when running inside the refresh iframe.
  useEffect(()=>{
    if(IS_DEMO) return; // no Google calls in demo
    if(window.self!==window.top) return;
    const tick=()=>{
      const t=getGToken();
      if(!t||!localStorage.getItem("gh_consent_granted")) return;
      if(t.expires_at-Date.now()<10*60000){
        silentGoogleRefresh().then(()=>setGhConnected(true)).catch(()=>{});
      }
    };
    tick();
    const iv=setInterval(tick,5*60000);
    return ()=>clearInterval(iv);
  },[]);

  async function syncGoogleHealth() {
    if(IS_DEMO) return;
    if(!isGTokenValid(getGToken())) {
      setSyncStatus("Reconnecting to Google Health...");
      try{
        await silentGoogleRefresh();
        // Token refreshed silently — fall through to sync
      }catch(e){
        // Silent refresh failed — full page redirect (only happens if Google session expired)
        startGoogleAuth(false);
        return;
      }
    }
    setGhSyncing(true);
    try {
      await ghFullSync(setSyncStatus, setFitbitData);
      setAiRefreshTick(t=>t+1);
    } catch(e){}
    setGhSyncing(false);
  }

  async function saveSett(){
    if(IS_DEMO){ showDemoToast(); setShowSett(false); return; }
    // Sanitize + validate the API key: whitespace stripped; anything that
    // doesn't look like an Anthropic key is rejected loudly, never saved
    // silently (a pasted meal description once ended up here).
    const cleanKey=(settKey||"").replace(/\s+/g,"");
    if(cleanKey&&!cleanKey.startsWith("sk-ant-")){
      setSettErr("That doesn't look like an Anthropic API key (should start with sk-ant-). Not saved — check your clipboard.");
      return;
    }
    setSettErr("");
    setSettKey(cleanKey);
    if(cleanKey){
      localStorage.setItem("jkey",cleanKey);
      setApiKey(cleanKey);
      try{await supa("POST","settings",{user_id:UID,anthropic_key:cleanKey},"on_conflict=user_id");}catch(e){}
    }
    try{
      await supa("POST","profiles",{uid:UID,timezone:settTimezone,cycle_tracking:settCycle,week_start:settWeekStart},"on_conflict=uid");
      setProfileData(p=>({...p,timezone:settTimezone,cycle_tracking:settCycle,week_start:settWeekStart}));
      setActiveTz(settTimezone);
      setActiveWeekStart(settWeekStart);
    }catch(e){}
    setShowSett(false);
  }

  async function saveSupplementsFromFood(newSupps){
    try{
      await supa("POST","profiles",{uid:UID,supplements:newSupps},"on_conflict=uid");
      setProfileData(p=>({...p,supplements:newSupps}));
    }catch(e){ console.log("Supp save error:",e.message); }
  }

  async function saveFoodSensitivities(list){
    try{
      await supa("POST","profiles",{uid:UID,food_sensitivities:list},"on_conflict=uid");
      setProfileData(p=>({...p,food_sensitivities:list}));
    }catch(e){ console.log("Sensitivities save error:",e.message); }
  }

  async function setSupp(id,val){
    setSuppState(p=>({...p,[id]:val}));
    try{await supa("POST","supplement_log",{user_id:UID,log_date:tkey(),supplement:id,taken:val},"on_conflict=user_id,log_date,supplement");}catch(e){}
  }

  function buildCtxForChat(){
    let ctx = buildCtxFull({allFood, logEntries, cycleDates, protTgt, fitbitData, profileData});
    // Include today's in-app coach insights so chat and coach card are consistent
    try{
      const todayKey = new Date().toLocaleDateString("en-CA",{timeZone:getTz()});
      const cc = JSON.parse(localStorage.getItem("coach_content_"+todayKey)||"null");
      if(cc && !cc.isLearning){
        const parts = [];
        if(cc.headline) parts.push("Headline: "+cc.headline);
        if(cc.why) parts.push("Why: "+cc.why);
        (cc.domain_insights||[]).forEach(i=>parts.push(`${i.type}: ${i.content}`));
        if(cc.micro_workout) parts.push("Suggested 5-min move: "+cc.micro_workout);
        if(parts.length) ctx += "\n\nWHAT YOU (THE COACH) ALREADY TOLD JULIA TODAY IN THE APP — you said this, own it, refer back to it if she asks:\n"+parts.join("\n");
      }
    }catch(e){}
    return ctx;
  }

  async function sendChat(){
    if(!chatInput.trim()) return;
    if(IS_DEMO){
      const msg=chatInput.trim();setChatInput("");
      setChatMsgs(p=>[...p,{role:"user",txt:msg},{role:"ai",txt:"This is a demo — the live AI coach isn't active here. In the full app I'd answer using Maya's sleep, training, nutrition and cycle data, and I'd remember this conversation."}]);
      return;
    }
    if(!apiKey) return;
    const msg=chatInput.trim();setChatInput("");setChatLoading(true);
    const history=[...chatMsgs,{role:"user",txt:msg}];
    setChatMsgs(history);
    try{
      // Send conversation history (last 12 turns) so follow-up questions have context
      let apiMsgs = history.slice(-12).map(m=>({role:m.role==="ai"?"assistant":"user",content:m.txt}));
      while(apiMsgs.length&&apiMsgs[0].role==="assistant") apiMsgs.shift(); // API requires first message to be user
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:400,system:"You are Julia's AI health coach inside her health dashboard app. Answer as the same coach that wrote today's in-app insights.\n\n"+buildCtxForChat(),messages:apiMsgs})
      });
      const d=await res.json();
      const reply=d.content?.[0]?.text||"Error";
      setChatMsgs(p=>[...p,{role:"ai",txt:reply}]);
    }catch(e){setChatMsgs(p=>[...p,{role:"ai",txt:"Error: "+e.message}]);}
    setChatLoading(false);
  }

  const TABS=[{id:"dash",label:"Dashboard"},{id:"food",label:"Food"},{id:"log",label:"Log"},{id:"profile",label:"Profile"},{id:"cycle",label:"Cycle"}];

  const isViewOnly = new URLSearchParams(window.location.search).get("view")==="1";

  // Wait for profile to load before rendering the full app
  if (profileData === null) {
    return (
      <div style={{...s.shell,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:13,color:C.t2}}><Spinner/>Loading your profile...</div>
      </div>
    );
  }

  return (
    <div style={s.shell}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} * {box-sizing:border-box;margin:0;padding:0}
        .bottomNav{display:none}
        button{-webkit-tap-highlight-color:transparent}
        @keyframes fadeUp{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
        .hcCard{animation:fadeUp .32s cubic-bezier(.3,.7,.4,1) both}
        @media(prefers-reduced-motion:reduce){.hcCard{animation:none}}
        @media(max-width:640px){
          .topTabs{display:none !important}
          .appTitle{font-size:26px !important}
          .bottomNav{display:flex !important;position:fixed;bottom:0;left:0;right:0;z-index:60;
            background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
            border-top:1px solid rgba(0,0,0,.07);
            padding:6px 4px calc(6px + env(safe-area-inset-bottom));
            justify-content:space-around;align-items:center}
          .bottomNav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;
            background:none;border:none;font-family:inherit;cursor:pointer;padding:6px 0;min-height:52px;justify-content:center;position:relative}
          .bottomNav button .navPill{position:absolute;top:2px;left:50%;transform:translateX(-50%);
            width:52px;height:30px;border-radius:16px;background:#eeedf8;z-index:0;transition:opacity .2s}
          .coachFab{bottom:calc(78px + env(safe-area-inset-bottom)) !important}
        }`}</style>
      {IS_DEMO&&<div style={{background:"linear-gradient(90deg,#eeedf8,#e0f4ed)",color:"#4a42b0",fontSize:12,textAlign:"center",padding:"8px 14px",fontWeight:500,borderRadius:10,marginBottom:14,border:"1px solid rgba(74,66,176,.15)"}}>
        👋 You're exploring a live demo of Health Coach — all data belongs to Maya, a sample user.
      </div>}
      {(()=>{
        // One-time iOS "Add to Home Screen" hint (iOS has no install prompt)
        const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent);
        const standalone=(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||window.navigator.standalone===true;
        let dismissed=false; try{dismissed=!!localStorage.getItem("a2hs_dismissed");}catch(e){}
        if(!isIOS||standalone||dismissed) return null;
        return (
          <div style={{background:C.sf,border:`1px solid ${C.bd}`,borderRadius:10,padding:"9px 14px",marginBottom:14,fontSize:12,color:C.t2,display:"flex",alignItems:"center",gap:10}}>
            <span style={{flex:1}}>📲 Install this app: tap <strong>Share</strong> then <strong>Add to Home Screen</strong> — it launches full-screen like a native app.</span>
            <button onClick={e=>{try{localStorage.setItem("a2hs_dismissed","1");}catch(ex){}e.target.closest("div").style.display="none";}} style={{background:"none",border:"none",color:C.t3,cursor:"pointer",fontSize:15}}>×</button>
          </div>
        );
      })()}
      {isViewOnly&&<div style={{background:"#e8f4fd",color:"#1a6896",fontSize:11,textAlign:"center",padding:"6px 12px",fontWeight:500,borderBottom:"1px solid #b8d9ee"}}>
        View-only mode — showing last synced data &nbsp;|&nbsp; <a href={window.location.pathname} style={{color:"#1a6896"}}>Open full app</a>
      </div>}

      {/* ── HEADER: quiet wordmark, the date is the human line, icon-only actions ── */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:16}}>
        <div>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",color:C.t3}}>
            Health <span style={{color:C.pu}}>Coach</span>
          </div>
          <h1 className="appTitle" style={{...s.h1,fontSize:24,marginTop:3}}>
            {new Date().toLocaleDateString("en-GB",{weekday:"long",timeZone:getTz()})}<span style={{color:C.t3,fontStyle:"normal",fontFamily:"'Inter',sans-serif",fontSize:15,fontWeight:400,marginLeft:8}}>{new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",timeZone:getTz()})}</span>
          </h1>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {IS_DEMO
            ? <span style={{fontSize:11,padding:"5px 12px",borderRadius:20,background:C.s2,color:C.t3}}>Demo</span>
            : <button title={syncStatus} onClick={()=>setShowSync(true)} style={{width:38,height:38,borderRadius:"50%",background:C.sf,border:`1px solid rgba(0,0,0,.06)`,boxShadow:"0 1px 3px rgba(26,25,23,.06)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:C.t2}}>
                <Icon name="sync" size={17} style={ghSyncing?{animation:"spin 1s linear infinite"}:{}}/>
              </button>}
          <button title="Settings" onClick={()=>{setSettTimezone(profileData?.timezone||getTz());setSettCycle(profileData?.cycle_tracking!==false);setSettWeekStart(profileData?.week_start||"sunday");setShowSett(true);}} style={{width:38,height:38,borderRadius:"50%",background:C.sf,border:`1px solid rgba(0,0,0,.06)`,boxShadow:"0 1px 3px rgba(26,25,23,.06)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:C.t2}}>
            <Icon name="settings" size={17}/>
          </button>
        </div>
      </div>
      {/* Sync status: only surfaces when something needs attention */}
      {/error|Tap Sync|Reconnect|syncing|Syncing/i.test(syncStatus)&&(
        <div style={{fontSize:11,color:/error/i.test(syncStatus)?C.red:C.t3,marginTop:-8,marginBottom:12}}>{syncStatus}</div>
      )}

      <div className="topTabs" style={s.tabs}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={s.tb(tab===t.id)}>{t.label}</button>)}
      </div>

      {tab==="dash" && <TabDash allFood={allFood} logEntries={logEntries} cycleDates={cycleDates} cycleLog={cycleLog} apiKey={apiKey} protTgt={protTgt} aiRefreshTick={aiRefreshTick} fitbitData={fitbitData} profileData={profileData}/>}
      {tab==="food" && <TabFood allFood={allFood} setAllFood={setAllFood} protTgt={protTgt} apiKey={apiKey} onFoodLogged={()=>{setAiRefreshTick(t=>t+1);}} suppState={suppState} setSupp={setSupp} profileData={profileData} onSaveSupps={saveSupplementsFromFood} onSaveSensitivities={saveFoodSensitivities}/>}
      {tab==="cycle" && <TabCycle cycleDates={cycleDates} setCycleDates={setCycleDates} cycleLog={cycleLog} setCycleLog={setCycleLog}/>}
      {tab==="log" && <TabLog logEntries={logEntries} setLogEntries={setLogEntries}/>}
      {tab==="profile" && <TabProfile suppState={suppState} setSupp={setSupp} profileData={profileData} setProfileData={setProfileData} fitbitData={fitbitData} apiKey={apiKey}/>}

      {/* COACH CHAT BUTTON */}
      <button className="coachFab" onClick={()=>setShowChat(true)} style={{position:"fixed",bottom:24,right:20,zIndex:50,background:C.pu,color:"#fff",border:"none",borderRadius:30,padding:"12px 18px",fontFamily:"inherit",fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(74,66,176,.35)"}}>
        <Icon name="chat" size={16} color="#fff"/> Ask your coach
      </button>

      {/* BOTTOM NAV — native-style tab bar, mobile only (CSS media query) */}
      <nav className="bottomNav">
        {[["dash","home","Home"],["food","food","Food"],["log","log","Log"],["profile","profile","Profile"],["cycle","moon","Cycle"]].map(([id,icon,label])=>(
          <button key={id} onClick={()=>setTab(id)}>
            {tab===id&&<span className="navPill"/>}
            <span style={{position:"relative",zIndex:1,display:"flex"}}><Icon name={icon} size={21} color={tab===id?C.pu:C.t3} strokeWidth={tab===id?2.2:1.8}/></span>
            <span style={{position:"relative",zIndex:1,fontSize:10,fontWeight:tab===id?700:500,color:tab===id?C.pu:C.t3}}>{label}</span>
          </button>
        ))}
      </nav>

      {/* CHAT MODAL */}
      {showChat&&(
        <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setShowChat(false);}}>
          <div style={{...s.modal,width:440,maxHeight:"80vh",display:"flex",flexDirection:"column",padding:0,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px",borderBottom:`.5px solid ${C.bd}`}}>
              <div>
                <h3 style={{fontSize:15,fontWeight:600,margin:0}}>Your AI health coach</h3>
                <p style={{fontSize:11,color:C.t3,margin:"2px 0 0"}}>Asks about your actual data</p>
              </div>
              <button onClick={()=>setShowChat(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:C.t3}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10,minHeight:200}}>
              {chatMsgs.map((m,i)=>(
                <div key={i} style={{maxWidth:"88%",padding:"9px 12px",borderRadius:12,fontSize:13,lineHeight:1.55,alignSelf:m.role==="user"?"flex-end":"flex-start",background:m.role==="user"?C.pu:C.s2,color:m.role==="user"?"#fff":C.tx}}>{m.txt}</div>
              ))}
              {chatLoading&&<div style={{alignSelf:"flex-start",background:C.s2,padding:"9px 12px",borderRadius:12,fontSize:13,color:C.t3}}><Spinner/>Thinking...</div>}
            </div>
            <div style={{display:"flex",gap:8,padding:"12px 14px",borderTop:`.5px solid ${C.bd}`}}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Ask anything about your health..." style={{...s.input,flex:1,borderRadius:20}}/>
              <button onClick={sendChat} style={{...s.btn("p"),borderRadius:20,padding:"9px 16px"}}>Send</button>
            </div>
          </div>
        </div>
      )}

      {/* SYNC MODAL */}
      {showSync&&(
        <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setShowSync(false);}}>
          <div style={s.modal}>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:8}}>🔄 Sync health data</h3>
            {ghConnected ? (
              <div>
                <p style={{fontSize:13,color:C.t2,marginBottom:16,lineHeight:1.6}}>Connected to Google Health. Tap sync to fetch your latest steps, sleep, and workouts from the last 14 days.</p>
                <button onClick={()=>{setShowSync(false);syncGoogleHealth();}} style={{...s.btn("p"),width:"100%",padding:12,fontSize:14,marginBottom:12}}>
                  {ghSyncing?"Syncing...":"Sync now →"}
                </button>
                <button onClick={()=>{clearGToken();setGhConnected(false);}} style={{...s.btn("s"),width:"100%",fontSize:12}}>Disconnect Google Health</button>
              </div>
            ) : (
              <div>
                <p style={{fontSize:13,color:C.t2,marginBottom:16,lineHeight:1.6}}>Connect your Google account to automatically sync steps, sleep, and workouts from your Fitbit Charge 6 — on any device, no Claude Desktop needed.</p>
                <button onClick={()=>{setShowSync(false);syncGoogleHealth();}} style={{...s.btn("p"),width:"100%",padding:12,fontSize:14,marginBottom:12}}>
                  Connect Google Health →
                </button>
                <p style={{fontSize:11,color:C.t3,lineHeight:1.6}}>You will be redirected to Google to grant permission, then returned to the app automatically.</p>
              </div>
            )}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
              <button onClick={()=>setShowSync(false)} style={s.btn("s")}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSett&&!isViewOnly&&(
        <div style={s.mo} onClick={e=>{if(e.target===e.currentTarget)setShowSett(false);}}>
          <div style={{...s.modal,width:420}}>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:16}}>Settings</h3>
            {IS_DEMO&&(
              <div style={{marginBottom:16,paddingBottom:14,borderBottom:`1px solid ${C.bd}`}}>
                <label style={{fontSize:12,fontWeight:500,color:C.t2,display:"block",marginBottom:4}}>Owner access key</label>
                <div style={{display:"flex",gap:8}}>
                  <input type="password" value={unlockKey} onChange={e=>setUnlockKey(e.target.value)} placeholder="Enter your access key" style={{...s.input,flex:1,fontFamily:"monospace",fontSize:12}}/>
                  <button onClick={()=>{
                    if(unlockKey.trim()===OWNER_KEY){
                      try{localStorage.setItem("owner_device",OWNER_KEY);sessionStorage.setItem("owner_mode",OWNER_KEY);}catch(e){}
                      window.location.reload();
                    } else { setUnlockMsg("That key doesn't match."); }
                  }} style={{...s.btn("p"),...s.btnSm}}>Unlock</button>
                </div>
                <p style={{fontSize:11,color:unlockMsg?C.red:C.t3,marginTop:4}}>{unlockMsg||"Unlocks your personal dashboard on this device — needed once in the installed app."}</p>
              </div>
            )}
            <label style={{fontSize:12,fontWeight:500,color:C.t2,display:"block",marginBottom:4}}>Anthropic API key</label>
            <input type="password" value={settKey} onChange={e=>{setSettKey(e.target.value);setSettErr("");}} placeholder="sk-ant-api03-..." style={{...s.input,marginBottom:4,fontFamily:"monospace",fontSize:12}}/>
            {settErr&&<p style={{fontSize:11,color:C.red,marginBottom:6}}>{settErr}</p>}
            <p style={{fontSize:11,color:C.t3,marginBottom:14}}>{settKey?`Current key: ${settKey.slice(0,10)}…${settKey.slice(-4)}`:"No key set on this device."} Synced to your account so all devices share it.</p>
            <label style={{fontSize:12,fontWeight:500,color:C.t2,display:"block",marginBottom:4}}>Timezone</label>
            <input value={settTimezone} onChange={e=>setSettTimezone(e.target.value)} placeholder="e.g. Asia/Jerusalem" style={{...s.input,marginBottom:4}}/>
            <p style={{fontSize:11,color:C.t3,marginBottom:14}}>Controls all date/time calculations in the app.</p>
            <label style={{fontSize:12,fontWeight:500,color:C.t2,display:"block",marginBottom:4}}>Week starts on</label>
            <select value={settWeekStart} onChange={e=>setSettWeekStart(e.target.value)} style={{...s.input,marginBottom:4}}>
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </select>
            <p style={{fontSize:11,color:C.t3,marginBottom:14}}>Controls weekly stats, targets and the weekly review window.</p>
            {profileData?.gender==="female"&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500}}>Cycle tracking</div>
                  <div style={{fontSize:11,color:C.t3}}>Show cycle phase across the app</div>
                </div>
                <button onClick={()=>setSettCycle(v=>!v)} style={{...s.btn(settCycle?"p":"s"),...s.btnSm}}>{settCycle?"On":"Off"}</button>
              </div>
            )}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowSett(false)} style={s.btn("s")}>Cancel</button>
              <button onClick={saveSett} style={s.btn("p")}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
