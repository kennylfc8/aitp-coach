# Custom Training Schedule 📅

## The Problem (Without Custom Schedule)

```
❌ Old way:
Bot: "Here's your 45-minute daily plan"
You: But I train:
     - 20 min morning (shadow swings)
     - 20 min evening (footwork)
     - 3x 2-hour sessions per week (court)
Bot: [Confused] Just gives generic 45 min plan...
```

## The Solution (With Custom Schedule)

```
✅ New way:
You: "Let me set my actual schedule"
/schedule_intermediate

Bot: 📅 YOUR TRAINING SCHEDULE:
     Morning - 20 min shadow-swings (daily, 7:00)
     Evening - 20 min footwork (daily, 19:00)
     Monday - 2h court session (technique)
     Wednesday - 2h court session (match sim)
     Saturday - 2h match play
     
     Total: 360 minutes/week

You: Get morning plan, evening plan, court plans
     Each SPECIFICALLY for that session!
```

---

## How It Works

### Step 1: Choose Template or Custom

```
/schedule         → View/manage your schedule
/schedule_casual  → 30 min/day (beginner)
/schedule_intermediate → 20 min + 20 min + 3x2h/week (YOUR EXAMPLE)
/schedule_serious → 3-4 hours/day (advanced)
/schedule_custom  → Build your own
```

### Step 2: Each Session Gets Smart Planning

**Morning Session Example:**
```
📅 Morning (7:00 AM)
Duration: 20 min
Focus: Shadow-swings
Location: Home

Plan Generated:
"20-minute shadow swing routine:
- 2 min warmup
- 10 min shadow swings (slow, controlled)
- 5 min fast shadow swings (game speed)
- 3 min cool-down stretching"
```

**Evening Session Example:**
```
📅 Evening (7:00 PM)
Duration: 20 min
Focus: Footwork
Location: Home

Plan Generated:
"20-minute footwork routine:
- 2 min dynamic warmup
- 8 min footwork patterns (split-step focus)
- 7 min movement drills
- 3 min stretching"
```

**Court Session Example:**
```
📅 Monday (6:00 PM)
Duration: 120 min
Focus: Forehand, Backhand, Serve
Location: Court
Type: Court session

Plan Generated:
"2-hour court technique session:
- 10 min general warmup
- 20 min forehand drills (basket feeding)
- 20 min backhand drills (your weak point!)
- 20 min serve practice (consistency focus)
- 15 min point play
- 5 min cool-down"
```

---

## Creating Your Schedule

### Option 1: Use Template

```
/schedule_intermediate
```

Pre-configured for:
- 20 min morning (shadow-swings, 7:00)
- 20 min evening (footwork, 19:00)
- Monday 6:00 PM → 2h technique
- Wednesday 6:00 PM → 2h match-sim
- Saturday 10:00 AM → 2h match play

**Total: 360 minutes/week = 6 hours**

### Option 2: Customize Template

```
/schedule_edit

Bot shows:
"Current schedule:
1. Morning - 20 min [EDIT]
2. Evening - 20 min [EDIT]
3. Monday court [EDIT]
4. Wednesday court [EDIT]
5. Saturday match [EDIT]

Add session? /add_session"
```

You can:
- Edit any session time/duration/focus
- Add new sessions
- Remove sessions
- Save as "my_schedule"

### Option 3: Build from Scratch

```
/schedule_custom

Bot: "Let's build your schedule!
What's your first session?
- Name: (e.g., 'Morning shadow-swings')
- When: (daily or specific day)
- Time: (HH:MM)
- Duration: (minutes)
- Focus: (what to work on)
- Location: (home/court/wall)
- Description: (what you do)"

You enter each session...
Bot saves → shows summary
```

---

## Per-Session Smart Planning

### How the Bot Knows What to Do

