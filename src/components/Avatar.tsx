const PALETTE = [
  { bg: "bg-rose-100", fg: "text-rose-700" },
  { bg: "bg-amber-100", fg: "text-amber-700" },
  { bg: "bg-emerald-100", fg: "text-emerald-700" },
  { bg: "bg-sky-100", fg: "text-sky-700" },
  { bg: "bg-violet-100", fg: "text-violet-700" },
  { bg: "bg-fuchsia-100", fg: "text-fuchsia-700" },
  { bg: "bg-indigo-100", fg: "text-indigo-700" },
  { bg: "bg-teal-100", fg: "text-teal-700" },
  { bg: "bg-orange-100", fg: "text-orange-700" },
  { bg: "bg-cyan-100", fg: "text-cyan-700" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(firstName: string | null, lastName: string | null, fallback: string): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  return fallback.slice(-2).toUpperCase();
}

export function Avatar({
  firstName,
  lastName,
  phone,
  size = "md",
}: {
  firstName: string | null;
  lastName: string | null;
  phone: string;
  size?: "sm" | "md" | "lg";
}) {
  const key = (firstName ?? "") + (lastName ?? "") + phone;
  const palette = PALETTE[hash(key) % PALETTE.length];
  const label = initials(firstName, lastName, phone);
  const cls =
    size === "sm"
      ? "h-8 w-8 text-xs"
      : size === "lg"
        ? "h-12 w-12 text-base"
        : "h-10 w-10 text-sm";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${palette.bg} ${palette.fg} ${cls}`}
    >
      {label}
    </div>
  );
}
