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
