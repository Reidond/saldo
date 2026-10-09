import { type Proposal, proposalSchema } from "./domain.js";
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseInventoryCsv(text: string): Proposal[] {
  const [header, ...rows] = csvRows(text);
  if (!header || !header.includes("service"))
    throw new Error("CSV needs a service column");
  if (rows.length > 100) throw new Error("Import up to 100 rows at a time");
  return rows.map((r, i) => {
    const o = Object.fromEntries(
      header.map((h, n) => [h.trim(), r[n]?.trim() ?? ""]),
    );
    const warnings: string[] = [];
    const cadence =
      (
        {
          month: "monthly",
          monthly: "monthly",
          annual: "yearly",
          annually: "yearly",
          yearly: "yearly",
          weekly: "weekly",
          quarterly: "quarterly",
          "one-time": "one-time",
        } as Record<string, string>
      )[(o.cadence || "").toLowerCase()] ?? "unknown";
    const status = ["active", "trial", "paused", "cancelled"].includes(
      (o.status || "").toLowerCase(),
    )
      ? (o.status || "").toLowerCase()
      : "unknown";
    if (status === "unknown")
      warnings.push(`Original status: ${o.status || "not provided"}`);
    let amount: number | null = null;
    if (o.amount) {
      amount = Number(o.amount);
      if (!Number.isFinite(amount) || amount < 0)
        throw new Error(
          `Row ${i + 2}: invalid amount; use a number or leave blank`,
        );
    }
    const currency = (o.currency || "").toUpperCase() || "UNK";
    if (currency === "UNK")
      warnings.push(
        "Currency not provided. Excluded from currency totals until verified.",
      );
    if (!/^[A-Z]{3}$/.test(currency))
      throw new Error(`Row ${i + 2}: a three-letter currency is required`);
    const date = o.last_checked || o.evidence_date;
    const verified =
      date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
    const renewalDate =
      /renew/i.test(o.date_type) &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.next_or_end_date)
        ? o.next_or_end_date
        : null;
    if (o.next_or_end_date && !renewalDate)
      warnings.push(`Unclassified/end date: ${o.next_or_end_date}`);
    return proposalSchema.parse({
      id: crypto.randomUUID(),
      operation: "add",
      name: o.service,
      amount,
      currency,
      cadence,
      status,
      renewalDate,
      lastVerified: verified,
      category: "Other",
      source: o.source_urls || o.billing_provider || "CSV import",
      notes: [
        o.plan,
        o.notes,
        o.coverage,
        o.account ? `Account: ${o.account}` : "",
        o.confidence_in_classification
          ? `Classification confidence: ${o.confidence_in_classification}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      warnings,
    });
  });
}
