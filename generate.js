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
  // 优先使用 Cloudflare Worker 反代（绕过 GitHub Actions 美国 IP 被 CloudFront geo block 的问题）
  const workerUrl = process.env.BYBIT_WORKER_URL;
  if (workerUrl) {
    try {
      const res = await httpGet(workerUrl);
      if (res.status === 200 && res.body.includes('<item>')) {
        fs.writeFileSync('feed-bybit.xml', res.body);
        console.log('[Bybit] fetched from worker');
        return;
      }
    } catch (e) {
      console.error('[Bybit] worker fetch failed:', e.message);
    }
  }

  // 本地/Actions 直接请求（大概率会失败，仅作兜底）
  const candidates = [
    'https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20',
    'https://api.bybit.com/v5/announcements/index?locale=zh-CN&limit=20',
  ];

  for (const url of candidates) {
    let res;
    try {
      res = await httpGet(url, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://www.bybit.com',
          'Referer': 'https://www.bybit.com/',
        },
      });
    } catch (e) {
      fs.writeFileSync('debug-bybit.json', JSON.stringify({ url, error: e.message, timestamp: new Date().toISOString() }, null, 2));
      continue;
    }

    fs.writeFileSync('debug-bybit.json', JSON.stringify({
      url,
      status: res.status,
      bodyPreview: res.body.slice(0, 1000),
      timestamp: new Date().toISOString(),
    }, null, 2));

    if (res.status !== 200 || !res.body.trim().startsWith('{')) continue;

    try {
      const json = JSON.parse(res.body);
      const list = json.result?.list || [];
      if (!list.length) continue;

      const items = list.map(a => ({
        title: a.title,
        link: a.url,
        pubDate: new Date(a.dateTimestamp || a.publishTime).toUTCString(),
      }));
      fs.writeFileSync('feed-bybit.xml', buildRss('Bybit Announcements', 'https://announcements.bybit.com/en/', 'Bybit Latest Announcements', items));
      console.log(`[Bybit] ${items.length} items`);
      return;
    } catch (e) {
      console.error('[Bybit] parse error:', e.message);
    }
  }

  fs.writeFileSync('feed-bybit.xml', buildRss('Bybit Announcements (fetch failed)', 'https://announcements.bybit.com/en/', 'Bybit API blocked by CloudFront geo restriction. Deploy the Cloudflare Worker in bybit-worker.js and set BYBIT_WORKER_URL.', []));
  console.log('[Bybit] fetch failed, deploy Cloudflare Worker');
}

async function generateOKX() {
  const url = 'https://www.okx.com/zh-hans/help/section/latest-events';
  const res = await httpGet(url);
  const html = res.body;

  // 从 SSR 的 appState JSON 中提取公告列表
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

async function fetchWithPlaywrightFallback(urls, parseFn, debugPath, feedPath, feedMeta) {
  // 先尝试普通 HTTP
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

  // 普通请求失败，尝试 Playwright
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

function parseMexcHtml(html, baseUrl) {
  const items = [];
  const seen = new Set();
  const origin = 'https://www.mexc.com';

  // 策略 1：从页面内嵌 JSON（Next.js / Nuxt / 自定义）提取公告列表
  const jsonCandidates = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/i,
    /window\.__DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/i,
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*>\s*({[\s\S]*?"announcements"[\s\S]*?})\s*<\/script>/i,
  ];
  for (const pattern of jsonCandidates) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const list = findArrayByKey(data, ['announcements', 'articleList', 'list', 'items', 'data']);
        if (list && list.length) {
          for (const a of list) {
            const title = a.title || a.subject || a.name;
            const href = a.link || a.url || a.slug || a.id;
            if (title && href && !seen.has(href)) {
              seen.add(href);
              const link = href.startsWith('http') ? href : (href.startsWith('/') ? origin + href : `${origin}/announcements/${href}`);
              items.push({ title, link, pubDate: new Date(a.publishTime || a.createTime || a.date || Date.now()).toUTCString() });
            }
            if (items.length >= 30) break;
          }
          if (items.length > 0) return items;
        }
      } catch (e) {
        // ignore parse errors
      }
    }
  }

  // 策略 2：匹配 a[href*="/announcements/"] 及其附近文本
  const regex = /<a[^>]+href=["']([^"']*\/announcements\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) && items.length < 30) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length > 5 && !seen.has(href)) {
      seen.add(href);
      const link = href.startsWith('http') ? href : origin + href;
      items.push({ title, link, pubDate: new Date().toUTCString() });
    }
  }

  // 策略 3：匹配列表项结构
  if (items.length === 0) {
    const regex2 = /<(?:article|div|li)[^>]*>[\s\S]*?<h[\d][^>]*>([\s\S]*?)<\/h[\d]>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<\/(?:article|div|li)>/gi;
    while ((m = regex2.exec(html)) && items.length < 30) {
      const title = m[1].replace(/<[^>]+>/g, '').trim();
      const href = m[2];
      if (title.length > 5 && !seen.has(href)) {
        seen.add(href);
        const link = href.startsWith('http') ? href : origin + href;
        items.push({ title, link, pubDate: new Date().toUTCString() });
      }
    }
  }

  return items;
}

// 在嵌套对象中按候选 key 找数组
function findArrayByKey(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (Array.isArray(obj[key]) && obj[key].length) return obj[key];
  }
  for (const k of Object.keys(obj)) {
    const found = findArrayByKey(obj[k], keys);
    if (found) return found;
  }
  return null;
}

async function generateMexc() {
  await fetchWithPlaywrightFallback(
    [
      { url: 'https://www.mexc.com/zh-TW/announcements/latest-events' },
      { url: 'https://www.mexc.com/announcements/latest-events
第三条' },
    ],
    parseMexcHtml,
    'debug-mexc.json',
    'feed-mexc.xml',
    { name: 'MEXC', title: 'MEXC 最新活动', description: 'MEXC Latest Event' }
  );
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
