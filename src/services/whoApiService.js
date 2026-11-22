const feedTypes = {
  news: "news",
  diseaseOutbreaks: "outbreaks",
  emergencies: "outbreaks",
};

export class WHOApiService {
  async fetchRSSFeed(feedType, count = 10) {
    const type = feedTypes[feedType];
    if (!type) return [];
    const query = new URLSearchParams({ type, limit: String(Math.max(1, Math.min(50, count))) });
    const response = await fetch("/api/who?" + query);
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.items)) {
      throw new Error(data?.error || "WHO updates are temporarily unavailable.");
    }
    return data.items;
  }

  async fetchNews({ limit = 10, category = "", feedTypes: requested = ["news", "diseaseOutbreaks"] } = {}) {
    const unique = [...new Map(requested.filter(type => feedTypes[type]).map(type => [feedTypes[type], type])).values()];
    const feeds = await Promise.all(unique.map(type => this.fetchRSSFeed(type, limit)));
    const filter = category.toLowerCase();
    return [...new Map(feeds.flat().map(item => [item.id, item])).values()]
      .filter(item => !filter || [item.title, item.category].some(text => text.toLowerCase().includes(filter)))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, limit);
  }

  async searchWHO(query, { limit = 20, includeNews = true } = {}) {
    if (!includeNews || !query.trim()) return [];
    const term = query.trim().toLowerCase();
    return (await this.fetchNews({ limit: 50 }))
      .filter(item => [item.title, item.description].some(text => text.toLowerCase().includes(term)))
      .slice(0, limit);
  }

  getDiseaseOutbreaks({ limit = 10 } = {}) {
    return this.fetchRSSFeed("diseaseOutbreaks", limit);
  }

  getHealthEmergencies(limit = 10) {
    return this.getDiseaseOutbreaks({ limit });
  }

  getComprehensiveUpdates(options) {
    return this.fetchNews(options);
  }

  startMonitoring(callback, interval = 300000) {
    let seen = null;
    let running = false;
    let active = true;
    const checkForUpdates = async () => {
      if (running) return;
      running = true;
      try {
        const updates = await this.getDiseaseOutbreaks();
        const next = new Set(updates.map(update => update.id));
        if (active && seen) {
          const latest = updates.filter(update => !seen.has(update.id));
          if (latest.length) callback(latest);
        }
        seen = next;
      } catch {
        // The page's regular refresh already shows feed failures.
      } finally {
        running = false;
      }
    };
    checkForUpdates();
    const timer = setInterval(checkForUpdates, interval);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }
}

export const whoApiService = new WHOApiService();
export default WHOApiService;
