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

async function playwrightFetch(url, opts = {}) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    throw new Error('playwright not installed');
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: opts.locale || 'zh-CN',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 20000 }).catch(() => {});
    }
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
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
  try {
    const res = await httpGet('https://bybit-rss.siri-f5e.workers.dev/');
    if (res.status === 200 && res.body.includes('<item>')) {
      fs.writeFileSync('feed-bybit.xml', res.body);
      console.log('[Bybit] OK from worker');
      return;
    }
    console.log('[Bybit] worker returned no items, status:', res.status);
  } catch (e) {
    console.error('[Bybit] worker fetch failed:', e.message);
  }
  fs.writeFileSync('feed-bybit.xml', buildRss('Bybit Announcements', 'https://announcements.bybit.global/zh-MY/?category=latest_activities&page=1', 'Bybit Latest Activities', []));
  console.log('[Bybit] fetch failed');
}

async function generateOKX() {
  const url = 'https://www.okx.com/zh-hans/help/section/latest-events';
  const res = await httpGet(url);
  const html = res.body;

  const match = html.match(/<script[^>]*id="appState"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('OKX appState not found');
  const data = JSON.parse(match[1]);
  const list = data.appContext?.initialProps?.sectionData?.articleList?.list || [];

  const items = list.map(a => ({
    title: a.title,
    link: `https://www.okx.com/zh-hans/help/notice/${a.slug}`,
    pubDate: new Date(a.publishTime).toUTCString(),
  }));
  fs.writeFileSync('feed-okx.xml', buildRss('OKX 最新活动', url, 'OKX 最新活动中心公告', items));
  console.log(`[OKX] ${items.length} items`);
}

async function generateHotcoin() {
  const url = 'https://www.hotcoin.com/zh_CN/support/nav/2/?code=11675154291494913&id=11675154291494912';
  const res = await httpGet(url);
  const html = res.body;

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

async function fetchWithPlaywrightFallback(urls, parseFn, debugPath, feedPath, feedMeta) {
  const debug = [];
  for (const candidate of urls) {
    try {
      const res = await httpGet(candidate.url, candidate.opts || {});
      debug.push({ url: candidate.url, status: res.status, bodyLength: res.body.length, bodyPreview: res.body.slice(0, 300) });
      if (res.status === 200 && res.body.length > 5000) {
        const items = parseFn(res.body, candidate.url);
        if (items.length > 0) {
          fs.writeFileSync(feedPath, buildRss(feedMeta.title, candidate.url, feedMeta.description, items));
          console.log(`[${feedMeta.name}] ${items.length} items via HTTP`);
          return;
        }
      }
    } catch (e) {
      debug.push({ url: candidate.url, error: e.message });
    }
  }

  for (const candidate of urls) {
    try {
      const html = await playwrightFetch(candidate.url, candidate.playwrightOpts || {});
      const items = parseFn(html, candidate.url);
      if (items.length > 0) {
        fs.writeFileSync(feedPath, buildRss(feedMeta.title, candidate.url, feedMeta.description, items));
        console.log(`[${feedMeta.name}] ${items.length} items via Playwright`);
        return;
      }
    } catch (e) {
      debug.push({ url: candidate.url, playwrightError: e.message });
    }
  }

  fs.writeFileSync(debugPath, JSON.stringify({ debug, timestamp: new Date().toISOString() }, null, 2));
  fs.writeFileSync(feedPath, buildRss(`${feedMeta.title} (fetch failed)`, urls[0].url, `${feedMeta.description}. Needs Playwright or proxy.`, []));
  console.log(`[${feedMeta.name}] fetch failed, see ${debugPath}`);
}

function parseGateHtml(html, baseUrl) {
  const origin = baseUrl.startsWith('https://www.gate.io') ? 'https://www.gate.io' : 'https://www.gate.com';
  const items = [];
  const regex = /<a[^>]+href=["']([^"']*(?:\/announcements\/article|articlelist)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) && items.length < 20) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length > 8) {
      const link = href.startsWith('http') ? href : (href.startsWith('/') ? origin + href : origin + '/' + href);
      items.push({ title, link, pubDate: new Date().toUTCString() });
    }
  }
  return items;
}

async function generateGate() {
  await fetchWithPlaywrightFallback(
    [
      { url: 'https://www.gate.com/zh/announcements/activity' },
      { url: 'https://www.gate.io/zh/announcements/activity' },
      { url: 'https://www.gate.com/zh/announcements' },
    ],
    parseGateHtml,
    'debug-gate.json',
    'feed-gate.xml',
    { name: 'Gate', title: 'Gate.io Announcements', description: 'Gate.io Latest Announcements' }
  );
}

async function generateMexc() {
  try {
    const res = await httpGet('https://bybit-rss.siri-f5e.workers.dev/mexc');
    if (res.status === 200 && res.body.includes('<item>')) {
      fs.writeFileSync('feed-mexc.xml', res.body);
      console.log('[MEXC] OK from worker');
      return;
    }
    console.log('[MEXC] worker returned no items, status:', res.status);
  } catch (e) {
    console.error('[MEXC] worker fetch failed:', e.message);
  }
  fs.writeFileSync('feed-mexc.xml', buildRss('MEXC 最新活动', 'https://www.mexc.com/zh-TW/announcements/latest-events/ongoing', 'MEXC Latest Events', []));
  console.log('[MEXC] fetch failed');
}

(async () => {
  const tasks = [
    generateBinance,
    generateBybit,
    generateOKX,
    generateHotcoin,
    generateGate,
    generateMexc,
  ];
  for (const task of tasks) {
    try {
      await task();
    } catch (e) {
      console.error(`[${task.name}] failed:`, e.message);
    }
  }
})();
