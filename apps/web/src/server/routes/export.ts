import "server-only";
import type { Subscription } from "@saldo/domain";
import { errorMessage, isApiError } from "../api";
import { getRequestContext } from "../context";
import { baseHeaders } from "../http";
import { todayIn } from "../../lib/format";

/** CSV columns match the importer, so an export can be imported again. */
const csvColumns = [
  "service",
  "amount",
  "currency",
  "cadence",
  "status",
  "next_or_end_date",
  "date_type",
  "category",
  "source_urls",
  "last_checked",
  "notes",
] as const;

function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(items: Subscription[]) {
  const rows = items.map((s) =>
    [
      s.name,
      s.amount === null ? "" : String(s.amount),
      s.currency,
      s.cadence,
      s.status,
      s.renewalDate ?? "",
      s.renewalDate ? "renewal" : "",
      s.category,
      s.source,
      s.lastVerified ?? "",
      s.notes,
    ].map(csvField),
  );
  return [csvColumns.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/** GET /settings/export.json and /settings/export.csv: the owner's records. */
export async function handleExport(request: Request, url: URL) {
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const format = url.pathname.endsWith(".csv")
    ? "csv"
    : url.pathname.endsWith(".json")
      ? "json"
      : null;
  if (!format) return new Response("Not found", { status: 404 });
  const { load, preferences } = getRequestContext();
  let items: Subscription[];
  try {
    items = await load.subscriptions();
  } catch (error) {
    return new Response(errorMessage(error), {
      status: isApiError(error) && error.code === "unauthenticated" ? 401 : 502,
      headers: baseHeaders("text/plain; charset=utf-8"),
    });
  }
  const date = todayIn(preferences.timeZone);
  const headers = baseHeaders(
    format === "csv"
      ? "text/csv; charset=utf-8"
      : "application/json; charset=utf-8",
  );
  headers.set(
    "Content-Disposition",
    `attachment; filename="saldo-subscriptions-${date}.${format}"`,
  );
  const body =
    format === "csv"
      ? `﻿${toCsv(items)}`
      : JSON.stringify(
          { exportedAt: new Date().toISOString(), subscriptions: items },
          null,
          2,
        );
  return new Response(body, { headers });
}
