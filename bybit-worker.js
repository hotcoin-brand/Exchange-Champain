// Cloudflare Worker: Bybit Announcements RSS Proxy
// 部署后把 Worker URL 填到 GitHub Actions 的 BYBIT_WORKER_URL secret 里
// 或者直接让 Feedly 订阅 Worker URL

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchBybit() {
  const url = 'https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.bybit.com',
      'Referer': 'https://www.bybit.com/',
    },
    cf: {
      // 尝试绕过可能存在的 CDN 缓存问题
      cacheTtl: 0,
    },
  });
  if (!res.ok) throw new Error(`Bybit API ${res.status}`);
  return await res.json();
}

function buildRss(items) {
  const itemStr = items.map(i => `    <item>
      <title>${esc(i.title)}</title>
      <link>${i.link}</link>
      <guid isPermaLink="true">${i.link}</guid>
      <pubDate>${i.pubDate}</pubDate>
      <description>${esc(i.description || i.title)}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Bybit Announcements</title>
    <link>https://announcements.bybit.com/en/</link>
    <description>Bybit Latest Announcements</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemStr}
  </channel>
</rss>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 简单 CORS
    const headers = {
      'Content-Type': 'application/xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=300',
    };

    try {
      const data = await fetchBybit();
      const list = data.result?.list || [];
      const items = list.map(a => ({
        title: a.title,
        link: a.url,
        pubDate: new Date(a.dateTimestamp || a.publishTime).toUTCString(),
        description: a.description || a.title,
      }));
      const rss = buildRss(items);
      return new Response(rss, { status: 200, headers });
    } catch (e) {
      const emptyRss = buildRss([]);
      return new Response(emptyRss, { status: 200, headers });
    }
  },
};
