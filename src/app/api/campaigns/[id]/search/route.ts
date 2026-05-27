import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Full-text-ish search across ALL correspondence in a campaign: matches any
 * message body (not just the last one) plus contact name/phone/company, and
 * returns matching conversations with the matching message as the preview, most
 * recent match first — so a buried keyword surfaces and the thread opens.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (cv.id)
      cv.id, cv.status, cv.classification, cv.last_message_at, cv.unread_count,
      ct.id ct_id, ct.first_name, ct.last_name, ct.phone, ct.company, ct.job_title, ct.linkedin_url,
      ct.qualification_score, ct.qualification_reason,
      mm.body match_body, mm.direction match_dir, mm.created_at match_at
    FROM conversations cv
    JOIN contacts ct ON ct.id = cv.contact_id
    LEFT JOIN LATERAL (
      SELECT body, direction, created_at FROM messages m
      WHERE m.conversation_id = cv.id AND m.body ILIKE ${like}
      ORDER BY m.created_at DESC LIMIT 1
    ) mm ON true
    WHERE cv.campaign_id = ${id}
      AND (mm.body IS NOT NULL
           OR ct.first_name ILIKE ${like} OR ct.last_name ILIKE ${like}
           OR ct.company ILIKE ${like} OR ct.phone ILIKE ${like})
    ORDER BY cv.id, mm.created_at DESC NULLS LAST
    LIMIT 200`);

  type Row = {
    id: string; status: string; classification: string | null;
    last_message_at: string; unread_count: string;
    ct_id: string; first_name: string | null; last_name: string | null; phone: string;
    company: string | null; job_title: string | null; linkedin_url: string | null;
    qualification_score: number | null; qualification_reason: string | null;
    match_body: string | null; match_dir: "inbound" | "outbound" | null; match_at: string | null;
  };

  const results = (rows.rows as Row[])
    .map((r) => ({
      id: r.id,
      status: r.status,
      classification: r.classification,
      score: r.qualification_score,
      scoreReason: r.qualification_reason,
      lastMessageAt: new Date(r.match_at ?? r.last_message_at).toISOString(),
      unreadCount: Number(r.unread_count),
      contact: {
        id: r.ct_id, firstName: r.first_name, lastName: r.last_name, phone: r.phone,
        company: r.company, jobTitle: r.job_title, linkedinUrl: r.linkedin_url,
      },
      lastMessage: r.match_body ? { direction: r.match_dir ?? "outbound", body: r.match_body } : null,
    }))
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  return NextResponse.json({ results });
}
