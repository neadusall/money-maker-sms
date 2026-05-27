const nodemailer = require("nodemailer");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const TO = "neadusall@gmail.com"; // your email — invite lands on your calendar
const startUTC = "20260527T200000Z"; // 4:00 PM Eastern (EDT) today
const endUTC = "20260527T203000Z";   // 30 min
const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const uid = `david-trasatti-${Date.now()}@money-maker`;

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//money-maker-sms//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `DTSTAMP:${dtstamp}`,
  `DTSTART:${startUTC}`,
  `DTEND:${endUTC}`,
  "SUMMARY:Call David Trasatti — VP of Sales (Oracle)",
  "DESCRIPTION:Candidate asked you to call his cell at 4:00 PM ET.\nCall: +1 617-510-4922\nRe: VP of Sales opportunity\nCandidate email: david.trasatti@oracle.com\n(He also offered tomorrow as an alternative.)",
  "LOCATION:Call cell +1 617-510-4922",
  "ORGANIZER;CN=Ryan:mailto:" + TO,
  "ATTENDEE;CN=Ryan;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:" + TO,
  "STATUS:CONFIRMED",
  "SEQUENCE:0",
  "BEGIN:VALARM",
  "TRIGGER:-PT10M",
  "ACTION:DISPLAY",
  "DESCRIPTION:Call David Trasatti in 10 min",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

(async () => {
  const info = await t.sendMail({
    from: process.env.SMTP_FROM,
    to: TO,
    subject: "📅 Call David Trasatti — 4:00 PM ET today (VP of Sales)",
    text: "Calendar invite: Call David Trasatti at 4:00 PM ET today. His cell: +1 617-510-4922. Re: VP of Sales opportunity. (He also offered tomorrow.)",
    icalEvent: { method: "REQUEST", filename: "invite.ics", content: ics },
  });
  console.log("sent:", info.messageId, "accepted:", JSON.stringify(info.accepted));
  process.exit(0);
})().catch((e) => { console.error("SEND FAILED:", e.message); process.exit(1); });
