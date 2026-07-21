"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns } from "@/db/schema";
import { auth } from "./auth";
import { assertTenantCampaign } from "./tenant";

/**
 * Reassign which recruiter owns a campaign, straight from the dashboard chip.
 * Blank name + email clears the owner (chip shows Unassigned). Lives in its
 * own module (not actions.ts) so the dashboard popover pulls in nothing else.
 */
export async function updateCampaignOwner(
  campaignId: string,
  name: string,
  email: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  await assertTenantCampaign(campaignId); // reassignment stays inside the tenant

  const cleanName = name.trim().slice(0, 80);
  const cleanEmail = email.trim().toLowerCase().slice(0, 120);
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("That email doesn't look valid");
  }

  await db
    .update(campaigns)
    .set({
      recruiterName: cleanName || null,
      recruiterEmail: cleanEmail || null,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  revalidatePath("/");
}