**Input:**
```
Session Details:
- Type: Morning solo
- Duration: 20 minutes
- Focus: Shadow-swings, footwork
- Location: Home
- Player level: Intermediate
- Player weaknesses: [backhand, split-step]
- Player strengths: [forehand, mental]
```

**Bot Thinks:**
```
"This is 20 minutes, solo, home training.
The player is intermediate with weak footwork.
I should:
- Skip long warmup (20 min is short)
- Focus HEAVILY on footwork (weakness)
- Include shadow-swings (focus area)
- Short cool-down only
- Make it doable in exactly 20 min"
```

**Output Plan:**
```
✓ 2 min dynamic warmup (legs active)
✓ 15 min footwork + shadow-swings
  (10 min slow controlled, 5 min game-speed)
✓ 3 min stretching
```

---

## Real-World Example: Complete Day

### Your Schedule Setup:
```
/schedule_intermediate

📅 YOUR SCHEDULE:
- Morning: 7:00 AM, 20 min, shadow-swings (daily)
- Evening: 7:00 PM, 20 min, footwork (daily)
- Monday: 6:00 PM, 120 min, court session (technique)
- Wednesday: 6:00 PM, 120 min, court session (match-sim)
- Saturday: 10:00 AM, 120 min, match play
```

### Your Day (Wednesday):

```
7:00 AM - MORNING SESSION
┌─────────────────────────────────────────────────────┐
│ 📱 BOT SENDS MORNING PLAN                            │
│                                                     │
│ 🎾 "Morning Session - 20 minutes"                   │
│                                                     │
│ Warmup (2 min):                                     │
│ - Light jogging in place                            │
│ - Arm circles                                       │
│                                                     │
│ Main (15 min):                                      │
│ - 10x slow shadow-swings (focus on footwork)        │
│ - 10x game-speed shadow-swings                      │
│ - 5x explosive split-steps                          │
│                                                     │
│ Cool-down (3 min):                                  │
│ - Hamstring stretches                               │
│ - Shoulder stretches                                │
│                                                     │
│ ♪ [Coach voice] "Let's go! 20 minutes, focus..."   │
└─────────────────────────────────────────────────────┘

You: [Trains for 20 min]

7:05 AM - CHECK-IN (optional)
Bot: "Did you complete morning session?"
You: 🎙️ "Yes, 20 min done, felt good"
Bot: "Great! See you tonight!"


7:00 PM - EVENING SESSION
┌─────────────────────────────────────────────────────┐
│ 📱 BOT SENDS EVENING PLAN                            │
│                                                     │
│ 🎾 "Evening Session - 20 minutes"                   │
│                                                     │
│ Warmup (2 min):                                     │
│ - Dynamic stretching                                │
│ - Light footwork                                    │
│                                                     │
│ Main (15 min):                                      │
│ - Footwork patterns (side-to-side)                 │
│ - Split-step + movement combinations                │
│ - Directional changes                               │
│                                                     │
│ Cool-down (3 min):                                  │
│ - Static stretching                                 │
│                                                     │
│ ♪ [Coach voice] "Evening footwork routine..."      │
└─────────────────────────────────────────────────────┘

You: [Trains for 20 min]

7:05 PM - EVENING CHECK-IN
Bot: "How was evening session?"
You: 🎙️ "Good, footwork more confident today"
Bot: "Excellent! Can see the improvement."
     "Streak: Day 5 🔥"


6:00 PM (Tomorrow WEDNESDAY - Court Session)
┌─────────────────────────────────────────────────────┐
│ 📱 BOT SENDS COURT PLAN (120 minutes)                │
│                                                     │
│ 🎾 "Court Session - Technique Focus (2 hours)"     │
│                                                     │
│ Warmup (10 min):                                    │
│ - General court warmup                              │
│ - Light hitting                                     │
│                                                     │
│ Focus 1 - FOREHAND (20 min):                        │
│ - Basket feeding: 50 balls, focus on consistency    │
│ - Depth and control, not speed                      │
│                                                     │
│ Focus 2 - BACKHAND (25 min):  [YOUR WEAKNESS]      │
│ - Basket feeding: 60 balls                          │
│ - Work on grip and follow-through                   │
│ - Slower pace, focus on technique                   │
│                                                     │
│ Focus 3 - SERVE (20 min):                           │
│ - 100 serves to the box                             │
│ - Track: 1st serve % (your weakness: 60%)           │
│ - Goal: increase consistency                        │
│                                                     │
│ Point Play (20 min):                                │
│ - Play points, apply technique                      │
│                                                     │
│ Cool-down (5 min):                                  │
│ - Stretching                                        │
│                                                     │
│ ♪ [Coach] "2-hour technique session..."             │
└─────────────────────────────────────────────────────┘

You: [Train for 120 min with coach]

After court:
Bot: "Evening check-in for court session"
You: 🎙️ "Played 2 hours, backhand still weak but serving was better"
Bot: "Good! I saw you working on serve consistency."
     "Let's focus backhand + serve next week."
     "Streak: Day 6 🔥"
```

