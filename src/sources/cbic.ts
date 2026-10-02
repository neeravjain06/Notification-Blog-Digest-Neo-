import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";
import type { RawItem } from "../types.js";
import { clean, parseDate, UA } from "./common.js";

/**
 * CBIC Tax Information portal (taxinformation.cbic.gov.in/content-page/explore-notification).
 * The page is an Angular shell; rows come from this JSON API, already newest-first.
 * Without the anonymous homepage token every call is a 500 CoreException, not a 401.
 */
const BASE = "https://taxinformation.cbic.gov.in";
const CUSTOMS_TAX_ID = 1000002;

/**
 * The server omits its Sectigo intermediate, so Node rejects the chain (browsers fetch it
 * via AIA). Pinning that intermediate keeps full verification - never rejectUnauthorized:false.
 * ponytail: expires 2036-03-21, or sooner if CBIC changes CA - re-download from the leaf's AIA URL.
 */
const CA = [...tls.rootCertificates, fs.readFileSync(path.resolve("config", "cbic-intermediate.pem"), "utf8")];

function cbicJson<T>(url: string, method: "GET" | "POST", headers: Record<string, string> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, ca: CA, headers: { "User-Agent": UA, Accept: "application/json", ...headers }, timeout: 30_000 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error(`Non-JSON response for ${url}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout for ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

export type CbicCategory = "Tariff" | "Non Tariff" | "Anti Dumping Duty";

export type CbicRow = {
  id: number;
  notificationNo: string | null;
  notificationName: string | null;
  notificationDt: string | null;
};

export function mapCbicRow(row: CbicRow, category: CbicCategory, channel: string): RawItem {
  const name = clean(row.notificationName ?? "");
  const no = clean(row.notificationNo ?? "");
  // Corrigenda carry "Corrigendum" as the number; the notice they correct is in the subject.
  const sourceRef = /\d/.test(no) ? no : `${no || "Corrigendum"}: ${name}`;
  const date = parseDate(row.notificationDt ?? "");
  return {
    pipeline: "notifications",
    source: "cbic",
    channel,
    sourceRef,
    category,
    title: name,
    date,
    sourceUrl: `${BASE}/view-pdf/${row.id}/ENG/Notifications`,
    rawSubject: `${no} dated ${date} (${category}). ${name}`,
  };
}

export async function scrapeCbicCategory(category: CbicCategory, channel: string, limit = 15): Promise<RawItem[]> {
  const { id_token } = await cbicJson<{ id_token: string }>(`${BASE}/api/authenticate-token`, "POST");
  const headers = { Authorization1: `homeToken ${id_token}`, language: "en" };

  // `year` is a calendar year, so in January the recency window reaches into last year.
  const thisYear = new Date().getFullYear();
  const rows: CbicRow[] = [];
  for (const year of [thisYear, thisYear - 1]) {
    const qs = new URLSearchParams({
      year: String(year),
      page: "0",
      size: String(limit),
      taxId: String(CUSTOMS_TAX_ID),
      category,
    });
    rows.push(
      ...(await cbicJson<CbicRow[]>(
        `${BASE}/api/cbic-notification-msts/fetchNotificationByYearAndCategory?${qs}`,
        "GET",
        headers,
      )),
    );
  }

  return rows.slice(0, limit).map((r) => mapCbicRow(r, category, channel));
}
