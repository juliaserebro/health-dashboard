"""
Seed the demo_maya profile with ~30 days of coherent demo data.
Re-runnable: deletes existing demo rows first, then inserts fresh data
with dates relative to today, so the demo always looks current.

Requires these columns on profiles (run once in Supabase SQL editor):
  alter table profiles add column if not exists coach_content jsonb;
  alter table profiles add column if not exists coach_memory text;
  alter table profiles add column if not exists weekly_review text;
  alter table profiles add column if not exists weekly_review_generated_at timestamptz;
  alter table profiles add column if not exists weekly_review_dismissed boolean;
  alter table profiles add column if not exists detected_patterns jsonb;
  alter table profiles add column if not exists behavioral_baseline jsonb;
  alter table profiles add column if not exists triggered_milestones jsonb;
"""
import json, random, urllib.request, urllib.error
from datetime import date, datetime, timedelta, timezone

SUPA_URL = "https://itdrrugsztpqkafxfljt.supabase.co"
SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0ZHJydWdzenRwcWthZnhmbGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5OTkwMzUsImV4cCI6MjA5NjU3NTAzNX0.n2iIiMxb7Lf-8nbNk79Pzhnp0E6qRzfsW51CvipQjs8"
UID = "demo_maya"

random.seed(42)  # deterministic — re-runs produce the same demo

def supa(method, path, body=None):
    url = f"{SUPA_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        print(f"  ERROR {method} {path}: {e.code} {e.read().decode()[:200]}")
        return e.code

TODAY = date.today()
def dk(days_ago): return (TODAY - timedelta(days=days_ago)).isoformat()
def dow(days_ago): return (TODAY - timedelta(days=days_ago)).weekday()  # Mon=0 ... Sun=6

# ── GENERATE 32 DAYS OF FITNESS DATA ────────────────────────────────────────
BAD_NIGHT = 10                      # one visibly bad night ~10 days ago
LATE_MEAL_NIGHTS = {16, 12, 5}      # dinner after 21:00 -> weaker deep sleep next morning

sleep, steps, workouts = [], [], []
for i in range(32, -1, -1):
    d = dk(i)
    wd = dow(i)  # Mon=0 .. Sun=6

    # Sleep (record date = wake date)
    late_meal_prev = (i + 1) in LATE_MEAL_NIGHTS
    if i == BAD_NIGHT:
        total, bed = 330, "01:05"
    else:
        total = random.randint(400, 475)
        bh, bm = random.choice([(23, random.randint(0, 55)), (0, random.randint(0, 15))])
        bed = f"{bh:02d}:{bm:02d}"
    deep_pct = 0.13 if late_meal_prev else (0.15 if i == BAD_NIGHT else random.uniform(0.18, 0.22))
    deep = int(total * deep_pct)
    rem = int(total * random.uniform(0.20, 0.24))
    awake = random.randint(4, 18)
    rhr = 62 if i in (BAD_NIGHT, BAD_NIGHT - 1) else random.randint(56, 59)
    sleep.append({"date": d, "bedtime": bed, "total": total, "deep": deep,
                  "rem": rem, "light": total - deep - rem, "awake": awake, "rhr": rhr})

    # Steps — weekdays higher, clear Thursday dip (wd==3)
    if wd == 3:      st = random.randint(5800, 6500)
    elif wd >= 5:    st = random.randint(6500, 9000)
    else:            st = random.randint(8500, 13000)
    steps.append({"date": d, "steps": st})

    # Training ~5x/week: strength Sun/Wed/Fri, yoga Sat, run or walk Mon
    if wd in (6, 2, 4):   # Sun, Wed, Fri
        workouts.append({"date": d, "type": "strength training",
                         "duration_min": random.randint(45, 60), "avg_hr": random.randint(96, 112)})
    elif wd == 5:         # Sat
        workouts.append({"date": d, "type": "yoga",
                         "duration_min": 60, "avg_hr": random.randint(78, 88)})
    elif wd == 0:         # Mon
        t = random.choice(["run", "walk"])
        workouts.append({"date": d, "type": t,
                         "duration_min": random.randint(30, 50),
                         "avg_hr": random.randint(120, 138) if t == "run" else random.randint(95, 105)})

