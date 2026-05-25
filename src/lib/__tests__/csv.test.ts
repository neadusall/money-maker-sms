import { describe, it, expect } from "vitest";
import { parseCsv } from "../csv";

describe("parseCsv", () => {
  it("maps standard headers and treats unknowns as custom fields", () => {
    const csv = `First Name,Last Name,Company,Phone,Job Title,Email,Seniority\nAlex,Doe,Acme,4155552671,Engineer,alex@acme.test,Senior`;
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.firstName).toBe("Alex");
    expect(row.lastName).toBe("Doe");
    expect(row.company).toBe("Acme");
    expect(row.phone).toBe("+14155552671");
    expect(row.jobTitle).toBe("Engineer");
    expect(row.email).toBe("alex@acme.test");
    expect(row.customFields.seniority).toBe("Senior");
  });

  it("skips rows missing a phone", () => {
    const csv = `first_name,phone\nAlex,\nJamie,2125551212`;
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].firstName).toBe("Jamie");
    expect(result.skipped).toHaveLength(1);
  });

  it("skips rows with invalid phone", () => {
    const csv = `first_name,phone\nAlex,not-a-phone`;
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("invalid phone");
  });

  it("normalizes phone variants to E.164", () => {
    const csv = `first_name,phone\nA,4155552671\nB,(212) 555-1212\nC,+13105550100`;
    const result = parseCsv(csv);
    expect(result.rows.map((r) => r.phone)).toEqual([
      "+14155552671",
      "+12125551212",
      "+13105550100",
    ]);
  });

  it("accepts alternate column names (mobile, cell)", () => {
    const csv = `First name,Mobile\nAlex,4155551212`;
    const result = parseCsv(csv);
    expect(result.rows[0].firstName).toBe("Alex");
    expect(result.rows[0].phone).toBe("+14155551212");
  });
});
