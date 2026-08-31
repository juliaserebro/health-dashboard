#!/usr/bin/env python3
"""
PRE-DEPLOYMENT QA SCRIPT
Run: python3 qa_check.py
All checks must pass before deploying index.html
"""
import re, json, subprocess, sys
from datetime import date, timedelta

ERRORS = []
WARNINGS = []

def fail(msg): ERRORS.append(msg)
def warn(msg): WARNINGS.append(msg)

with open("dashboard.jsx", encoding="utf-8") as f:
    jsx = f.read()

# ── 1. JS SYNTAX ─────────────────────────────────────────────────────────
import tempfile, os
tmp = tempfile.NamedTemporaryFile(suffix=".js", delete=False, mode="w", encoding="utf-8")
tmp.write(jsx); tmp.close()
r = subprocess.run(["node","--check",tmp.name], capture_output=True, text=True)
os.unlink(tmp.name)
if r.returncode != 0:
    fail(f"JS SYNTAX ERROR: {r.stderr[:200]}")
else:
    print("✓ JS syntax OK")

# ── 2. NO EXPORT DEFAULT ─────────────────────────────────────────────────
# Check built HTML not JSX - export default must be removed during build
try:
    with open("index.html", encoding="utf-8") as hf:
        html_content = hf.read()
    if "export default" in html_content:
        fail("export default found in index.html — will break Babel")
    else:
        print("✓ No export default in HTML")
except FileNotFoundError:
    warn("index.html not found - build first")

# ── 3. EVEN BACKTICK COUNT ───────────────────────────────────────────────
bc = jsx.count("`")
if bc % 2 != 0:
    fail(f"Odd backtick count ({bc}) — unclosed template literal")
else:
    print(f"✓ Backtick count even ({bc})")

# ── 4. FITBIT_SEED INTEGRITY ─────────────────────────────────────────────
idx = jsx.find("const FITBIT_SEED =")
end = jsx.find(";\n", idx)+2
seed = json.loads(jsx[idx+len("const FITBIT_SEED = "):end-2])
today = date.today()
day_names = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
for s in seed["steps"]:
    d = date.fromisoformat(s["date"])
    if d > today:
        if s["steps"] > 0:
            fail(f"Future date {s['date']} has {s['steps']} steps in seed")
    if s["steps"] < 0:
        fail(f"Negative steps on {s['date']}")
print(f"✓ FITBIT_SEED: {len(seed['steps'])} step days, {len(seed['workouts'])} workouts, {len(seed['sleep'])} sleep nights")

# ── 5. HARDCODED VALUES SCAN ─────────────────────────────────────────────
bad_patterns = [
    ("Sun 7 Jun", "hardcoded week date"),
    ("Sat 13 Jun", "hardcoded week date"),
    ("57,030", "hardcoded step total"),
    ("2 gym · 2 yoga", "hardcoded workout summary"),
    ("efficiency bonus (49%)", "hardcoded efficiency"),
    ("value=\"0\" sub=\"2", "hardcoded workouts metric"),
    ("value=\"89\"", "hardcoded readiness score"),
    ("value=\"80\"", "hardcoded readiness score"),
]
for pattern, label in bad_patterns:
    # Skip if only in FITBIT_SEED
    outside_seed = jsx.replace(jsx[idx:end], "")
    if pattern in outside_seed:
        fail(f"Hardcoded value found: '{pattern}' ({label})")
print("✓ Hardcoded values scan complete")

# ── 6. WEEK CALCULATION SIMULATION ───────────────────────────────────────
today_il = today  # assume server = Israel for QA
dow = today_il.weekday()
js_dow = (dow+1)%7
sun = today_il - timedelta(days=js_dow)
week_dates = [(today_il - timedelta(days=i)).isoformat() for i in range(js_dow+1)]
print(f"✓ Week simulation: today={today_il}, dow={js_dow}, sundayBar={sun}, weekDates={week_dates[:3]}...")

