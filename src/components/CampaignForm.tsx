import type { Campaign } from "@/db/schema";
import { REGIONS } from "@/lib/region";

type Action = (formData: FormData) => Promise<void>;

const SAMPLE_TEMPLATE = `Hi {first_name}, reaching out about an opportunity that looks aligned with your background. Open to a quick chat?`;

const APP_TZ = process.env.APP_TIMEZONE ?? "America/New_York";

function hourLabel(h: number): string {
  if (h === 0) return "12:00 AM (midnight)";
  if (h === 12) return "12:00 PM (noon)";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

// 12 AM … 11 PM, value "HH:00". `endOfDay` adds a final "midnight / end of day" option.
function hourOptions(endOfDay = false): { value: string; label: string }[] {
  const opts = Array.from({ length: 24 }, (_, h) => ({
    value: `${String(h).padStart(2, "0")}:00`,
    label: hourLabel(h),
  }));
  if (endOfDay) opts.push({ value: "24:00", label: "Midnight (end of day)" });
  return opts;
}

// Format a stored Date as a datetime-local value ("YYYY-MM-DDTHH:mm") in APP_TZ.
function toLocalInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function CampaignForm({
  action,
  className,
  campaign,
  submitLabel,
  showContactUpload,
}: {
  action: Action;
  className?: string;
  campaign?: Campaign;
  submitLabel?: string;
  showContactUpload?: boolean;
}) {
  return (
    <form action={action} className={"grid gap-6 " + (className ?? "")}>
      <Card title="Basics">
        <Row>
          <Field label="Campaign name" name="name" required defaultValue={campaign?.name} />
          <Select
            label="LLM mode"
            name="llmMode"
            defaultValue={campaign?.llmMode ?? "draft_only"}
            options={[
              { value: "draft_only", label: "Draft only (recommended)" },
              { value: "semi_auto", label: "Semi-auto (LLM sends clear positives)" },
              { value: "manual", label: "Manual (no LLM drafting)" },
            ]}
          />
        </Row>
        <TextArea
          label="SMS template"
          name="smsTemplate"
          required
          rows={3}
          defaultValue={campaign?.smsTemplate ?? SAMPLE_TEMPLATE}
          help="Merge tokens pull from each contact's CSV data: {first_name}, {company}, {job_title}, {location}, or any custom column. Only use a token if every contact has that field — otherwise that contact's send is skipped. For the role you're recruiting for, type it directly (it's the same for everyone), don't use {job_title} (that's the candidate's current title)."
        />
        <Field
          label="From number (E.164, optional)"
          name="fromNumber"
          placeholder="+15555550123"
          defaultValue={campaign?.fromNumber ?? ""}
          help="Leave blank to use TELNYX_FROM_NUMBER or messaging profile pool."
        />
        <Row>
          <Select
            label={`Send window start (${APP_TZ})`}
            name="sendWindowStart"
            defaultValue={campaign?.sendWindowStart ?? "09:00"}
            options={hourOptions()}
          />
          <Select
            label={`Send window end (${APP_TZ})`}
            name="sendWindowEnd"
            defaultValue={campaign?.sendWindowEnd ?? "19:00"}
            options={hourOptions(true)}
          />
        </Row>
        <p className="-mt-2 text-xs text-zinc-500">
          Texts only go out between these hours. Outside the window, sends pause and resume automatically when it
          reopens.
        </p>
        <Field
          label="Schedule send (optional)"
          name="scheduledAt"
          type="datetime-local"
          defaultValue={campaign?.scheduledAt ? toLocalInput(campaign.scheduledAt) : ""}
          help={`Pick a date and time (${APP_TZ}) to start this campaign automatically. Leave blank to start it yourself with the Launch button. Sending still respects the send window above.`}
        />
        <Field
          label="LinkedIn Sales Navigator search link (optional)"
          name="salesNavUrl"
          placeholder="https://www.linkedin.com/sales/search/people?..."
          defaultValue={campaign?.salesNavUrl ?? ""}
          help="Paste the Sales Navigator search you used to build this list, so you can revisit exactly who you targeted."
        />
        <Select
          label="Target region (for the location fit check)"
          name="targetRegion"
          defaultValue={campaign?.targetRegion ?? ""}
          options={[
            { value: "", label: "Any / no region preference" },
            ...REGIONS.map((r) => ({ value: r.key, label: r.label })),
          ]}
        />
      </Card>

      {showContactUpload ? (
        <Card title="Contacts (optional — you can also add them later)">
          <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4">
            <label className="block">
              <span className="block text-xs font-medium text-zinc-700">Upload a CSV of contacts</span>
              <input
                type="file"
                name="csv"
                accept=".csv,text/csv"
                className="mt-2 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800"
              />
            </label>
            <label className="mt-3 flex items-start gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                name="validateMobile"
                defaultChecked
                className="mt-0.5 rounded border-zinc-300"
              />
              <span>
                <strong>Validate numbers and keep only mobile.</strong> Each number is checked through Telnyx; landlines
                and toll-free numbers are removed automatically so the list is clean and ready to send.
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                name="skipPreviouslyTexted"
                defaultChecked
                className="mt-0.5 rounded border-zinc-300"
              />
              <span>
                <strong>Skip people I&apos;ve already texted.</strong> Anyone you&apos;ve messaged in a previous campaign
                is left out so they aren&apos;t contacted twice. Uncheck to message them again.
              </span>
            </label>
            <p className="mt-2 text-xs text-zinc-500">
              The whole list uploads — you pick who to text afterward by fit score.{" "}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Recognized columns: first name, last name, company, job title, <strong>phone (required)</strong>, email,
              linkedin, location. Any other column becomes a custom merge field like <code>{`{your_column}`}</code>.
              Rows without a valid phone number are skipped.
            </p>
          </div>
        </Card>
      ) : null}

      <Card title="Position summary — what the AI uses to reply">
        <TextArea
          label="Position summary / job description"
          name="positionSummary"
          rows={12}
          defaultValue={campaign?.positionSummary ?? ""}
          help="Paste the full job description here. This is the only context the AI needs — it reads this to classify candidate replies and to draft responses, pulling out compensation, location, remote status, skills, company info, and selling points as needed."
        />
      </Card>

      <Card title="Recruiter / follow-up">
        <Row>
          <Field label="Recruiter name" name="recruiterName" defaultValue={campaign?.recruiterName ?? ""} />
          <Field label="Recruiter email" name="recruiterEmail" defaultValue={campaign?.recruiterEmail ?? ""} />
        </Row>
        <Field
          label="Calendar link"
          name="calendarLink"
          placeholder="https://cal.com/your-handle/intro"
          defaultValue={campaign?.calendarLink ?? ""}
        />
      </Card>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {submitLabel ?? "Save campaign"}
        </button>
      </div>
    </form>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  help,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      />
      {help ? <span className="mt-1 block text-xs text-zinc-500">{help}</span> : null}
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  required,
  rows = 2,
  help,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  rows?: number;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700">
        {label}
        {required ? " *" : ""}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        required={required}
        rows={rows}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      />
      {help ? <span className="mt-1 block text-xs text-zinc-500">{help}</span> : null}
    </label>
  );
}

function Select({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
