export type SendWindowCheck =
  | { ok: true }
  | { ok: false; reason: "outside_window"; openAt: Date };

function parseHHMM(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  // Allow 24:00 as an end-of-day marker (= 1440 minutes).
  if (h === 24 && m === 0) return { h: 24, m: 0 };
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function nowInTimezone(tz: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
}

/**
 * Interpret a wall-clock datetime-local string ("YYYY-MM-DDTHH:mm", no zone)
 * as a moment in the given IANA timezone, returning the corresponding UTC Date.
 * Used for campaign schedules so "2:00 PM" means 2 PM in APP_TIMEZONE no matter
 * where the server runs (Hetzner is UTC).
 */
export function parseScheduleInTz(
  value: string,
  tz: string = process.env.APP_TIMEZONE ?? "America/New_York",
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  // Treat the naive wall-clock as if it were UTC, then correct by the tz offset
  // at that instant so the stored instant maps back to the intended wall time.
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const d = new Date(asUtc);
  const tzWall = new Date(d.toLocaleString("en-US", { timeZone: tz })).getTime();
  const utcWall = new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const offset = tzWall - utcWall;
  return new Date(asUtc - offset);
}

export function isWithinSendWindow(
  startHHMM: string,
  endHHMM: string,
  tz: string = process.env.APP_TIMEZONE ?? "America/New_York",
  now: Date = nowInTimezone(tz),
): SendWindowCheck {
  const start = parseHHMM(startHHMM) ?? { h: 9, m: 0 };
  const end = parseHHMM(endHHMM) ?? { h: 19, m: 0 };

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesStart = start.h * 60 + start.m;
  const minutesEnd = end.h * 60 + end.m;

  const within =
    minutesStart <= minutesEnd
      ? minutesNow >= minutesStart && minutesNow < minutesEnd
      : minutesNow >= minutesStart || minutesNow < minutesEnd;

  if (within) return { ok: true };

  const openAt = new Date(now);
  openAt.setHours(start.h, start.m, 0, 0);
  if (minutesNow >= minutesEnd) {
    openAt.setDate(openAt.getDate() + 1);
  }
  return { ok: false, reason: "outside_window", openAt };
}