# ── 7. DYNAMIC vs HARDCODED ──────────────────────────────────────────────
required_dynamic = [
    ("durScore+deepScore+remScore", "readiness score formula"),
    ("fitbitData.sleep", "sleep card reads fitbitData"),
    ("fitbitData.steps", "steps reads fitbitData"),
    ("fitbitData.workouts", "workouts reads fitbitData"),
    ("WeeklyWorkoutsMetric", "weekly workouts dynamic"),
    ("MonthlyMetrics", "monthly metrics dynamic"),
    ("buildCtxFull", "standalone buildCtx"),
]
for pattern, label in required_dynamic:
    if pattern not in jsx:
        fail(f"Missing dynamic component: {label}")
print("✓ Dynamic components check complete")

# ── 8. API CALL SAFETY ───────────────────────────────────────────────────
if "dataSourceFamily" in jsx:
    fail("dataSourceFamily parameter found — causes 400 errors")
if "civil_start_time" not in jsx:
    fail("civil_start_time filter missing from steps fetch")
if "dailyRollUp" in jsx and "POST" in jsx[jsx.find("dailyRollUp")-50:jsx.find("dailyRollUp")+50]:
    fail("dailyRollUp POST found — always fails with 400")
print("✓ API call safety OK")

# ── 9. MERGE SAFETY ──────────────────────────────────────────────────────
if "stepsArr.length>0 ? stepsArr : prev.steps" in jsx:
    fail("Simple merge found — steps can be wiped by empty sync")
if "seedVal" not in jsx or "syncVal" not in jsx:
    warn("Smart steps merge not found — check merge logic")
print("✓ Merge safety check complete")

# ── 10. SUPABASE ─────────────────────────────────────────────────────────
if "\"source\":source" in jsx or "\"source\":entry.source" in jsx:
    fail("source column in food_log insert — column doesn't exist")
if "jfood_backup" not in jsx:
    fail("food localStorage backup missing")
if "jcycle_backup" not in jsx:
    fail("cycle localStorage backup missing")
print("✓ Supabase checks OK")

# ── 11. ISRAELI WEEK ─────────────────────────────────────────────────────
bad_dow = re.findall(r'new Date\([^)]*T12:00:00[^)]*\)\.getDay\(\)', jsx)
if bad_dow:
    fail(f"Unreliable getDay() pattern found: {bad_dow[0][:60]}")
if 'now.getDay()' in jsx:
    warn("now.getDay() found — may be wrong in Israel timezone")
print("✓ Israeli week check complete")

# ── 12. ISRAELI WEEK CONSISTENCY: all week calcs use same method ─────────
dow_patterns = re.findall(r'const dowIL[^;]+;', jsx)
print(f"✓ Found {len(dow_patterns)} dowIL calculations")

# ── 13. HEATMAP VARIABLE CONSISTENCY ─────────────────────────────────────
heatmap_start = jsx.find("function HeatmapGrid")
heatmap_end = jsx.find("\nfunction ", heatmap_start+1)
heatmap_body = jsx[heatmap_start:heatmap_end]
# If workoutMap stores objects, w.includes() is wrong — should be types.includes()
if "w.includes(" in heatmap_body:
    fail("HeatmapGrid uses w.includes() but w is now an array of objects — use types.includes()")
print("✓ Heatmap variable consistency OK")

# ── RESULTS ──────────────────────────────────────────────────────────────
print("\n" + "="*50)
if ERRORS:
    print(f"❌ DEPLOYMENT BLOCKED — {len(ERRORS)} error(s):")
    for e in ERRORS: print(f"   • {e}")
else:
    print("✅ ALL CHECKS PASSED — safe to deploy")
if WARNINGS:
    print(f"⚠ {len(WARNINGS)} warning(s):")
    for w in WARNINGS: print(f"   • {w}")
sys.exit(1 if ERRORS else 0)
