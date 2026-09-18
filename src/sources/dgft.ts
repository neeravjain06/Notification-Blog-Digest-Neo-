import * as cheerio from "cheerio";
import type { RawItem } from "../types.js";
import { absUrl, clean, fetchText, isJunkTitle, parseDate } from "./common.js";

export type DgftCategory = 1 | 2 | 4;

const LABELS: Record<DgftCategory, string> = {
  1: "Notification",
  2: "Public Notice",
  4: "Trade Notice",
};

/**
 * DGFT CMS metadata tables, server-rendered via webHP. Endpoint shape and selectors
 * ported verbatim from the old scrape.ts. catId: 1=Notification, 2=Public Notice, 4=Trade Notice.
 *
 * NOTE the column order differs from CBIC: here td[1]=notice no, td[3]=subject, td[4]=date.
 */
export async function scrapeDgftCategory(
  catId: DgftCategory,
  channel: string,
  limit = 15,
): Promise<RawItem[]> {
  const url = `https://www.dgft.gov.in/CP/webHP?requestType=ApplicationRH&actionVal=serachMetadata&screenId=90000734&catId=${catId}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const out: RawItem[] = [];
  const label = LABELS[catId];

  $("#metaTable tbody tr, table#metaTable tr").each((_, tr) => {
    if (out.length >= limit) return;
    const tds = $(tr).find("td");
    if (tds.length < 5) return;

    const noticeNo = clean($(tds[1]).text());
    const subject = clean($(tds[3]).text()).replace(/^[\s:\u2013\u2014-]+/, "");
    const date = clean($(tds[4]).text());
    const link =
      $(tr).find("a.attachmentBtn[href], a[href*='content.dgft'], a[href*='.pdf']").first().attr("href") || url;

    if (!noticeNo || isJunkTitle(subject)) return;

    out.push({
      pipeline: "notifications",
      source: "dgft",
      channel,
      sourceRef: `${label} ${noticeNo}`,
      title: subject,
      date: parseDate(date),
      sourceUrl: absUrl("https://www.dgft.gov.in/", link),
      rawSubject: `${label} ${noticeNo} dated ${date}. ${subject}`,
    });
  });

  // Fallback: DGFT sometimes renders the same data without the #metaTable id.
  if (!out.length) {
    $("table tr").each((_, tr) => {
      if (out.length >= limit) return;
      const tds = $(tr).find("td");
      if (tds.length < 5) return;

      const noticeNo = clean($(tds[1]).text());
      const subject = clean($(tds[3]).text()).replace(/^[\s:\u2013\u2014-]+/, "");
      const date = clean($(tds[4]).text());
      const link = $(tr).find("a[href]").first().attr("href");

      if (!noticeNo || !subject || isJunkTitle(subject) || !link) return;
      if (!/\d/.test(noticeNo)) return;

      out.push({
        pipeline: "notifications",
        source: "dgft",
        channel,
        sourceRef: `${label} ${noticeNo}`,
        title: subject,
        date: parseDate(date),
        sourceUrl: absUrl("https://content.dgft.gov.in/", link),
        rawSubject: `${label} ${noticeNo} dated ${date}. ${subject}`,
      });
    });
  }

  return out;
}
