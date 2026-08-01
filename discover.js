// 探测各交易所公告页 HTML 结构
const https = require('https');
const fs = require('fs');

const TARGETS = [
  { name: 'okx', url: 'https://www.okx.com/help/section/announcements-latest-announcements' },
  { name: 'gate', url: 'https://www.gate.com/zh/announcements/activity' },
  { name: 'hotcoin', url: 'https://www.hotcoin.com/zh_CN/support/nav/2/?code=11675154291494913&id=11675154291494912' },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : require('http');
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  for (const t of TARGETS) {
    try {
      console.log(`\n=== ${t.name}: ${t.url} ===`);
      const res = await fetch(t.url);
      console.log(`status: ${res.status}, length: ${res.body.length}`);
      const file = `debug-${t.name}.html`;
      fs.writeFileSync(file, res.body);
      console.log(`saved to ${file}`);

      const links = [];
      const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = regex.exec(res.body)) && links.length < 30) {
        const href = m[1];
        const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 5) links.push({ href, text: text.slice(0, 120) });
      }
      fs.writeFileSync(`debug-${t.name}-links.json`, JSON.stringify(links, null, 2));
      console.log(`sample links: ${links.length}`);
      links.slice(0, 5).forEach(l => console.log(`  - ${l.href} | ${l.text}`));
    } catch (e) {
      console.error(`${t.name} error:`, e.message);
    }
  }
})();
