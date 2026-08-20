# iMessage lane: Mac mini + iPhone setup

Everything in OS Text is built and waiting. This is the hardware half. Work top to bottom;
nothing sends on the blue lane until step 6 passes.

## What the pieces do

```
 iPhone ──Text Message Forwarding──┐
                                   ▼
 Mac mini (always on, Messages signed in)
        └── BlueBubbles Server ──tunnel──▶ OS Text
                  ▲                            │
                  └────── send requests ───────┘
             webhook: inbound + your own iPhone replies
```

The Mac is the sender. OS Text never talks to Apple; it talks to your Mac, and your Mac
talks to Apple exactly the way a person typing in Messages does. That is the whole reason
there is no vendor in this path.

## 1. The Apple ID

Use a **dedicated Apple ID**, not your personal one. Apple rate-limits and eventually flags
accounts that message many strangers quickly, and you do not want that account to be the one
holding your photos and your 2FA.

- Create the Apple ID on the Mac mini.
- Sign into **Messages** with it (Messages → Settings → iMessage).
- Under "You can be reached for messages at", note the address/number that is checked. That
  is what candidates will see.

## 2. The Mac mini

- **Never sleeps.** System Settings → Energy → "Prevent automatic sleeping when the display
  is off" ON, and set "Start up automatically after a power failure". A sleeping Mac is the
  single most common cause of this lane silently stopping.
- Turn off automatic macOS updates that force restarts, or the lane dies at 3am on a Tuesday.
- Give Messages and BlueBubbles **Full Disk Access** (System Settings → Privacy & Security →
  Full Disk Access). BlueBubbles reads the Messages database; without this it starts but
  reports nothing.

## 3. iPhone Text Message Forwarding

Settings → Messages → Text Message Forwarding → enable the Mac mini.

This is what lets green-bubble SMS to your number appear on the Mac too. It is optional for
the iMessage lane itself, but it means a candidate who replies from a non-iPhone still shows
up in one place.

## 4. BlueBubbles Server

- Install BlueBubbles Server on the Mac mini and set a **strong server password**.
- Note the version. The endpoint payloads have drifted between BlueBubbles releases, and
  `src/lib/bluebubbles.ts` was written against the v1.9 REST docs. Step 6 is where you prove
  the shapes match before anything real is sent.

## 5. Reach the Mac from the server

The Mac is behind your home/office NAT and OS Text runs on Hetzner, so it needs a stable URL.
Pick one:

- **Tailscale** (simplest): install on the Mac and on the `ros` host, use the Mac's tailnet
  address. Nothing is exposed to the public internet.
- **Cloudflare Tunnel**: gives a public hostname, useful if you also want to hit it from a
  phone. Put Cloudflare Access in front of it if you do.

Do **not** port-forward the BlueBubbles port to the open internet with only a password.

## 6. Prove the endpoint shapes BEFORE enabling

This is the step that is easy to skip and expensive to skip. Run these from the `ros` host.
They are the exact four calls `src/lib/bluebubbles.ts` makes, so a pass here means the code
will work, and a failure tells you precisely which line to fix.

```bash
# 1. Health (client: api/v1/server/info)
curl -s "$BLUEBUBBLES_URL/api/v1/server/info?password=$BLUEBUBBLES_PASSWORD" | head -40

# 2. Availability (client: api/v1/handle/availability/imessage)
#    Expect a body carrying a boolean "available". Anything else reads as UNKNOWN,
#    and unknown routes to SMS - which is how a whole campaign quietly goes green.
curl -s "$BLUEBUBBLES_URL/api/v1/handle/availability/imessage?address=%2B1YOURPHONE&password=$BLUEBUBBLES_PASSWORD"

# 3. Send to YOUR OWN number, then confirm it arrived as a BLUE bubble.
#    chatGuid is "any;-;<number>" and the client sends `method`, which must be
#    "apple-script" unless you have the BlueBubbles Private API helper installed
#    (then set BLUEBUBBLES_METHOD=private-api).
curl -s -X POST "$BLUEBUBBLES_URL/api/v1/message/text?password=$BLUEBUBBLES_PASSWORD" \
  -H 'content-type: application/json' \
  -d '{"chatGuid":"any;-;+1YOURPHONE","tempGuid":"ros-test-1","message":"bridge test","method":"apple-script"}'

# 4. Reconcile lookup (client: api/v1/message/<guid>) - this is what settles an
#    ambiguous send. Use the guid returned by call 3.
curl -s "$BLUEBUBBLES_URL/api/v1/message/<guid-from-step-3>?password=$BLUEBUBBLES_PASSWORD"
```

Compare each response against what `src/lib/bluebubbles.ts` expects (`data.guid` on send,
`available` on availability). If a field name differs, fix it there before going further. A
mismatch does not error loudly at runtime - it quietly makes every availability check return
"unknown", and your whole list routes to SMS while looking perfectly healthy.

## 7. Point OS Text at it

On the `ros` host, in the OS Text environment:

```
BLUEBUBBLES_URL=http://<tailnet-or-tunnel-host>:1234
BLUEBUBBLES_PASSWORD=<server password>
BLUEBUBBLES_WEBHOOK_SECRET=<a long random string you choose>
OSTEXT_IMESSAGE_TENANT=lume          # the tenant allowed on this Apple ID
```

The lane fails closed: with any of these missing it stays off, `auto` campaigns send on SMS,
and `imessage` campaigns hold their contacts rather than sending green. That is deliberate.

Then in BlueBubbles Server → Settings → Webhooks, add:

```
https://<os-text-host>/api/webhooks/imessage?token=<BLUEBUBBLES_WEBHOOK_SECRET>
```

Subscribe it to new-message events. This is what makes the portal a monitoring surface: every
inbound reply lands in the thread, **and** anything you type on your own iPhone to a contact
already in OS Text is mirrored into that thread too, so the record stays complete no matter
which device you answered from.

## 8. First real run

- One campaign, `channel: auto`, a **small** list, daily cap 200 with warm-up 20/20.
- Watch the campaign page: the iMessage vs SMS card and the pacing card both fill in live.
- Watch `docker logs` for the boot line `[ostext setup] ... IMESSAGE=set (tenant lume, ...)`.
- Check the System Health board: the bridge registers there, and an unreachable Mac shows as
  degraded rather than silently failing.

## What to expect on volume

The blue lane is **not** 200/day. One Apple ID under warm-up gets 50 new contacts/day and
15/hour once fully ramped, over two to three weeks from a cold start. The campaign's 200/day
cap governs the campaign as a whole; iMessage takes what the warm-up allows and Telnyx
carries the rest. Those ceilings are in `src/lib/imessage-warmup.ts` and a campaign setting
can lower them but never raise them.

## When something breaks

| Symptom | Almost always |
|---|---|
| Lane silently sends everything on SMS | Mac asleep, or availability checks returning unknown (step 6) |
| Messages show "uncertain" in the thread | Bridge timed out mid-send; the reconcile sweep settles it within 30 min. Nothing is resent, on purpose |
| Portal reply refuses to send on a blue thread | Mac unreachable. Text from the iPhone instead; it mirrors back into the thread |
| Replies stop arriving | Webhook URL or token wrong in BlueBubbles Server settings |
| Sends start failing in bulk | Apple is throttling the ID. The lane-health check pauses the lane; let it rest, do not push through it |
