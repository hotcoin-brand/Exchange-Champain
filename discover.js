// 探测各交易所公告页 HTML 结构（v2：跟随重定向、多入口测试）
const https = require('https');
const fs = require('fs');

const TARGETS = [
  { name: 'okx', urls: [
    'https://www.okx.com/help/section/announcements-latest-announcements',
    'https://www.okx.com/en-us/help/section/announcements-latest-announcements',
  ]},
  { name: 'gate', urls: [
    'https://www.gate.com/zh/announcements/activity',
    'https://www.gate.io/zh/announcements/activity',
    'https://www.gate.com/announcements',
  ]},
  { name: 'hotcoin', urls: [
    'https://www.hotcoin.com/zh_CN/support/nav/2/?code=11675154291494913&id=11675154291494912',
  ]},
];

function fetch(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : require('http');
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const loc = new URL(res.headers.location, url).toString();
        console.log(`  redirect -> ${loc}`);
        return fetch(loc, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, finalUrl: url, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  for (const t of TARGETS) {
    for (const url of t.urls) {
      try {
        console.log(`\n=== ${t.name}: ${url} ===`);
        const res = await fetch(url);
        console.log(`status: ${res.status}, finalUrl: ${res.finalUrl}, length: ${res.body.length}`);
        const suffix = t.urls.length > 1 ? `-${t.urls.indexOf(url)}` : '';
        const file = `debug-${t.name}${suffix}.html`;
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
        fs.writeFileSync(`debug-${t.name}${suffix}-links.json`, JSON.stringify(links, null, 2));
        console.log(`sample links: ${links.length}`);
        links.slice(0, 5).forEach(l => console.log(`  - ${l.href} | ${l.text}`));
      } catch (e) {
        console.error(`${t.name} error:`, e.message);
      }
    }
  }
})();
