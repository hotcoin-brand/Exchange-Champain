# 交易所公告 RSS 聚合

自动抓取多家交易所最新活动/公告并生成独立 RSS feed，供 Feedly 订阅。

当前覆盖：Binance.bh、Bybit、OKX、Hotcoin、Gate.io。

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
  - `.github/workflows/build.yml`
- 底部 `Commit changes`

### 3. 开启 Actions 写权限
- 仓库 `Settings` → 左侧 `Actions` → `General`
- `Workflow permissions` → 选 `Read and write permissions` → Save

### 4. 手动触发第一次
- 顶部 `Actions` 标签 → 左侧 `Build RSS` → 右侧 `Run workflow`
- 等 30 秒，刷新看到绿勾 ✅ 即成功
- 回仓库主页，会多出 `feed-*.xml` 文件

### 5. 拿到 RSS 链接
分别点每个 `feed-*.xml` → 右上角 `Raw` → 复制地址栏 URL，长这样：
```
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-binance.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-bybit.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-okx.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-hotcoin.xml
https://raw.githubusercontent.com/你的用户名/仓库名/main/feed-gate.xml
```

### 6. 加进 Feedly
Feedly → Add Content → Follow sources → 分别粘贴上述链接 → Follow。

建议按平台建不同 Folder，比如 `Competitors / Activities`。

## 更新频率

GitHub Actions 每 2 小时抓取一次（public 仓库免费额度足够）。

## 各平台说明

| 平台 | 数据源 | 状态 |
|---|---|---|
| Binance.bh | 公开 CMS API | 稳定 |
| Bybit | `/v5/announcements/index` API | 稳定 |
| OKX | 服务端渲染 HTML 中的 `appState` JSON | 稳定 |
| Hotcoin | 帮助中心服务端渲染 HTML | 稳定 |
| Gate.io | gate.com/gate.io HTML | **可能被 Akamai WAF 拦截**，当前生成空 feed 占位；需要时可升级为 Playwright 无头浏览器方案 |

## Gate.io 被拦截时的升级方案

如果 `feed-gate.xml` 长期为空，说明 GitHub Actions 出口 IP 被 Akamai 拦截。可在 workflow 中加装 Playwright：

```yaml
      - name: Install Playwright
        run: |
          npm install playwright
          npx playwright install chromium
      - name: Generate feeds
        run: node generate.js
```

并把 `generateGate()` 改为用 `playwright.chromium.launch()` 抓取页面后再解析。

## 可选：增加更多分类

- Binance.bh 的 `catalogId=93` 是 Latest Activities；可改成 `48`（New Listing）、`49`（News）、`161`（Bahrain Activities）或复制 workflow 生成多个 feed。
- 其他交易所类似，修改 `generate.js` 对应函数即可。
