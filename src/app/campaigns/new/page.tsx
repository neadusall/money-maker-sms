import Link from "next/link";
import { createCampaign } from "@/lib/actions";
import { CampaignForm } from "@/components/CampaignForm";

export default function NewCampaignPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700">
        ← All campaigns
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New campaign</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Set up the role, write your SMS template, upload your contacts, and you&apos;re ready to send — all in one place.
      </p>
      <CampaignForm action={createCampaign} className="mt-6" submitLabel="Create campaign" showContactUpload />
    </section>
  );
}
