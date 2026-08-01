// 抓取 Binance.bh 公告并生成 RSS
const https = require('https');
const fs = require('fs');

const API = 'https://www.binance.bh/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId=93';
const SITE = 'https://www.binance.bh/en/support/announcement/list/93';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

(async () => {
  const json = await fetchJson(API);
  const articles = json.data.catalogs[0].articles;

  const items = articles.map(a => {
    const url = `https://www.binance.bh/en/support/announcement/${a.code}`;
    const date = new Date(a.releaseDate).toUTCString();
    return `    <item>
      <title>${esc(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${date}</pubDate>
      <description>${esc(a.title)}</description>
    </item>`;
  }).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Binance.bh Latest Activities</title>
    <link>${SITE}</link>
    <description>Binance Bahrain - Latest Activities (catalogId=93)</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  fs.writeFileSync('feed.xml', rss);
  console.log(`Generated feed.xml with ${articles.length} items`);
})();