---

## Customization Examples

### Example 1: Casual Player (You)
```
/schedule_casual

Morning: 30 min shadow-swings (7:00 AM daily)
Weekend: 60 min match play (Saturday 10:00 AM)

Total: 230 min/week (4 hours)
```

**Plan differs by session:**
- Morning = shadow-swing focused
- Weekend match = game-situation focused

### Example 2: Serious Player
```
/schedule_serious

Morning: 20 min warmup (6:30 AM)
Morning: 30 min strength (7:00 AM)
Afternoon: 150 min court (Mon 14:00)
Afternoon: 150 min court (Wed 17:00)
Afternoon: 180 min court (Fri 15:00)

Total: 730 min/week (12 hours)
```

**Plan differs significantly:**
- Strength focused on fitness
- Court sessions on technique vs match-play vs weak-points
- High intensity throughout

### Example 3: Build Your Own
```
/schedule_custom

Session 1: Morning 20 min shadow (7:00) daily
Session 2: Evening 20 min footwork (19:00) daily
Session 3: Monday 120 min court - technique (18:00)
Session 4: Wednesday 120 min court - match-sim (18:00)
Session 5: Saturday 120 min match play (10:00)

(Same as /schedule_intermediate)
```

---

## Commands

```
/schedule                 View current schedule
/schedule_casual          Quick template: 30 min/day
/schedule_intermediate    Template: 20+20 min daily + 3x court
/schedule_serious         Template: 3-4 hours/day
/schedule_custom          Build custom schedule
/schedule_edit            Edit sessions
/add_session              Add new training
/remove_session           Remove training
/plan_today              See today's specific plans
/plan_week               See week overview
```

---

## Benefits

✅ **Personalized** — Plans are for YOUR specific sessions
✅ **Efficient** — No wasted time on wrong exercises
✅ **Flexible** — Change schedule anytime
✅ **Smart** — Each session gets unique focus
✅ **Scalable** — Works for 20 min or 3-hour sessions
✅ **Adaptive** — Adjusts based on your weaknesses

---

## Integration with Assessment

The schedule works WITH your detailed assessment:

```
Assessment (Who you are):
- Level: Intermediate
- Weaknesses: [backhand, serve]
- Time available: 60 min/day

Custom Schedule (When/how you train):
- Morning 20 min shadow-swings (7:00)
- Evening 20 min footwork (19:00)
- 3x 120 min court sessions

Result:
- Morning plan = shadow-swings
- Evening plan = footwork + weakness focus
- Court plan = technical work on backhand + serve

Each session targets YOUR specific needs!
```

---

## Next Level: Weekly Progression

Not implemented yet, but planned:

```
Week 1: Focus on weak areas (backhand, serve)
Week 2: Add match-simulation (pressure training)
Week 3: Maintain + add intensity
Week 4: Test in matches

Each week's plans automatically adjust based on progress!
```