# ── FOOD: 3-4 meals/day, eggs most mornings, protein 90-115g ────────────────
BREAKFASTS = [
    ("Scrambled eggs with toast", "3 eggs, 2 slices sourdough, butter", 22, 32, 21, 405),
    ("Eggs and avocado toast", "2 fried eggs, half avocado, sourdough slice", 16, 26, 24, 385),
    ("Veggie omelette", "3-egg omelette with peppers, onion, feta", 24, 8, 22, 330),
    ("Greek yogurt bowl", "200g Greek yogurt 5%, granola, blueberries, honey", 21, 38, 9, 315),
]
LUNCHES = [
    ("Chicken quinoa bowl", "150g grilled chicken breast, quinoa, roasted vegetables, tahini", 42, 45, 16, 500),
    ("Tuna salad and pita", "Tuna can, chickpeas, greens, olive oil, whole wheat pita", 34, 40, 18, 460),
    ("Salmon with rice", "150g baked salmon, jasmine rice, steamed broccoli", 36, 48, 17, 490),
    ("Lentil soup and halloumi toast", "Bowl of lentil soup, grilled halloumi on sourdough", 27, 46, 19, 470),
]
DINNERS = [
    ("Beef stir-fry", "120g lean beef, mixed vegetables, soba noodles", 33, 42, 15, 440),
    ("Chicken shawarma plate", "Chicken thigh shawarma, hummus, Israeli salad, half pita", 38, 35, 22, 500),
    ("Tofu curry with rice", "Firm tofu, coconut curry, basmati rice", 24, 50, 19, 480),
    ("Shakshuka with bread", "2-egg shakshuka, tomato-pepper sauce, sourdough", 19, 34, 17, 370),
]
SNACKS = [
    ("Protein shake", "Whey protein with milk", 28, 9, 4, 200),
    ("Cottage cheese and crackers", "150g cottage 5%, rice crackers", 17, 15, 6, 190),
    ("Apple with peanut butter", "1 apple, 2 tbsp peanut butter", 7, 28, 16, 275),
]
LATE_DINNER = ("Late pasta dinner", "Penne with chicken and cream sauce, eaten late after work", 32, 62, 21, 585)

food_rows = []
for i in range(30, -1, -1):
    d = dk(i)
    b = random.choice(BREAKFASTS if random.random() < 0.75 else BREAKFASTS[3:])
    l = random.choice(LUNCHES)
    late = i in LATE_MEAL_NIGHTS
    dn = LATE_DINNER if late else random.choice(DINNERS)
    meals = [("08:10", b), ("13:15", l), (("21:35" if late else "19:20"), dn)]
    if random.random() < 0.6:
        meals.insert(2, ("16:30", random.choice(SNACKS)))
    for t, (n, det, p, c, f, k) in meals:
        food_rows.append({"user_id": UID, "log_date": d, "meal_time": t, "eaten_time": t,
                          "name": n, "detail": det, "protein": p, "carbs": c, "fat": f, "kcal": k})

# ── COMPUTED STATS (so coach content quotes real numbers) ────────────────────
late_deep = [s["deep"] for s in sleep if any(dk(n) == s["date"] for n in [x - 1 for x in LATE_MEAL_NIGHTS])]
norm_deep = [s["deep"] for s in sleep if s["deep"] / s["total"] >= 0.18]
avg_late_deep = round(sum(late_deep) / len(late_deep)) if late_deep else 55
avg_norm_deep = round(sum(norm_deep) / len(norm_deep)) if norm_deep else 85
thu_steps = [s["steps"] for s in steps if dow((TODAY - date.fromisoformat(s["date"])).days) == 3]
avg_thu = round(sum(thu_steps) / len(thu_steps))
other_steps = [s["steps"] for s in steps if dow((TODAY - date.fromisoformat(s["date"])).days) != 3]
avg_other = round(sum(other_steps) / len(other_steps))

# This week (Sun-Sat) numbers for the weekly review
days_since_sunday = (TODAY.weekday() + 1) % 7
week_keys = {dk(n) for n in range(days_since_sunday + 1)}
wk_workouts = [w for w in workouts if w["date"] in week_keys]
wk_sleep = [s for s in sleep if s["date"] in week_keys]
wk_avg_sleep = round(sum(s["total"] for s in wk_sleep) / max(1, len(wk_sleep)))
protein_by_day = {}
for r in food_rows:
    protein_by_day[r["log_date"]] = protein_by_day.get(r["log_date"], 0) + r["protein"]
