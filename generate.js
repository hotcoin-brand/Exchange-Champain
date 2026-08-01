// 生成多家交易所公告 RSS
const https = require('https');
const fs = require('fs');

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : require('http');
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/',
        ...(opts.headers || {}),
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (opts.followRedirects ?? true) && (opts.maxRedirects ?? 3) > 0) {
        const loc = new URL(res.headers.location, url).toString();
        return httpGet(loc, { ...opts, maxRedirects: (opts.maxRedirects ?? 3) - 1 }).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
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
    <link>${link}</link>
    <description>${esc(description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemStr}
  </channel>
</rss>`;
}

async function generateBinance() {
  const url = 'https://www.binance.bh/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId=93';
  const json = JSON.parse((await httpGet(url)).body);
  const articles = json.data.catalogs[0].articles;
  const items = articles.map(a => ({
    title: a.title,
    link: `https://www.binance.bh/en/support/announcement/${a.code}`,
    pubDate: new Date(a.releaseDate).toUTCString(),
  }));
  const rss = buildRss('Binance.bh Latest Activities', 'https://www.binance.bh/en/support/announcement/list/93', 'Binance Bahrain - Latest Activities', items);
  fs.writeFileSync('feed-binance.xml', rss);
  fs.writeFileSync('feed.xml', rss); // 兼容旧订阅
  console.log(`[Binance] ${items.length} items`);
}

async function generateBybit() {
  const url = 'https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20';
  const json = JSON.parse((await httpGet(url)).body);
  const list = json.result.list || [];
  const items = list.map(a => ({
    title: a.title,
    link: a.url,
    pubDate: new Date(a.dateTimestamp).toUTCString(),
  }));
  fs.writeFileSync('feed-bybit.xml', buildRss('Bybit Announcements', 'https://announcements.bybit.com/en/', 'Bybit Latest Announcements', items));
  console.log(`[Bybit] ${items.length} items`);
}

async function generateOKX() {
  const url = 'https://www.okx.com/help/section/announcements-latest-announcements';
  const res = await httpGet(url);
  const html = res.body;

  // 从 SSR 的 appState JSON 中提取公告列表
  const match = html.match(/<script[^>]*id="appState"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('OKX appState not found');
  const data = JSON.parse(match[1]);
  const list = data.appContext?.initialProps?.sectionData?.articleList?.list || [];

  const items = list.map(a => ({
    title: a.title,
    link: `https://www.okx.com/help/notice/${a.slug}`,
    pubDate: new Date(a.publishTime).toUTCString(),
  }));
  fs.writeFileSync('feed-okx.xml', buildRss('OKX Latest Announcements', 'https://www.okx.com/help/section/announcements-latest-announcements', 'OKX Latest Announcements', items));
  console.log(`[OKX] ${items.length} items`);
}

async function generateHotcoin() {
  const url = 'https://www.hotcoin.com/zh_CN/support/nav/2/?code=11675154291494913&id=11675154291494912';
  const res = await httpGet(url);
  const html = res.body;

  // 直接解析 HTML 中的 .textList 区块
  const items = [];
  const regex = /<div[^>]*textList[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<\/a>[\s\S]*?<div[^>]*>([\d]{4}-[\d]{2}-[\d]{2})<\/div>[\s\S]*?<\/div>/gi;
  let m;
  while ((m = regex.exec(html)) && items.length < 30) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const date = m[3];
    const link = href.startsWith('http') ? href : `https://www.hotcoin.com${href}`;
    items.push({
      title,
      link,
      pubDate: new Date(`${date}T00:00:00Z`).toUTCString(),
    });
  }

  // 如果 HTML 解析失败，尝试内嵌 JSON
  if (items.length === 0) {
    const jsonMatch = html.match(/catalogList:(\[[\s\S]*?\]),/);
    if (jsonMatch) {
      const list = JSON.parse(jsonMatch[1]);
      list.filter(i => i.type === 'text').forEach(i => {
        items.push({
          title: i.title,
          link: `https://www.hotcoin.com/zh_CN/support/notice/${i.slug}/`,
          pubDate: new Date().toUTCString(),
        });
      });
    }
  }

  fs.writeFileSync('feed-hotcoin.xml', buildRss('Hotcoin 最新活动', url, 'Hotcoin 最新活动公告', items));
  console.log(`[Hotcoin] ${items.length} items`);
}

async function generateGate() {
  const urls = [
    'https://www.gate.com/zh/announcements/activity',
    'https://www.gate.io/zh/announcements/activity',
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await httpGet(url, { followRedirects: true, maxRedirects: 2 });
      if (res.status !== 200 || res.body.length < 5000) continue;

      // 简单提取文章链接
      const items = [];
      const regex = /<a[^>]+href=["']([^"']*(?:announcements\/article|articlelist)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = regex.exec(res.body)) && items.length < 20) {
        const href = m[1];
        const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (title.length > 8) {
          items.push({ title, link: href.startsWith('http') ? href : `https://www.gate.com${href}`, pubDate: new Date().toUTCString() });
        }
      }

      if (items.length > 0) {
        fs.writeFileSync('feed-gate.xml', buildRss('Gate.io Announcements', 'https://www.gate.com/zh/announcements/activity', 'Gate.io Latest Announcements', items));
        console.log(`[Gate] ${items.length} items`);
        return;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  // 如果都失败，生成空 feed 占位
  fs.writeFileSync('feed-gate.xml', buildRss('Gate.io Announcements (fetch failed - needs Playwright)', 'https://www.gate.com/zh/announcements/activity', `Gate.io blocked automated access. Last error: ${lastErr?.message || 'empty response'}`, []));
  console.log(`[Gate] fetch failed - ${lastErr?.message || 'blocked'}`);
}

(async () => {
  const tasks = [
    generateBinance,
    generateBybit,
    generateOKX,
    generateHotcoin,
    generateGate,
  ];
  for (const task of tasks) {
    try {
      await task();
    } catch (e) {
      console.error(`[${task.name}] failed:`, e.message);
    }
  }
})();
