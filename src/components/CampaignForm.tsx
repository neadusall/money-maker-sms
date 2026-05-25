import type { Campaign } from "@/db/schema";

type Action = (formData: FormData) => Promise<void>;

const SAMPLE_TEMPLATE = `Hi {first_name}, reaching out about an opportunity that looks aligned with your background. Open to a quick chat?`;

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
          <Field
            label="Send window start (HH:MM, your TZ)"
            name="sendWindowStart"
            placeholder="09:00"
            defaultValue={campaign?.sendWindowStart ?? "09:00"}
            help="Sends outside this window are skipped. Set APP_TIMEZONE env var to your IANA TZ."
          />
          <Field
            label="Send window end (HH:MM, your TZ)"
            name="sendWindowEnd"
            placeholder="19:00"
            defaultValue={campaign?.sendWindowEnd ?? "19:00"}
          />
        </Row>
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
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
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
