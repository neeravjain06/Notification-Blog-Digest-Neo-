import * as cheerio from "cheerio";
import type { RawItem } from "../types.js";
import { absUrl, clean, fetchText, parseDate } from "./common.js";

/**
 * CBIC ECCS courier tables. Selectors and column indices ported verbatim from
 * neo-cha-assistant/notifications-digest/src/scrape.ts - these are hard-won.
 * Layout: td[1]=notice no, td[2]=date, td[4]=subject, link in the last td.
 */
function parseEccsTable(html: string, pageUrl: string, rowSelector: string, channel: string, limit: number): RawItem[] {
  const $ = cheerio.load(html);
  const out: RawItem[] = [];

  $(rowSelector).each((_, tr) => {
    if (out.length >= limit) return;
    const tds = $(tr).find("td");
    if (tds.length < 5) return;

    const noticeNo = clean($(tds[1]).text());
    const date = clean($(tds[2]).text());
    const subject = clean($(tds[4]).text());
    const link =
      $(tds[tds.length - 1]).find("a[href]").first().attr("href") ||
      $(tr).find("a[href]").first().attr("href") ||
      pageUrl;

    if (!noticeNo) return;
    const sourceUrl = absUrl(pageUrl, link);

    out.push({
      pipeline: "notifications",
      source: "cbic",
      channel,
      sourceRef: noticeNo,
      title: subject,
      date: parseDate(date),
      sourceUrl,
      rawSubject: `${noticeNo}. ${subject}`,
    });
  });

  return out;
}

export async function scrapeCbicNotifications(limit = 20): Promise<RawItem[]> {
  const url = "https://courier.cbic.gov.in/notification.jsp";
  const html = await fetchText(url);
  return parseEccsTable(
    html,
    url,
    "#notification_table tbody tr, table.notification tbody tr",
    "cbic-eccs-notifications",
    limit,
  );
}

export async function scrapeCbicCirculars(limit = 12): Promise<RawItem[]> {
  const url = "https://courier.cbic.gov.in/circular.jsp";
  const html = await fetchText(url);
  return parseEccsTable(html, url, "table tbody tr", "cbic-eccs-circulars", limit);
}
