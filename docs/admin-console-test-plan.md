# Jooma Admin Console — Manual Test Plan

Covers every sidebar item. Written against the **Jooma staging** Supabase
project (`tkvzsqtgsesodifcakko`).

Some of this is now automated and worth running first, since it is faster and
catches the things that would be security or accounting bugs:

```bash
node scripts/verify-colleagues.mjs     # colleague sharing and RLS
node scripts/verify-ambassadors.mjs    # ambassador attribution and payouts
pnpm test:e2e                          # the browser suite
```

Every test has a **Do**, an **Expect**, and where relevant a **Why it matters** —
because several of these check that the console *refuses* to do something, and
those are easy to skim past as "nothing happened".

---

## Before you start

### Environment

```bash
pnpm dev          # http://localhost:3000
```

Sign in as an admin. Any of these four work:

| Email | Notes |
|---|---|
| `kitkitporcil2@gmail.com` | 58 generations this month — best for testing usage views |
| `admin@jooma.ai` | On the Pro plan |
| `info@jooma.ai` | 2 generations |
| `info@workwhale.ph` | The original seeded admin |

Go to `/admin`. If you land on `/tools` instead, your account doesn't have
`profiles.is_admin = true`.

### The most important thing to know

**Staging starts with no schools, no tickets, no invoices, no flags and no
audit entries.** Empty pages are the *correct* result at first, not a bug.

The plan is ordered so that **Part 2 creates the data Parts 3–7 need.** Run it
in order the first time.

### Test data naming

Prefix everything you create with **`ZZ`** — `ZZ Test Primary`, `ZZTESTCODE`.
It sorts to the bottom and makes cleanup unambiguous. Cleanup SQL is in
Appendix A.

### A note on the Supabase SQL editor

A few tests seed or clean up data there. Be aware it connects as the table
**owner**, which **bypasses row-level security**. That's convenient for setup
and cleanup, but it means the SQL editor is *not* a valid way to test whether a
permission rule works — it will happily do things the app itself is refused.

Where a test checks an actual restriction (7B.3), it uses
`set local role authenticated` to drop to the role the app uses. Don't remove
that line.

### Two known-empty areas

These are built but not fed by anything yet. Empty is expected:

