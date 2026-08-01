// Cloudflare Worker: Exchange RSS Proxy (Bybit + MEXC + Gate)
// /       → Bybit RSS
// /bybit  → Bybit RSS
// /mexc   → MEXC RSS
// /gate   → Gate RSS

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRss(title, link, description, items) {
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
    <title>${esc(title)}</title>
    <link>${esc(link)}</link>
    <description>${esc(description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemStr}
  </channel>
</rss>`;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchBybit() {
  const res = await fetch('https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20', {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.bybit.com', 'Referer': 'https://www.bybit.com/' },
  });
  if (!res.ok) throw new Error('Bybit API ' + res.status);
  const data = await res.json();
  const list = data.result?.list || [];
  return list.map(a => ({
    title: a.title,
    link: a.url || 'https://announcements.bybit.com/en-US/article/' + (a.slug || ''),
    pubDate: new Date(a.dateTimestamp || a.publishTime || Date.now()).toUTCString(),
    description: a.description || a.title,
  }));
}

async function fetchMexc() {
  function findItems(obj, depth) {
    if (!obj || depth > 15) return [];
    if (Array.isArray(obj)) {
      const valid = obj.filter(x => x && typeof x === 'object' && x.title && (x.id || x.articleId || x.link || x.url || x.jumpUrl));
      if (valid.length >= 3) return valid.slice(0, 30);
      return [];
    }
    if (typeof obj !== 'object') return [];
    for (const k of Object.keys(obj)) {
      const r = findItems(obj[k], depth + 1);
      if (r.length > 0) return r;
    }
    return [];
  }

  const pages = [
    'https://www.mexc.com/zh-TW/announcements/latest-events/ongoing',
    'https://www.mexc.com/announcements/latest-events/ongoing',
    'https://www.mexc.com/zh-TW/announcements/latest-events',
  ];

  for (const pageUrl of pages) {
    try {
      const res = await fetch(pageUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-TW,zh;q=0.9' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const html = await res.text();

      const nm = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nm) {
        try {
          const arr = findItems(JSON.parse(nm[1]), 0);
          if (arr.length > 0) {
            return arr.map(a => {
              let link = a.jumpUrl || a.link || a.url || '';
              if (!link.startsWith('http')) link = 'https://www.mexc.com' + (link.startsWith('/') ? link : '/zh-TW/announcements/' + (a.id || a.articleId || a.slug || ''));
              return { title: a.title || a.subject || a.name || 'MEXC', link, pubDate: new Date(a.createTime || a.publishTime || a.startTime || Date.now()).toUTCString(), description: a.brief || a.description || a.title || '' };
            });
          }
        } catch (e) {}
      }

      const sm = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/i);
      if (sm) {
        try {
          const arr = findItems(JSON.parse(sm[1]), 0);
          if (arr.length > 0) {
            return arr.map(a => ({
              title: a.title || a.subject || '',
              link: (a.link && a.link.startsWith('http')) ? a.link : 'https://www.mexc.com/zh-TW/announcements/' + (a.id || a.articleId || ''),
              pubDate: new Date(a.createTime || a.publishTime || Date.now()).toUTCString(),
              description: a.brief || a.title || '',
            }));
          }
        } catch (e) {}
      }

      const items = [];
      const seen = new Set();
      const re = /<a[^>]+href="([^"]*\/announcements\/(?!latest-events|all|new-listings|api-updates)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && items.length < 30) {
        const href = m[1];
        const t = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > 5 && !seen.has(href)) {
          seen.add(href);
          items.push({ title: t, link: href.startsWith('http') ? href : 'https://www.mexc.com' + href, pubDate: new Date().toUTCString(), description: t });
        }
      }
      if (items.length > 0) return items;
    } catch (e) {}
  }

  const apis = [
    'https://www.mexc.com/api/platform/spot/web/public/announcement/list?page=1&limit=20&language=zh_TW',
    'https://service.mexc.com/api/v1/private/activity/announcement/list?page=1&size=20',
  ];
  for (const apiUrl of apis) {
    try {
      const res = await fetch(apiUrl, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      const arr = findItems(data, 0);
      if (arr.length > 0) {
        return arr.map(a => ({
          title: a.title || a.subject || '',
          link: (a.link && a.link.startsWith('http')) ? a.link : 'https://www.mexc.com/zh-TW/announcements/' + (a.id || a.articleId || ''),
          pubDate: new Date(a.createTime || a.publishTime || Date.now()).toUTCString(),
          description: a.brief || a.title || '',
        }));
      }
    } catch (e) {}
  }

  return [];
}

async function fetchGate() {
  const apis = [
    'https://www.gate.com/api/v1/article/list?type=activity&page=1&limit=20&lang=zh',
    'https://www.gate.com/api/v2/article/list?type=activity&page=1&limit=20&lang=zh',
    'https://www.gate.com/api/v1/announcement/list?type=activity&page=1&limit=20',
    'https://www.gate.com/json/announcements/activity',
    'https://www.gate.com/api/v1/spot/article/list?page=1&limit=20&category=activity',
  ];

  for (const apiUrl of apis) {
    try {
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.gate.com/zh/announcements/activity' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) continue;
      const data = JSON.parse(text);

      function findArr(obj, depth) {
        if (!obj || depth > 10) return [];
        if (Array.isArray(obj)) {
          const valid = obj.filter(x => x && typeof x === 'object' && (x.title || x.subject) && (x.id || x.link || x.url || x.slug));
          if (valid.length >= 2) return valid.slice(0, 30);
          return [];
        }
        if (typeof obj !== 'object') return [];
        for (const k of Object.keys(obj)) {
          const r = findArr(obj[k], depth + 1);
          if (r.length > 0) return r;
        }
        return [];
      }

      const arr = findArr(data, 0);
      if (arr.length > 0) {
        return arr.map(a => ({
          title: a.title || a.subject || '',
          link: (a.link && a.link.startsWith('http')) ? a.link : (a.url && a.url.startsWith('http')) ? a.url : 'https://www.gate.com/zh/announcements/article/' + (a.id || a.slug || ''),
          pubDate: new Date(a.createTime || a.publishTime || a.date || Date.now()).toUTCString(),
          description: a.description || a.brief || a.title || '',
        }));
      }
    } catch (e) {}
  }

  const pages = [
    'https://www.gate.com/zh/announcements/activity',
    'https://www.gate.io/zh/announcements/activity',
  ];
  for (const pageUrl of pages) {
    try {
      const res = await fetch(pageUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const html = await res.text();
      const items = [];
      const seen = new Set();
      const re = /<a[^>]+href="([^"]*(?:announcement|article)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && items.length < 20) {
        const href = m[1];
        const t = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > 8 && !seen.has(href)) {
          seen.add(href);
          const origin = pageUrl.includes('gate.io') ? 'https://www.gate.io' : 'https://www.gate.com';
          const link = href.startsWith('http') ? href : (href.startsWith('/') ? origin + href : origin + '/' + href);
          items.push({ title: t, link, pubDate: new Date().toUTCString(), description: t });
        }
      }
      if (items.length > 0) return items;
    } catch (e) {}
  }

  return [];
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/bybit';

    const headers = {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=600',
    };

    try {
      if (path === '/mexc') {
        const items = await fetchMexc();
        return new Response(
          buildRss('MEXC 最新活动', 'https://www.mexc.com/zh-TW/announcements/latest-events/ongoing', 'MEXC Latest Events (Ongoing)', items),
          { status: 200, headers }
        );
      } else if (path === '/gate') {
        const items = await fetchGate();
        return new Response(
          buildRss('Gate.io 最新活动', 'https://www.gate.com/zh/announcements/activity', 'Gate.io Latest Activity Announcements', items),
          { status: 200, headers }
        );
      } else {
        const items = await fetchBybit();
        return new Response(
          buildRss('Bybit Announcements', 'https://announcements.bybit.global/zh-MY/?category=latest_activities&page=1', 'Bybit Latest Activities', items),
          { status: 200, headers }
        );
      }
    } catch (e) {
      return new Response(
        buildRss('Feed Error', url.href, 'Error: ' + e.message, []),
        { status: 200, headers }
      );
    }
  },
};
