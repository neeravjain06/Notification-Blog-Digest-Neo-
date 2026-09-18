import * as cheerio from "cheerio";
import type { RawItem, RssSource } from "../types.js";
import { clean, fetchText, parseDate } from "./common.js";

/**
 * RSS and Atom both being XML, cheerio in xml mode reads them without another dependency.
 * Handles the two element namings: RSS <item><link>text</link>, Atom <entry><link href="">.
 */
export async function scrapeRssFeed(src: RssSource, limit = 15): Promise<RawItem[]> {
  const xml = await fetchText(src.url);
  const $ = cheerio.load(xml, { xml: true });
  const out: RawItem[] = [];

  $("item, entry").each((_, el) => {
    if (out.length >= limit) return;
    const node = $(el);

    const title = clean(node.find("title").first().text());
    const linkEl = node.find("link").first();
    const url = clean(linkEl.text()) || linkEl.attr("href") || "";
    const date = clean(
      node.find("pubDate").first().text() ||
        node.find("published").first().text() ||
        node.find("updated").first().text(),
    );
    const summary = clean(
      node.find("description").first().text() || node.find("summary").first().text(),
    );

    if (!title || !url) return;

    out.push({
      pipeline: "news",
      source: "rss",
      channel: `rss-${src.id}`,
      // URL is the identity of a news article - there is no notice number.
      sourceRef: url,
      title,
      date: parseDate(date),
      sourceUrl: url,
      rawSubject: summary ? `${title}. ${summary}` : title,
      bodyText: summary || undefined,
    });
  });

  return out;
}