wk_prot_days = sum(1 for k in week_keys if protein_by_day.get(k, 0) >= 99)

now_iso = datetime.now(timezone.utc).isoformat()

coach_content = {
    "overall_signal": "steady",
    "headline": f"Solid night — {sleep[-1]['total']//60}h{sleep[-1]['total']%60:02d} with {sleep[-1]['deep']} minutes of deep sleep, and you're mid-follicular, which is typically when your energy and strength peak. Today is a good day to push your strength session.",
    "why": f"Your readiness is built on three things today: last night's sleep hit your 7h+ baseline, your resting heart rate ({sleep[-1]['rhr']} bpm) is right on your 30-day norm, and follicular-phase physiology favours strength output. Your training load is on target — {len(wk_workouts)} sessions so far this week against a 5-session plan.",
    "domain_insights": [
        {"type": "sleep_quality",
         "content": f"We've noticed a pattern worth flagging: on the three nights this month when your last meal was after 9pm, your deep sleep averaged {avg_late_deep} minutes versus your usual {avg_norm_deep}. It might be worth an earlier dinner cutoff on training nights — in some people, late eating measurably compresses deep sleep.",
         "claim": "late meals correlate with less deep sleep"},
        {"type": "step_pattern",
         "content": f"Thursdays are consistently your quietest day — averaging {avg_thu:,} steps versus {avg_other:,} on other days. If that's how your week flows, no problem; a 15-minute lunch walk on Thursdays would close most of the gap.",
         "claim": "Thursday step dip"},
        {"type": "milestone",
         "content": "First full week hitting all three training categories — 3 strength, 1 yoga, 1 run. This is exactly the balanced week your plan is built around.",
         "claim": "first full balanced week"},
    ],
    "nothing_new": False,
    "micro_workout": None,
    "_generatedAt": now_iso,
    "_foodHash": "",
}

weekly_review = (
    f"Here's your week. You trained {len(wk_workouts)} times and your sleep averaged "
    f"{wk_avg_sleep//60}h{wk_avg_sleep%60:02d} — right around your baseline, and you hit your protein "
    f"target {wk_prot_days} days. The pattern that stood out: your strongest strength sessions came the "
    f"morning after your earliest dinners, which fits the late-meal/deep-sleep connection we've been watching. "
    f"The harder part of the week was Thursday — steps dipped again and no session landed, which is now a "
    f"three-week pattern rather than a coincidence. For next week, one focus: protect Thursday with something "
    f"small and scheduled — even a 20-minute walk — and keep dinners before 9pm on the nights before strength "
    f"days. Everything else is working; don't change it."
)

coach_memory = (
    "After five weeks together, here's what I know about you: you're most consistent when the plan respects "
    "your rhythm — three strength sessions anchor your week and you almost never miss them. Your deep sleep "
    "is your most sensitive metric: late dinners compress it, early ones protect it, and your best training "
    "days follow the early-dinner nights almost without exception. Thursdays are your natural low point, and "
    "we're working with that rather than against it. You hit your protein target more often than you think "
    "you do, and your follicular weeks are visibly stronger in the gym — worth planning your heavier "
    "sessions around."
)

