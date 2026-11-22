const WHO = "https://www.who.int";
const feeds = {
  news: { collection: "newsitems", path: "/news/item/", category: "WHO News", fields: "ThumbnailUrl" },
  outbreaks: {
    collection: "diseaseoutbreaknews",
    path: "/emergencies/disease-outbreak-news/item/",
    category: "Emergency Alert",
    fields: "Summary",
  },
};

function plainText(html = "") {
  return String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const type = req.query?.type || "news";
  const limit = Number(req.query?.limit || 10);
  if (!Object.hasOwn(feeds, type) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return res.status(400).json({ error: "Choose a valid WHO feed and request 1 to 50 items." });
  }
  const feed = feeds[type];
  try {
    const url = new URL("/api/news/" + feed.collection, WHO);
    url.searchParams.set("$top", String(limit));
    url.searchParams.set("$orderby", "PublicationDateAndTime desc");
    url.searchParams.set("$select", "Title,PublicationDateAndTime,ItemDefaultUrl,UrlName," + feed.fields);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("WHO feed unavailable");
    const { value } = await response.json();
    if (!Array.isArray(value)) throw new Error("Unexpected WHO feed");

    const items = value.filter(item => item.Title && (item.ItemDefaultUrl || item.UrlName)).map(item => {
      const slug = String(item.ItemDefaultUrl || item.UrlName).replace(/^\/+/, "");
      const description = plainText(item.Summary);
      return {
        id: type + "/" + slug,
        title: plainText(item.Title),
        date: item.PublicationDateAndTime,
        description,
        summary: description.length > 240 ? description.slice(0, 237) + "..." : description,
        url: WHO + feed.path + slug,
        category: feed.category,
        feedType: type === "outbreaks" ? "diseaseOutbreaks" : "news",
        author: "WHO",
        ...(item.ThumbnailUrl && /^https:\/\//i.test(item.ThumbnailUrl) ? { image: item.ThumbnailUrl } : {}),
      };
    });
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ items });
  } catch {
    return res.status(502).json({ error: "WHO updates are temporarily unavailable. Please try again." });
  }
}
