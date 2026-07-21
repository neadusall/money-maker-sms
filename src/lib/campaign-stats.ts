import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Message-truth campaign funnel, shared by the dashboard and the campaign
 * detail page. Contact.status churns (an opt-out overwrites 'delivered', so
 * the contact silently leaves the Sent/Delivered denominators), and a
 * conversation can hold inbounds the campaign never earned (a STOP keyword,
 * or a reply to a text sent outside this campaign that phone-matched into an
 * inbound-only thread). Both distorted the reply rate, so every count here
 * derives from the messages table instead:
 *  - messaged / delivered: conversations holding at least one real outbound
 *    (respectively one confirmed delivered).
 *  - replied: conversations with an inbound that is not a STOP and that
 *    follows an outbound in the SAME conversation, i.e. an actual response
 *    to a text this campaign sent.
 * Raw SQL with aliases on purpose: Drizzle does not correlate a filtered
 * EXISTS subquery (it silently returns 0).
 */
export type CampaignFunnel = {
  campaignId: string;
  messaged: number;
  delivered: number;
  replied: number;
  needsAttention: number;
};

export async function campaignFunnels(campaignId?: string): Promise<Map<string, CampaignFunnel>> {
  const res = await db.execute(sql`
    SELECT cv.campaign_id AS cid,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound'))::int AS messaged,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound' AND m.status = 'delivered'))::int AS delivered,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM messages mi
        WHERE mi.conversation_id = cv.id AND mi.direction = 'inbound'
          AND mi.classification IS DISTINCT FROM 'stop'
          AND EXISTS (
            SELECT 1 FROM messages mo
            WHERE mo.conversation_id = cv.id AND mo.direction = 'outbound' AND mo.created_at < mi.created_at)))::int AS replied,
      count(*) FILTER (WHERE cv.status = 'needs_attention')::int AS needs_attention
    FROM conversations cv
    ${campaignId ? sql`WHERE cv.campaign_id = ${campaignId}` : sql``}
    GROUP BY cv.campaign_id`);
  const rows = res.rows as { cid: string; messaged: number; delivered: number; replied: number; needs_attention: number }[];
  return new Map(
    rows.map((r) => [
      r.cid,
      {
        campaignId: r.cid,
        messaged: Number(r.messaged),
        delivered: Number(r.delivered),
        replied: Number(r.replied),
        needsAttention: Number(r.needs_attention),
      },
    ]),
  );
}

export const EMPTY_FUNNEL: CampaignFunnel = {
  campaignId: "",
  messaged: 0,
  delivered: 0,
  replied: 0,
  needsAttention: 0,
};