profile = {
    "uid": UID, "name": "Maya", "gender": "female",
    "birth_date": f"{TODAY.year - 34}-03-14",
    "goals": [
        {"label": "Build strength", "definition": "3 progressive strength sessions per week"},
        {"label": "Sleep better", "definition": "7h+ average with consistent bedtime"},
        {"label": "Improve body composition", "definition": "protein-forward eating, 110g/day"},
    ],
    "activity_targets": {"strength": 3, "mobility": 1, "cardio": 1},
    "activity_mapping": {"workout": "strength"},
    "protein_target": 110, "step_target": 8000, "active_days_target": 20,
    "height_cm": 168, "weight_kg": 61.5,
    "supplements": [
        {"name": "Creatine", "dose": "5g", "timing": "morning"},
        {"name": "Magnesium Bisglycinate", "dose": "400mg", "timing": "evening"},
        {"name": "Omega-3", "dose": "1000mg", "timing": "with lunch"},
        {"name": "Vitamin D3+K2", "dose": "2000IU", "timing": "morning"},
    ],
    "health_notes": "Mild knee sensitivity - avoiding deep loaded lunges",
    "cycle_tracking": True, "timezone": "Asia/Jerusalem",
    "fitbit_connected": True, "onboarding_complete": True,
    "behavioral_baseline": {
        "typical_sleep_hours": 7.3, "typical_bedtime": "23:00",
        "avg_deep_sleep_pct": 19, "avg_resting_hr": 58, "established_at": now_iso,
    },
    "detected_patterns": [
        {"id": "late_meal_deep_sleep", "description": f"Deep sleep averages {avg_late_deep}min after 9pm+ dinners vs {avg_norm_deep}min normally", "occurrences": 3, "confidence": "moderate", "suggestion": "Earlier dinner cutoff on training nights"},
        {"id": "consistent_skip_day", "description": "Thursdays are consistently rest days with a step dip", "occurrences": 4, "confidence": "moderate", "suggestion": None},
        {"id": "bedtime_consistency", "description": "Bedtime within a 75-minute window on 90% of nights - strong consistency", "occurrences": 27, "confidence": "high", "suggestion": None},
    ],
    "triggered_milestones": ["seven_day_food_streak"],
    "coach_content": coach_content,
    "coach_memory": coach_memory,
    "weekly_review": weekly_review,
    "weekly_review_generated_at": now_iso,
    "weekly_review_dismissed": False,
}

cycle_log = {
    "uid": UID,
    "period_start_dates": [dk(8), dk(36), dk(64)],  # day 9 today = mid-follicular
    "avg_cycle_length": 28, "avg_period_length": 5, "last_period_start": dk(8),
}

journal = [
    {"user_id": UID, "tag": "training", "txt": "Felt strong in today's session - added 2.5kg on squats", "created_at": dk(2) + "T18:40:00+03:00"},
    {"user_id": UID, "tag": "energy", "txt": "Low energy afternoon, big lunch maybe", "created_at": dk(4) + "T15:20:00+03:00"},
    {"user_id": UID, "tag": "training", "txt": "Skipped workout - long workday", "created_at": dk(7) + "T21:00:00+03:00"},
    {"user_id": UID, "tag": "sleep", "txt": "Terrible night, neighbours renovating from 7am", "created_at": dk(BAD_NIGHT) + "T09:10:00+03:00"},
    {"user_id": UID, "tag": "energy", "txt": "Great morning energy after early dinner last night", "created_at": dk(14) + "T08:30:00+03:00"},
    {"user_id": UID, "tag": "training", "txt": "Yoga felt amazing, hips finally opening up", "created_at": dk(9) + "T19:15:00+03:00"},
]

# ── WRITE EVERYTHING ─────────────────────────────────────────────────────────
print(f"Seeding demo_maya (dates relative to {TODAY})...")

print("- profiles")
supa("POST", "profiles?on_conflict=uid", profile)

print("- fitness_cache")
supa("POST", "fitness_cache?on_conflict=user_id", {
    "user_id": UID,
    "data": {"sleep": sorted(sleep, key=lambda s: s["date"], reverse=True),
             "naps": [], "steps": steps, "workouts": sorted(workouts, key=lambda w: w["date"], reverse=True),
             "synced_at": now_iso},
    "synced_at": now_iso,
})

print("- cycle_logs")
supa("POST", "cycle_logs?on_conflict=uid", cycle_log)

print(f"- food_log ({len(food_rows)} rows; deleting old demo rows first)")
supa("DELETE", f"food_log?user_id=eq.{UID}")
for chunk_start in range(0, len(food_rows), 50):
    supa("POST", "food_log", food_rows[chunk_start:chunk_start + 50])

print("- journal_entries")
supa("DELETE", f"journal_entries?user_id=eq.{UID}")
supa("POST", "journal_entries", journal)

print("- supplement_log (today)")
supa("POST", "supplement_log?on_conflict=user_id,log_date,supplement",
     [{"user_id": UID, "log_date": TODAY.isoformat(), "supplement": "Creatine", "taken": True},
      {"user_id": UID, "log_date": TODAY.isoformat(), "supplement": "Vitamin D3+K2", "taken": True}])

print("Done. Open the app with no ?u= parameter to see the demo.")