- **Safeguarding flags** — no content filter writes to them ([#28](https://github.com/work-whale/jooma/issues/28))
- **Announcements** — no teacher-facing banner renders them ([#25](https://github.com/work-whale/jooma/issues/25))

---

## Part 0 — Access control

Do these first. If access control is broken, nothing else matters.

### 0.1 Non-admins are refused

**Do:** Sign out. Sign in as `dev@jooma.ai` or `kitkitporcil3@gmail.com`
(neither is an admin). Navigate to `/admin`.

**Expect:** Redirected to `/tools`. No flash of admin content.

### 0.2 Signed-out users are refused

**Do:** Sign out entirely. Visit `/admin/users` directly.

**Expect:** Redirected to `/login`.

### 0.3 The database refuses too, not just the UI

**Why it matters:** the redirect is a convenience. The real boundary is in
Postgres. If this test fails, hiding the UI is worthless.

**Do:** Signed out, in a terminal:

```bash
curl -s -X POST \
  "https://tkvzsqtgsesodifcakko.supabase.co/rest/v1/rpc/admin_users" \
  -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local>" \
  -H "Content-Type: application/json" -d '{}'
```

**Expect:** An error — not a list of teachers. Either `permission denied` (the
anon role has no EXECUTE grant) or `not authorized` (the in-function guard).
Both are correct.

### 0.4 Every page reloads cleanly

**Do:** Visit each of the 20 sidebar links, then hard-refresh (Ctrl+Shift+R) on
each.

**Expect:** No page 500s. Briefly you should see a grey skeleton, then content.

---

## Part 1 — Overview (Dashboard)

`/admin`

### 1.1 Stat tiles

**Do:** Read the tiles.

**Expect:** Teachers · Paying · MRR · Gross margin · AI cost · Generations ·
Seats · Open tickets. Figures move as you work through this plan; that's the
point, so treat the numbers here as shape rather than exact values.

**MRR is not a single figure any more,** and reading it as one is the mistake
this test exists to prevent. Three separate tiles:

| Tile | Means |
|---|---|
| **MRR** | Teachers genuinely being billed, plus school seats |
| **Comped** | On a paid plan with **no Stripe subscription** — an admin granted it, and nobody is paying |
| **Ending** | Paying now, cancelled, gone next month |

**Also check the footnote under MRR.** It reads either "Actually billed" (the
total came live from Stripe, so discounts are reflected) or "List price, Stripe
unavailable" (it fell back to `plan_config` prices). Those are different numbers
and the page says which one you are looking at.

**Why it matters:** the old figure was `count(plan <> 'free') x price`, which
counted comps, counted people who had already cancelled, and ignored discounts.
On production two live subscribers listed at £7.99 were being billed £0.08 and
£0.80. A "paying teachers" count that disagrees with the money is expected when
one teacher holds two subscriptions; it is a count of teachers, not of
subscriptions.

### 1.2 "Needs you today"

**Do:** Read the right-hand panel.

**Expect (before Part 2):** "Nothing needs attention."

**Expect (after Part 2):** Rows appear — an idle school, an overdue invoice, a
high-priority ticket. Each has a working **Open →** link.

### 1.3 Signups chart

**Expect:** Six monthly bars with counts beneath. The footer states that signup
source isn't recorded — that's honest, not a gap in the test.

### 1.4 Margin panel

**Expect:** "What's eating the margin" shows AI-generated images, Audio and Text
generation with share bars summing to 100%.

---

## Part 2 — People

### 2A · Teachers (`/admin/users`)

#### 2A.1 The list

**Expect:** 10 teachers. Four carry a black **ADMIN** badge.

#### 2A.2 Admin bypass indicator

**Why it matters:** admins skip the generation cap. Without this, an admin's 58
generations reads as a free teacher blowing through a 5-generation limit.

**Do:** Find `kitkitporcil2@gmail.com`. Look at Resources.

**Expect:** "58 used · no cap" — **not** a meter showing "0 left of 5". Hover
the ADMIN badge for a tooltip explaining the bypass.

#### 2A.3 Filters

**Do:** Try each: search "kitkit", plan = Free, status, margin = "Losing money".
Then **Clear**.

**Expect:** Row count updates each time; Clear restores all 10.

#### 2A.4 Teacher drawer

**Do:** Click any row.

**Expect:** Drawer slides in from the right (~220ms). Shows This month,
Account, Subscription, Recent activity, Support history, Internal notes.
**Escape closes it.**

#### 2A.5 Grant resources — a real write

**Do:** In the drawer, **Grant resources** → 100 → reason → **Grant**.

**Expect:**
- The modal shows a live cost estimate before you confirm (~£0.86 for 100)
- Toast confirms
- The meter updates **without reopening the drawer**
- Reopen → the top-up is reflected

**Then:** Go to `/admin/audit`. A "Granted 100 resources" entry is there with
your email.

#### 2A.6 Grant AI images

**Do:** Same, but **Grant AI images** → 10.

**Expect:** The estimate is dramatically higher (~£2.84 vs £0.86) — AI images
cost ~33× a text resource, and the modal makes that visible at the moment of
granting.

#### 2A.7 Grant limits

**Do:** Try to grant **600** AI images.

**Expect:** Refused — "AI-image grants are capped at 500". A fat-fingered 1000
would be ~£280 of cost.

---

### 2B · Schools (`/admin/schools`)

#### 2B.1 Empty state

**Expect (first run):** "No schools yet" with an **Onboard a school** button —
not a blank table.

#### 2B.2 Seat price ladder

**Expect:** Four bands: 10–19 £4.25 · 20–49 £3.50 · 50–99 £2.95 · 100+ £2.50.
The 14-seat example reads **£714/year**.

---

### 2C · Onboard a school (`/admin/onboard`)

#### 2C.1 Walk the wizard

**Do:** Six steps. Use **`ZZ Test Primary`**, URN `999999`, Leeds, Primary,
**14 seats**.

**Expect at step 2:** A live price preview — "14 seats × £4.25 = £59.50 a
month", £714 a year, and a green note that it's under £1,000 so most heads can
approve it without governors.

#### 2C.2 Band crossing

**Do:** Still at step 2, change seats to **20**.

**Expect:** Rate drops to £3.50 and a warning appears that this re-prices
**every** seat, not just the new ones. Set it back to 14.

#### 2C.3 Minimum seats

**Do:** Enter **5** seats.

**Expect:** "Minimum is 10 seats." Set back to 14.

#### 2C.4 URL state

**Why it matters:** wizard state in the URL means back/forward and refresh work.

**Do:** At step 3, press browser **Back**.

**Expect:** Returns to step 2, not out of the wizard. URL shows `?step=2`.

#### 2C.5 Create it

**Do:** Complete all six steps. At step 5 add two emails:
`zz.teacher1@test.sch.uk`, `zz.teacher2@test.sch.uk`. Then **Create school**.

**Expect:** Redirected to `/admin/schools` with `ZZ Test Primary` listed —
14 seats, £4.25 band, status **Not started**.

#### 2C.6 Seat pool visualisation

**Do:** Open the school.

**Expect:** 14 small squares — 2 dashed (invited), 12 grey (free). Counts read
Bought 14 · Assigned 0 · Invited 2 · Free 12.

#### 2C.7 The shrink guard

**Why it matters:** without it, shrinking a school silently orphans teachers.

**Do:** **Change seat count** → **10** → Save. (10 ≥ 2 occupied, so this is
allowed.) Then try to invite 9 more teachers, then shrink to **10** again.

**Expect:** Once more than 10 seats are occupied, the shrink is refused:
"cannot drop to 10 seats: N seat(s) are assigned or invited. Reclaim seats
first."

#### 2C.8 Invite handling

**Do:** **Invite teachers** → paste:

```
zz.teacher1@test.sch.uk
not-an-email
zz.teacher3@test.sch.uk
```

**Expect:** Reports fewer invited than pasted — the duplicate and the malformed
address are skipped rather than failing the whole batch.

#### 2C.9 Onboarding checklist

**Do:** Tick "Contract and DPA signed".

**Expect:** Strikethrough; the school's "% set up" rises. An audit entry appears.

---

## Part 3 — Money

### 3A · Plans & pricing (`/admin/plans`)

#### 3A.1 Four plan cards

**Expect:** Free £0 · Pro £7.99 · Max £14.99 · School £4.25/seat. Each shows
resources, AI slideshows, users on plan, and **worst-case contribution**.

#### 3A.2 Worst-case margin

**Why it matters:** this is the number that decides whether a plan is viable.

**Expect:** Pro shows a lower worst-case contribution than its £7.99 price,
because 12 AI slideshows at ~28p each is most of the plan's value.

#### 3A.3 Edit a plan

**Do:** Edit Pro → change the description → Save.

**Expect:** Saves; audit entry appears. The modal states plainly that this does
**not** touch Stripe — Price objects are immutable.

#### 3A.4 Pricing rules

**Do:** Toggle "Show annual as the default option" off, then on.

**Expect:** Both changes persist through a refresh and appear in the audit log.

---

### 3B · Payments & invoices (`/admin/revenue`)

#### 3B.1 Empty state

**Expect (first run):** "No invoices yet", explaining card charges arrive from
Stripe automatically and school invoices are raised manually.

#### 3B.2 Raise an invoice

**Do:** **Raise invoice** → `ZZ Test Primary` → leave amount blank → Create.

**Expect:** A draft with reference `INV-2026-0001`, amount defaulted to a full
year at the banded rate.

#### 3B.3 Overdue is derived

**Do:** In Supabase SQL editor:

```sql
update invoices set status = 'sent', due_at = current_date - 15
where reference like 'INV-2026-%';
```

Refresh the page.

**Expect:** Status now reads **Overdue** — derived from the due date, no nightly
job needed. It also appears in the "act on these" panel at the top, and on the
dashboard's "Needs you today".

#### 3B.4 Mark paid

**Do:** Click **Mark paid**.

**Expect:** Status → Paid; "Collected this month" rises; audit entry appears.

#### 3B.5 Stripe webhook (optional, needs Stripe CLI)

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger invoice.payment_failed
```

**Expect:** A card-type invoice appears with status **failed**. Triggering the
same event twice must produce **one row, not two** — the upsert is keyed on the
Stripe invoice ID.

---

### 3C · Top-ups (`/admin/topups`)

#### 3C.1 Four packs with real margin

**Expect:** 100 resources £3.99 · 300 £8.99 · 10 AI images £2.99 · 25 £5.99.

Margin on **resource** packs is high (~80%+); on **AI-image** packs it's much
thinner. That's deliberate and the footer says so — they exist to stop heavy
users going underwater, not to make money.

#### 3C.2 Edit a pack

**Do:** Edit "10 AI-image slideshows" → price £3.49 → Save.

**Expect:** Live margin recalculation in the modal before saving. Set it back
to £2.99.

---

### 3D · Promo codes (`/admin/promos`)

#### 3D.1 Live from Stripe

**Why it matters:** Stripe validates codes at checkout. A code that existed only
in our database would be rejected the moment a teacher typed it, so this page
reads and writes Stripe directly and keeps no second copy.

**Expect:** Either an empty state ("No promotion codes in Stripe") or a list of
**real** Stripe codes, with a **+ New code** button top right.

#### 3D.2 Create a code from the console

**Do:** Press **+ New code**. Create `ZZTESTPROMO`, 50% off, applying for 3
months, and put `Test campaign` in "Where it's used". Create it.

**Expect:** The code appears in the table with the offer reading "50% off 3
months", the channel showing "Test campaign", and 0 redemptions. It is also
visible in the Stripe dashboard, because that is where it was actually created.

**Why it matters:** a code's discount is immutable in Stripe. There is
deliberately no edit control — changing an offer means a new code — so the only
things you can do to an existing one are activate and deactivate it.

#### 3D.3 A code created in Stripe also appears

**Do:** In the Stripe dashboard, create a coupon and a promotion code
`ZZSTRIPESIDE`. Refresh the page.

**Expect:** It appears. Neither side is the "real" one; there is only Stripe.

**Cleanup:** Deactivate both in Stripe. (Stripe can't delete promotion codes,
only deactivate — several inert `ZZ*` codes from earlier testing may already be
there.)

---

### 3E · Ambassadors (`/admin/ambassadors`)

Affiliate tracking on top of promo codes: who brought a teacher in, and who is
owed for it. An ambassador's code **is** an ordinary Stripe promotion code, so
everything in 3D still applies to it.

**The rule this page exists to enforce:** a referral is payable only once money
has actually arrived. Free redemptions are tracked and never payable, and neither
are admin comps. Several tests below check exactly that, and they are the ones
that matter — the rest is presentation.

#### 3E.1 Empty to start

**Expect:** "No ambassadors yet", four stat tiles all reading 0, and a
**+ New ambassador** button.

#### 3E.2 Add an ambassador and their code

**Do:** Press **+ New ambassador**. Full name `ZZ Test Ambassador`, email
`zz-ambassador@example.com`, code `ZZAMBTEST`, 20% off. Leave the redemption
limit and expiry **blank**. Create.

**Expect:** The row appears, showing the code and "20% off" read live from
Stripe. Referred, Subscribed, Owed and Paid all read 0.

**Then:** open `/admin/promos`. `ZZAMBTEST` is listed there too, tagged
`Ambassador: ZZ Test Ambassador` in "Where it's used".

**Why it matters:** the code is a normal promotion code created through the same
Stripe path as any other. If it did not appear on the promos page, there would be
two systems creating codes and one of them would eventually be wrong.

**Why blank limits:** a redemption cap or an expiry can refuse the code for
somebody who signed up months ago and only subscribes now. See 3E.7.

#### 3E.3 A free signup is tracked but not payable

**Do:** In a private window, sign up as a new teacher using
`/signup?code=ZZAMBTEST`. Carry on to the welcome screen, confirm the code shows
as applied, and choose **Free**. Back in the admin console, refresh
`/admin/ambassadors` and click the ambassador's row to expand it.

**Expect:** The teacher is listed with their join date, "Not subscribed" as the
first subscribed month, plan **Free**, and payout **N/A**. There is **no button**
on that row.

**Why it matters:** this is the whole shape of the feature in one row. Free
redemptions are tracked, because they convert later, and they are never payable.

#### 3E.4 A subscriber becomes owed, and can be settled

**Do:** As that teacher, subscribe to Pro (Stripe **test mode**, card
`4242 4242 4242 4242`). Make sure the webhook is reaching you —
`stripe listen --forward-to localhost:3000/api/stripe/webhook`. Refresh the
admin page and expand the row again.

**Expect:** Plan reads **Pro**, the first subscribed month is this month, and the
payout has moved to **Unpaid** with a **Mark paid** button. The ambassador's
Subscribed and Owed counts are both 1.

**Then:** press **Mark paid**. It becomes **Paid** with today's date, and
survives a reload. The audit log records it.

**Why it matters:** the payout appears only after Stripe confirms the payment,
not when the subscription is created. A card that fails must not create a debt.

#### 3E.5 A comped teacher is never payable

**Do:** Refer a second teacher on the same code who stays on Free, then use
`/admin/users` to change their plan to Pro by hand.

**Expect:** Their row now reads plan **Pro** but payout stays **N/A** with no
button, and the ambassador's Subscribed count does **not** go up.

**Why it matters:** a comp sets `plan` and `subscription_status` exactly like a
real subscriber, and no money changed hands. `stripe_subscription_id IS NULL` is
the honest discriminator, the same one `teacher_mrr()` uses for MRR.

#### 3E.6 A second code never moves attribution

**Do:** Add a second ambassador with code `ZZAMBTWO`. As the teacher from 3E.3,
go to `/pricing` and try to apply it.

**Expect:** Refused with "You have already used a code on this account", and the
teacher stays under the first ambassador.

**Why it matters:** attribution is first-code-wins and permanent. If it could
move, two ambassadors could be owed for the same teacher.

#### 3E.7 The delayed subscriber

**Do:** Refer a new teacher who chooses **Free**. Then, in Stripe, **deactivate**
`ZZAMBTEST`. Now sign in as that teacher and subscribe to Pro.

**Expect:** Checkout still opens and the subscription still completes — at full
price, with Stripe's own code box shown. The referral survives, the ambassador is
still credited when the payment lands, and the expanded row notes that the code
was refused at checkout.

**Why it matters:** most conversions do not happen on signup day. A stale code
must never block a payment, and the ambassador should not lose a referral they
genuinely made because a code lapsed in the meantime.

**Also try** the ordinary case: a teacher who claimed a still-valid code and
subscribes days later gets the discount applied automatically, with nothing
retyped and no code box on the Stripe page.

#### 3E.8 Automated coverage

Most of the above is also checked automatically, and these are faster than
walking the page:

```bash
node scripts/verify-ambassadors.mjs   # RLS, the RPC guards, the payout rule
pnpm test:e2e ambassadors             # the admin table and the payout controls
pnpm test:e2e ambassador-claim        # claiming, including the delayed subscriber
```

The first is the one to run before shipping any change here: everything it checks
would be a security or an accounting bug rather than a broken screen.

---

## Part 4 — Product

### 4A · Usage & margins (`/admin/usage`)

#### 4A.1 Layout

**Expect, top to bottom:** four stats → AI-image callout → two-column grid
("Where the money goes" beside "Thinnest margins") → Model routing → Fair use →
"Every tool" detail table.

#### 4A.2 Headline figures

**Expect:** AI spend ~£1.11 · image share ~17% · cost per active teacher ~£0.55
· gross margin ~86%.

"Cost per active teacher" divides by teachers who **generated something**
(2), not all 10 signups.

#### 4A.3 Thinnest margins excludes admins

**Why it matters:** before this was fixed, both rows here were admin accounts
and the panel reported "2 accounts losing money" — flagging internal testing as
a business problem.

**Expect:** Admin rows show a **bypass** tag and margin reads **internal**, not
a red percentage. The "losing money" count excludes them.

#### 4A.4 Model routing

**Expect:** Real models — `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4o-mini` — with
per-model cost. `gpt-4o-mini` is tagged green as the cheap one.

#### 4A.5 Fair use toggles

**Do:** Change "Rate limit" from 40 to 50, click away.

**Expect:** Saves, audit entry. The footer notes these aren't enforced yet
([#26](https://github.com/work-whale/jooma/issues/26)).

#### 4A.6 Tool detail table

**Do:** Expand a slideshow row.

**Expect:** Step breakdown children. Columns include 10× and 100× projections.

---

### 4B · Tools (`/admin/tools`)

#### 4B.1 The list

**Expect:** 36 tools, ~26 with real usage. Sorted by cost.

#### 4B.2 The unlisted tool

**Do:** Filter → "Not listed to teachers".

**Expect:** `lesson-slideshow` appears, tagged **not listed**, with a callout
explaining the route exists and can record cost but doesn't appear in the
teacher grid. This is a real, known drift — [#20](https://github.com/work-whale/jooma/issues/20).

#### 4B.3 Toggle a tool off

**Do:** Toggle any tool off, then back on.

**Expect:** Both changes persist and appear in the audit log.

#### 4B.4 Plan gating

**Do:** Click a tool name → untick **free** → Save.

**Expect:** The Plans column updates. Unticking *every* plan shows a red warning
that the tool becomes unreachable. **Restore all four plans afterwards.**

---

### 4C · Safeguarding flags (`/admin/flags`)

#### 4C.1 Empty is expected

**Expect:** "Nothing flagged", explicitly stating that no filter writes to this
table yet — an empty safeguarding page is only reassuring if something is
actually looking.

#### 4C.2 Review flow (needs a seeded row)

**Do:** In Supabase SQL editor:

```sql
insert into safeguarding_flags (user_id, tool_slug, reason, excerpt, severity, status)
values ((select id from profiles limit 1), 'quiz-generator',
        'ZZ TEST — historical violence, WWII topic',
        'Sample excerpt for testing', 'medium', 'review');
```

Refresh, click the row, add a note, click **Clear — false positive**.

**Expect:** Status → Cleared; "Awaiting review" drops to 0; audit entry appears.

---

### 4D · Presentations (`/admin/presentations`)

**Expect:** Recent decks with owner email, title, slide count, date. 57 exist.

---

## Part 5 — Support

### 5A · Inbox (`/admin/inbox`)

#### 5A.1 Empty state

**Expect:** Three-pane layout; left pane says tickets appear when a teacher gets
in touch.

#### 5A.2 Create a ticket — as a teacher, not by hand

This step used to be a raw `admin_create_thread` call in the SQL editor, because
until teachers had `/help` there was genuinely no other way to get a ticket into
the inbox.

**Do:** Sign in as a **non-admin** teacher in another browser profile. Click
**Help** in the sidebar (or the bubble bottom-right) → **New conversation** →
subject and message → **Send**.

Then open `/admin/inbox` as an admin.

**Expect:**
- The ticket is there, unread, with reference `TK-####`.
- Sidebar **Inbox** carries a badge.
- Priority is **high** for a `pro`/`max`/`school` teacher and **normal** for a
  `free` one — this is the `prioritySupport` plan entitlement being read for the
  first time.

**Also check the reference is not `count(*)`-derived:** open two conversations in
quick succession and confirm you get two distinct references. The old generator
collided under concurrency against a `unique` column.

#### 5A.3 Internal notes — the most important test here

**Why it matters:** getting this wrong is the one mistake in this feature that
reaches a customer.

**Do:** Type a message, click **Add internal note**.

**Expect:**
- Renders in amber, clearly distinct from replies
- Labelled **"Internal note — not visible to the teacher"**
- The ticket stays **unread** — a private note must not make a ticket look
  handled while the teacher is still waiting

#### 5A.4 Reply clears unread

**Do:** Type a reply, click **Send reply**.

**Expect:** Renders dark, right-aligned. Unread dot clears.

#### 5A.5 Canned replies

**Do:** Click "Out of resources".

**Expect:** Composer fills with the seeded wording. Six snippets available.

#### 5A.6 Context rail

**Expect:** Right pane shows the teacher's live resource meter, AI-image chip
and measured cost — so you can answer "have they actually run out?" without
leaving the thread.

#### 5A.7 Assign and resolve

**Do:** **Assign to me**, then **Resolve**.

**Expect:** Status → Closed; ticket leaves the open filter; sidebar badge drops.

#### 5A.8 Drawer integration

**Do:** Go to `/admin/users`, open that teacher's drawer, find **Support
history**.

**Expect:** The ticket is listed — not a "Coming soon" placeholder.

---

### 5B · Teacher side (`/help`)

Everything here is from the **teacher's** browser profile, not an admin's.

#### 5B.1 The leak test — the most important test in the whole plan

**Why it matters:** `support_messages` stores internal notes in the same table
as teacher-visible replies. RLS on that table is admin-only for exactly this
reason, and every teacher-facing RPC filters `direction <> 'note'`. If one of
those filters is ever dropped, an internal note reaches the customer.

**Do:** As admin, on a teacher's ticket, send a **reply** and then add an
**internal note** — note *last*, so a missing filter would surface it as the
newest message.

As the teacher, reload `/help` and open that conversation.

**Expect:**
- The note is **absent from the message list**.
- The note is **absent from the conversation list preview** — check this
  separately; the preview is a different query and its own chance to leak.
- The message count does not include the note.
- Authors read **Jooma** / **You**, never an admin's email address.

**Check the wire, not the screen.** Open devtools → Network → the
`my_thread_messages` response. A note filtered only in React is still a leak.

#### 5B.2 Teachers cannot read the table directly

**Do:** In the Supabase SQL editor:

```sql
select count(*) from support_messages;  -- as a teacher's JWT: 0 rows
```

**Expect:** `0`. The `my_*` RPCs are the only route in, and RLS is what makes
that true rather than convention.

#### 5B.3 Round trip and the unread bell

**Do:** Teacher sends a message → admin replies → teacher returns to the app.

**Expect:**
- The **Bell** in the top bar shows a count, and the sidebar **Help** entry
  shows a dot.
- Opening the conversation clears both.
- The admin-side unread does **not** clear when the teacher reads — that flag
  means "we owe them a reply", which is the opposite direction.
- Teacher replies to a **resolved** ticket → it reopens as **Open**.

#### 5B.4 Email

SendGrid is configured (`SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`), so this
sends for real — **use a mailbox you own.**

**Do:** As admin, reply to the teacher's ticket.

**Expect:**
- The toast says **"Reply sent and emailed."**
- The email arrives from `noreply@jooma.ai`, quotes the reply, and its button
  deep-links to `/help?thread=…`.

**Expect always:** an **internal note never sends an email** — add one and
confirm no mail arrives. This is gated in `/api/support/reply`, not in the
database, and it is the one failure here that reaches a customer.

**If the keys are ever unset,** the reply still saves and the toast says so
honestly ("email isn't configured, so it wasn't sent") instead of claiming
delivery.

#### 5B.5 `/admin/emails` tells the truth

**Expect:** a banner confirming **SendGrid is configured** — this page used to
claim no provider was configured, which was wrong the whole time.

**Expect:** `support_reply` is listed, and the 11 templates with no renderer in
code carry a **No renderer** tag rather than looking sendable.

#### 5B.6 Placement

**Expect:** the launcher bubble does not appear on `/editor/*` (it would sit on
the zoom controls), nor on `/admin` or the marketing pages. `/help` works with
the sidebar collapsed.

---

### 5C · Enquiries (`/admin/enquiries`)

Contact and school enquiries from the marketing site. Separate from the inbox
because a ticket comes from a teacher with an account and an enquiry usually does
not.

#### 5C.1 A public enquiry arrives

**Do:** Signed out, submit the form at `/contact` with a `ZZ` prefixed message.
Open `/admin/enquiries`.

**Expect:** It appears as **New**, with a reference, the sender's details and the
message. The sidebar badge counts it.

**Why it matters:** this is the only unauthenticated write path in the product.
It goes through the `submit_enquiry` function rather than an anon insert policy,
so a failure here is worth reporting precisely.

#### 5C.2 A school enquiry demands more

**Do:** Submit `/contact?type=school` **without** a school name or phone number.

**Expect:** Refused. A school lead with neither cannot be acted on, so it is
rejected at the database rather than left for somebody to notice.

#### 5C.3 Replying, and the note that must never be sent

**Do:** Open the enquiry, add an **internal note**, then send a **reply**.

**Expect:** Both appear on the thread, visually distinct. The reply is emailed
and marked as sent; the note is not emailed at all, and shows as a note.

**Why it matters:** mailing an internal note is the single mistake in this
feature that reaches a customer. If a note ever goes out, stop and report it.

#### 5C.4 Status

**Do:** Move it to **In progress**, then **Closed**.

**Expect:** The badge count drops when it leaves New, and the filters agree.

**Cleanup:** `delete from enquiries where message like 'ZZ%';` (replies cascade.)

---

## Part 6 — Content

### 6A · Website & app copy (`/admin/copy`)

#### 6A.1 The list

**Expect:** 14 blocks across Landing / Pricing / Teacher dashboard. All **Live**.

#### 6A.2 Draft doesn't go live — the key test

**Why it matters:** RLS is row-level and can't hide a single column, so an
unpublished draft leaking to the public site would be a real incident.

**Do:** Open `home.hero.cta` (currently "Get Started"). Change to
`ZZ Draft Text`. Click **Save draft** (not Publish).

**Expect:**
- Row shows a **Draft** tag and both values ("Live: Get Started")
- A banner reports "1 unpublished change"

**Verify the public view still shows the old text** — in Supabase SQL editor:

```sql
select key, value from public_copy where key = 'home.hero.cta';
```

**Expect:** `Get Started` — **not** `ZZ Draft Text`.

#### 6A.3 Publish and roll back

**Do:** Reopen the block → **Publish now**.

**Expect:** Version increments; Draft tag clears; `public_copy` now returns the
new text.

**Do:** Reopen → **Load history**.

**Expect:** The previous version is listed with who published it and when.
**Restore "Get Started" and publish** to leave things clean.

---

### 6B · Email templates (`/admin/emails`)

#### 6B.1 Known limitation

**Expect:** 12 templates and a prominent callout that **no email provider is
configured** so nothing sends. Engagement columns are deliberately absent
rather than showing invented open rates. Blocked on SendGrid access —
[#24](https://github.com/work-whale/jooma/issues/24).

#### 6B.2 Edit wording

**Do:** Edit "Welcome" → change the subject → Save.

**Expect:** Saves, audit entry. The modal repeats that nothing sends yet.

---

### 6C · Announcements (`/admin/announce`)

#### 6C.1 Known limitation

**Expect:** A callout that the teacher dashboard doesn't render banners yet, so
counts stay at zero — [#25](https://github.com/work-whale/jooma/issues/25).

#### 6C.2 Compose

**Do:** **New announcement** → "ZZ TEST — planned maintenance Sunday" →
Maintenance → Everyone → publish on.

**Expect:** Appears under **Live now**. **Take down** moves it to drafts.

---

## Part 7 — Admin

### 7A · Team & roles (`/admin/team`)

#### 7A.1 The team

**Expect:** Four admins, all **Super admin** (nobody has an explicit role yet,
and the default preserves existing access). One shows a **you** tag.

#### 7A.2 The permission matrix

**Expect:** 11 permissions × 5 roles. Support can grant resources but **not**
issue refunds; Content can edit copy but **not** see teacher accounts.

#### 7A.3 Change a role

**Do:** Change another admin (not yourself) to **Support**.

**Expect:** Saves; audit entry appears.

#### 7A.4 Role enforcement is real, not cosmetic

**Why it matters:** if this only hid buttons, anyone could call the API directly.

**Do:** Sign in as the admin you just made **Support**. Go to `/admin/copy`.

**Expect:** A banner saying your role can view but not change copy. Attempting
to save a draft is refused **by the server**, not just hidden.

**Restore them to Super admin afterwards.**

#### 7A.5 Last-super-admin guard

**Why it matters:** without it, one wrong dropdown leaves nobody able to manage
roles and no way back through the UI.

**Do:** Demote every admin except one to a non-super role, then try to demote
the last one.

**Expect:** Refused — "cannot remove the last super admin".

**Restore everyone to Super admin.**

---

### 7B · Audit log (`/admin/audit`)

#### 7B.1 Everything you did is here

**Expect:** By now, entries for every action in this plan — grants, school
creation, seat changes, invoices, tool toggles, copy publishes, role changes.
Each has timestamp, actor email, action and object.

#### 7B.2 Filters

**Do:** Search "Granted"; filter by actor; filter by type (Account / Billing /
Content / Access).

**Expect:** Results narrow correctly.

#### 7B.3 It's append-only — verify in SQL

**Why it matters:** the page claims "not editable by anyone, including super
admins". That should be enforced by the schema, not just stated.

> **Read this before running it.** The Supabase SQL editor connects as the
> table **owner**, and Postgres lets a table's owner bypass its own RLS
> policies. Running a bare `update` there will report "1 row updated" and look
> like a failure when it isn't. `set local role authenticated` is what makes
> the test meaningful — that's the role the app actually uses.

**Do:** In the Supabase SQL editor, run each block separately:

```sql
-- UPDATE must affect 0 rows
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles where is_admin limit 1))::text, true);
with attempt as (update admin_audit_log set action = 'tampered' returning 1)
select count(*) as rows_updated_expect_0 from attempt;
rollback;
```

```sql
-- DELETE must affect 0 rows
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles where is_admin limit 1))::text, true);
with d as (delete from admin_audit_log returning 1)
select count(*) as rows_deleted_expect_0 from d;
rollback;
```

**Expect:** Both return **0**. There is no UPDATE or DELETE policy on this table
for any role, so an admin acting through the app cannot alter history.

Both statements are wrapped in `begin … rollback`, so nothing is written even
if the guarantee were broken.

---

### 7C · Activity (`/admin/activity`)

**Expect:** Last 100 generations with user email, tool, title, timestamp.

---

### 7D · Settings (`/admin/settings`)

#### 7D.1 Known limitation

**Expect:** A callout that most settings are recorded but **not yet read** by
the app — [#26](https://github.com/work-whale/jooma/issues/26).

#### 7D.2 Toggle persists

**Do:** Toggle "Maintenance mode" on, refresh, toggle off.

**Expect:** State persists; audit entries appear. **The app does not actually
enter maintenance mode** — that's the known gap, not a test failure.

#### 7D.3 Data protection card

**Expect:** Notes that retention and deletion policies aren't implemented —
prompts are kept indefinitely. See [#27](https://github.com/work-whale/jooma/issues/27),
which also covers a live bug: **account deletion currently fails** for any
teacher with a saved presentation.

---

## Part 8 — Cross-cutting

### 8.1 Loading states

**Do:** Throttle to "Slow 3G" in DevTools → Network. Navigate between pages.

**Expect:** Grey skeletons, not blank screens.

### 8.2 Responsive

**Do:** Narrow the window to ~900px.

**Expect:** Stat grids reflow 4→2 columns. Tables scroll horizontally rather
than breaking the page.

### 8.3 Keyboard

**Do:** Open any drawer or modal → press **Escape**. Tab through a form.

**Expect:** Escape closes. Focus rings visible.

### 8.4 Console

**Do:** Keep DevTools console open throughout.

**Expect:** No red errors. React key warnings are worth reporting.

---

## Appendix A — Cleanup

Run in the Supabase SQL editor once testing is done.

```sql
-- Order matters: children before parents.

delete from support_messages where thread_id in (
  select id from support_threads where subject like 'ZZ%');
delete from support_threads where subject like 'ZZ%';

delete from safeguarding_flags where reason like 'ZZ%';
delete from announcements where message like 'ZZ%';

delete from invoices where school_id in (select id from schools where name like 'ZZ%');
delete from school_seats where school_id in (select id from schools where name like 'ZZ%');
delete from school_onboarding_tasks where school_id in (select id from schools where name like 'ZZ%');
delete from school_admins where school_id in (select id from schools where name like 'ZZ%');
update profiles set school_id = null where school_id in (select id from schools where name like 'ZZ%');
delete from schools where name like 'ZZ%';
delete from trusts where name like 'ZZ%';

-- Ambassadors. Codes and referrals cascade from the ambassador, so this one
-- delete is enough; the Stripe codes are dealt with separately below.
delete from ambassadors where full_name like 'ZZ%';

-- Enquiries. Replies cascade.
delete from enquiries where message like 'ZZ%' or name like 'ZZ%';

-- Allowance grants from testing (they expire at month end anyway).
delete from allowance_grants where reason like '%support issue%'
  and created_at > now() - interval '1 day';

-- Restore copy if you left a draft behind.
update copy_blocks set draft = null where draft like 'ZZ%';
```

**Deliberately not deleted:**

- **`admin_audit_log`** — append-only by design. Test entries stay, correctly.
- **Stripe promotion codes** — Stripe can't delete them, only deactivate.
  Deactivate any `ZZ*` codes in the test dashboard.

**Verify cleanup:**

```sql
select 'schools' t, count(*) n from schools where name like 'ZZ%'
union all select 'threads', count(*) from support_threads where subject like 'ZZ%'
union all select 'flags', count(*) from safeguarding_flags where reason like 'ZZ%'
union all select 'announcements', count(*) from announcements where message like 'ZZ%'
union all select 'ambassadors', count(*) from ambassadors where full_name like 'ZZ%'
union all select 'enquiries', count(*) from enquiries where message like 'ZZ%';
-- All should be 0.
```

**A faster alternative for ambassadors:** `node scripts/verify-ambassadors.mjs`
creates and deletes its own fixtures, so it leaves nothing behind even when it
fails part way through. Prefer it over the manual walkthrough when you only want
to know whether the rules still hold.

---

## Appendix B — Reporting a failure

Include:

1. **Which test** (e.g. "5A.3")
2. **Expected vs actual**
3. **Console errors** (DevTools → Console)
4. **Network failure** if any — DevTools → Network, find the red `rpc/...` call,
   copy the response body. The error message from Postgres is usually the whole
   answer.
5. **Who you were signed in as** — several behaviours are role-dependent

---

## Appendix C — Known limitations (not bugs)

Don't raise these; they're tracked:

| Area | Limitation | Issue |
|---|---|---|
| Safeguarding | No filter writes flags | [#28](https://github.com/work-whale/jooma/issues/28) |
| Email | SendGrid **is** configured and the 4 templates with renderers send for real. The other 11 `email_templates` rows have no renderer in code and cannot send — flagged **No renderer** in `/admin/emails`. No engagement data until the SendGrid event webhook is wired | [#24](https://github.com/work-whale/jooma/issues/24) |
| Announcements | No teacher-facing banner | [#25](https://github.com/work-whale/jooma/issues/25) |
| Settings | Recorded but not enforced | [#26](https://github.com/work-whale/jooma/issues/26) |
| Dashboard | No acquisition/UTM data | [#28](https://github.com/work-whale/jooma/issues/28) |
| Retention | Nothing purged; **account deletion fails** | [#27](https://github.com/work-whale/jooma/issues/27) |
| Tools | `lesson-slideshow` unlisted | [#20](https://github.com/work-whale/jooma/issues/20) |
| Ambassadors | **Payouts are recorded, not made.** Marking a referral Paid is bookkeeping; Jooma never moves money to an ambassador. Pay them out of band and record it here | — |
| Ambassadors | A referral whose code was refused at checkout still counts, and the teacher pays full price. Deliberate: they were genuinely referred, and only the discount lapsed | — |
| Images | Shared read scope | [#22](https://github.com/work-whale/jooma/issues/22) |
