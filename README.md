# 交易所公告 RSS 聚合

自动抓取多家交易所最新活动/公告并生成独立 RSS feed，供 Feedly 订阅。

当前覆盖：Binance.bh、Bybit、OKX、Hotcoin、Gate.io、MEXC。

## 部署步骤（5 分钟）

### 1. 创建 GitHub 仓库
- 登录 github.com
- 右上角 `+` → New repository
- 名字建议 `Exchange-Champain`，选 **Public**（Private 仓库 Feedly 抓不到）
- 勾 "Add a README file"，Create repository

### 2. 上传文件
在新仓库页面：
- 点 `Add file` → `Upload files`
- 把本文件夹下所有文件拖上去：
  - `generate.js`
  - `bybit-worker.js`
  - `.github/workflows/build.yml`
- 底部 `Commit changes`

### 3. 开启 Actions 写权限
- 仓库 `Settings` → 左侧 `Actions` → `General`
- `Workflow permissions` → 选 `Read and write permissions` → Save

### 4. 部署 Bybit Cloudflare Worker（必须，否则 Bybit feed 为空）
Bybit 对 GitHub Actions 的美国 IP 做了 CloudFront geo block，需要用一个 Cloudflare Worker 做反代。

1. 登录 [Cloudflare Workers](https://workers.cloudflare.com/)，Create a Service
2. 把 `bybit-worker.js` 的内容贴进去，Save & Deploy
3. 拿到 Worker URL（形如 `https://bybit-rss.你的子域.workers.dev`）
4. 回到 GitHub 仓库 → `Settings` → `Secrets and variables` → `Actions` → New repository secret
   - Name: `BYBIT_WORKER_URL`
   - Value: 你的 Worker URL

### 5. 手动触发第一次
- 顶部 `Actions` 标签 → 左侧 `Build RSS` → 右侧 `Run workflow`
- 等 1-2 分钟（首次要安装 Playwright 浏览器），刷新看到绿勾 ✅ 即成功
- 回仓库主页，会多出 `feed-*.xml` 文件

### 6. 拿到 RSS 链接
分别点每个 `feed-*.xml` → 右上角 **`Raw`** → 复制地址栏 URL，长这样：
```
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-binance.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-bybit.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-okx.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-hotcoin.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-gate.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-mexc.xml
```

**注意**：Feedly 里一定要粘贴 `raw.githubusercontent.com` 开头的链接，不要贴 `github.com/.../blob/...` 页面地址，否则 Feedly 会显示 "Build RSS feed" 而不是直接订阅。

### 7. 加进 Feedly
Feedly → Add Content → Follow sources → 分别粘贴上述 Raw 链接 → Follow。

建议按平台建不同 Folder，比如 `Competitors / Activities`。

## 更新频率

GitHub Actions 每 2 小时抓取一次（public 仓库免费额度足够）。

## 各平台说明

| 平台 | 数据源 | 状态 |
|---|---|---|
| Binance.bh | 公开 CMS API | 稳定 |
| Bybit | Cloudflare Worker 反代 `/v5/announcements/index` API | 依赖 Worker 部署 |
| OKX | 服务端渲染 HTML 中的 `appState` JSON | 稳定 |
| Hotcoin | 帮助中心服务端渲染 HTML | 稳定 |
| Gate.io | gate.com/gate.io HTML | **可能被 Akamai WAF 拦截**，已启用 Playwright 无头浏览器兜底 |
| MEXC | mexc.com HTML | **可能被 Akamai/WAF 拦截**，已启用 Playwright 无头浏览器兜底 |

## 调试方式

如果某个 feed 长期为空：
1. 打开仓库里的 `debug-平台.json`（如 `debug-gate.json`、`debug-mexc.json`）
2. 查看 status、bodyPreview、playwrightError 字段
3. 在 `generate.js` 里调整对应 `parse*Html` 函数的 selector/正则
4. 手动触发 Actions 重新跑

## 可选：增加更多分类

- Binance.bh 的 `catalogId=93` 是 Latest Activities；可改成 `48`（New Listing）、`49`（News）、`161`（Bahrain Activities）或复制 workflow 生成多个 feed。
- 其他交易所类似，修改 `generate.js` 对应函数即可。
