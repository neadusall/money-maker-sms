let lastSendAt = 0;

function mps(): number {
  const raw = Number(process.env.TELNYX_MPS ?? "1");
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(raw, 100);
}

export async function paceForNextSend(): Promise<void> {
  const minIntervalMs = Math.ceil(1000 / mps());
  const now = Date.now();
  const sinceLast = now - lastSendAt;
  if (sinceLast < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - sinceLast));
  }
  lastSendAt = Date.now();
}
