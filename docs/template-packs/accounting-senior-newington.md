# Template pack: firm Seniors to industry cost/inventory (Newington, NH)

Paste one of these into a campaign's **SMS template** field. They are written as spintax, so
every recipient gets a different surface form of the same approved message. Do **not** add a
STOP line: the send chokepoint appends it, and it is deliberately outside the spin so no
branch can vary or weaken the opt-out instruction.

## The targeting thesis this pack encodes

Straight from the sourcing note to Josie, so the copy and the list stay aligned:

- **Pool:** Seniors 3 to 5 years in at regional firms, one cycle short of Manager. They have
  owned the close end to end and seen inside a dozen companies. An industry hire at the same
  title usually owns one slice of it. That contrast is the pitch, and it is what makes the
  message land as a compliment rather than a job blast.
- **The real filter:** firm Seniors who audited **manufacturers and distributors**. They have
  already lived in standard costing and inventory reserves, which is the cost and inventory
  line the role actually turns on. This subset converts noticeably better, so it should be a
  list filter, not just a line of copy.
- **Geography:** Portsmouth, Dover, Manchester, and southern Maine all feed Newington. Set the
  campaign's target region accordingly and let the geo template do the rest.

## Merge fields used

`{{firstName}}`, `{{company}}`. Both are checked per recipient before sending, and a contact
missing one is failed with a clear reason rather than shipped with a raw token. Keep every
merge field inside a spin branch only if you are certain the field is populated for the whole
list.

---

## 1. Opener (the close-ownership angle)

```
{Hi|Hey} {{firstName}}, {saw|noticed} you{'re| are} {at|with} {{company}}. {I'm working on|Filling} a {cost and inventory|cost-side} seat in Newington {for|with} a manufacturer. {Firm seniors|People coming off audit} {tend to|usually} {run the close end to end|own the whole close}, which is {exactly|precisely} what {this one needs|the seat needs}. {Worth a look?|Open to the details?|Want me to send it over?}
```

**12,288 renderings**, comfortably above the 1,000 floor for a 200/day cap. Renders at 238 to
258 characters, which is 2 SMS segments with the STOP footer.

## 2. The manufacturing and distribution filter (highest converting)

```
{Hi|Hey} {{firstName}}, {quick one|short one}. You{'ve| have} {audited|worked with} manufacturers {and distributors|and distribution}, so {standard costing|costing} and inventory reserves {are not new|are familiar ground}. {A Newington manufacturer|A manufacturer in Newington} {is hiring|has an opening} on {exactly that|that exact} line. {Interested?|Worth a conversation?|Want the details?}
```

**3,072 renderings**, 219 to 239 characters, 2 segments.

## 3. One cycle short of Manager (the timing angle)

```
{Hi|Hey} {{firstName}}, {a lot of|most} {seniors|firm seniors} at your {stage|point} {are|end up} {one cycle|a busy season} short of Manager {and decide to move|before they move}. {If that's you|If that lands}, {there's|I have} a {cost and inventory|costing} seat in Newington {worth a look|worth a conversation}. {Want it?|Should I send it?|Open to hearing it?}
```

**6,144 renderings**, 193 to 225 characters, 2 segments.

## 4. Geography (Portsmouth / Dover / Manchester / southern Maine)

```
{Hi|Hey} {{firstName}}, {you're|you are} {close enough to|within range of} Newington {for|to make} {an easy|a reasonable} commute. {A manufacturer there|A manufacturer in Newington} {is hiring|has an opening} on the cost and inventory side {and wants|and is after} {firm-trained|audit-trained} {people|candidates}. {Worth a look?|Want the details?|Open to it?}
```

**3,072 renderings**, 203 to 222 characters, 2 segments.

---

## Running this pack against a 200/day business line

- **Sending lane:** `Auto`. Firm seniors skew heavily iPhone, so most of this list lands on
  the blue lane while the rest keeps riding Telnyx. The comparison card on the campaign page
  is what proves whether the blue half is actually replying better.
- **iMessage volume is NOT 200/day.** The blue lane runs off one Apple ID on our own Mac,
  under hard warm-up ceilings (50 new contacts/day, 15/hour, ramping over two to three
  weeks). The 200/day cap governs the campaign as a whole; the iMessage share of it is
  whatever the warm-up allows, and the rest goes out on Telnyx.
- **Daily cap:** 200. **Warm-up:** start 20, step 20, so the line opens at 20 on day one and
  reaches 200 on day ten.
- **Send window:** 09:00 to 19:00 gives the pacer a ten-hour spread, roughly one message every
  three minutes at full volume, with random spacing on top.
- **Fit bar:** leave the score threshold on. The manufacturing and distribution filter is the
  point of this pack, and it works far better as a list filter than as a sentence.

## What spintax does and does not protect

Spintax defeats **content fingerprinting**, which is how carriers filter SMS. It does close to
nothing against Apple, which acts on **behavior**: fanout speed, how many strangers an Apple
ID touches, and Report Junk taps. The daily cap, the warm-up ramp, the jittered spacing, and
the lane-health check are what protect the iMessage side. Use both.
