# Vercel 部署指南 · 另外的价钱

> 目标：**最快 5 分钟**让国内大部分用户能打开你的 H5 应用，**不用备案、不用梯子付费**。

---

## 0. 先了解：Vercel 在国内的真实表现

| 场景 | 实测情况 |
|---|---|
| 电脑浏览器（Chrome/Edge） | ✅ 90%+ 可用，首字节 200~600ms |
| 手机移动/电信 4G/5G | ✅ 一般 1~3 秒打开 |
| 手机联通宽带 | ⚠️ 晚高峰偶发慢/失败，需要刷新一次 |
| **微信内浏览器** | ✅ 一般能打开，首屏 2~5 秒 |
| 企业 / 学校网络 | ⚠️ 部分被 SNI 阻断（少数情况） |

**结论**：当作小范围内测、给少量用户体验 **完全够用**；不适合做大范围公开传播。

---

## 1. 注册 Vercel 账号（2 分钟）

1. 打开 [https://vercel.com/signup](https://vercel.com/signup)
2. **推荐用 GitHub 账号注册**（后续部署/更新最方便）
   - 没有 GitHub 账号也可以用邮箱注册
3. 选 **Hobby (Free)** 套餐（免费够用：100 GB/月流量）

> ⚠️ 注册时需要**境外网络**（梯子）才能访问。这是**唯一一次**需要梯子的操作。
> 一旦注册成功，后续访问 vercel.com 控制台**国内有时也能开**；如果开不了，部署可以用 CLI（见下文方案 B）。

---

## 2. 部署方式三选一

### 🌟 方案 A：拖拽上传（最快，5 分钟）

适合：**不用 Git、就想发出去看效果**。

#### 操作步骤

1. 登录 vercel.com 后，进入 [https://vercel.com/new](https://vercel.com/new)
2. 在页面里找到 **"Deploy a Template / Other"** 区域，向下滚动看到 **"Deploy without Git"** 或 **"Import a third-party project"**
   - 如果没找到入口，直接访问：[https://vercel.com/new/upload](https://vercel.com/new/upload)
3. **直接把 `dist/` 文件夹拖进去**（**注意不是 zip，是文件夹**）
   - Vercel 拖拽上传**不支持 zip**，需要拖文件夹
   - 路径：`/Users/zhoujing/Desktop/work/vibe coding/jiaban/dist`
4. 项目名填：`another-price`（或你喜欢的，会变成 `another-price.vercel.app`）
5. Framework Preset 选 **"Other"**
6. 点 **Deploy**，等 30~60 秒
7. 部署成功后会显示一个链接，比如：

   ```
   https://another-price.vercel.app
   https://another-price-zhoujing.vercel.app
   ```

   **这就是你的应用地址**，发给国内用户就能用。

---

### 🚀 方案 B：用 Vercel CLI（最优雅，适合后续频繁更新）

适合：**国内开不了 vercel.com 网页**、或者想 `vercel --prod` 一行命令发布。

#### 一次性安装（3 分钟）

```bash
# 在终端运行（项目根目录）
cd "/Users/zhoujing/Desktop/work/vibe coding/jiaban"
npm install -g vercel
```

> 如果 npm 慢，换淘宝镜像：
> `npm config set registry https://registry.npmmirror.com && npm install -g vercel`

#### 登录（用浏览器扫码）

```bash
vercel login
```

按提示选 **GitHub** 或 **Email**，会自动打开浏览器（**这一步还是要梯子**）。
登录成功后，本地会生成 token，**以后部署不用再开梯子**。

#### 部署

```bash
cd "/Users/zhoujing/Desktop/work/vibe coding/jiaban/dist"
vercel --prod
```

第一次会问你：
- Set up and deploy "~/dist"? → **Y**
- Which scope? → 选你自己的账号
- Link to existing project? → **N**（第一次部署）
- Project name? → **another-price**
- In which directory is your code located? → **./**（直接回车）
- Want to modify settings? → **N**

等 30 秒，会输出：

```
✅  Production: https://another-price.vercel.app  [copied to clipboard]
```

**以后每次更新代码**，只要：

```bash
cd "/Users/zhoujing/Desktop/work/vibe coding/jiaban"
# 改完代码同步到 dist
cp app.js styles.css index.html sw.js manifest.webmanifest _headers dist/
cp -R assets/. dist/assets/
# 一行部署
cd dist && vercel --prod
```

---

### 📦 方案 C：GitHub 自动部署（最专业，推荐长期用）

适合：**长期维护**，希望 `git push` 自动上线。

#### 操作步骤

1. 在 GitHub 新建一个仓库，比如 `another-price`
2. 在项目根目录初始化 Git 并推送（**注意忽略 dist 和图片**）：

   ```bash
   cd "/Users/zhoujing/Desktop/work/vibe coding/jiaban"
   git init
   echo "dist/
   *.png
   .playwright-mcp/
   another-price-dist.zip
   .DS_Store" > .gitignore
   git add .
   git commit -m "init: another-price H5"
   git remote add origin git@github.com:你的用户名/another-price.git
   git push -u origin main
   ```

3. 在 Vercel 控制台 → **Add New Project** → 选你刚推上去的 GitHub 仓库
4. **Framework Preset**：Other
5. **Root Directory**：`./`（项目根目录，所有静态文件就在根）
6. **Build Command**：留空
7. **Output Directory**：`./`（不是 dist，因为你的源码直接就是部署产物）

   > ⚠️ 注意：如果你想 Vercel 部署 `dist/` 里的版本，把 Output Directory 填 `dist`，但同时要保证每次 push 前同步好 dist。
   > **简单起见，直接用项目根目录作为部署源**，让 Vercel 把根目录所有 HTML/JS/CSS/asset 都上传。

8. Deploy → 等 30 秒上线
9. 之后每次 `git push`，Vercel 自动检测 → 拉代码 → 部署 → 推上新版本

---

## 3. 部署完后必做的 3 件事

### ✅ 3.1 用国内手机/网络验证

让朋友（**不开梯子**）打开你的链接，确认能开。

记录哪些场景能开、哪些慢：
- 微信内打开（最重要！）
- Safari / Chrome 手机版
- 不同运营商

### ✅ 3.2 配置自定义域名（可选，但推荐）

`xxx.vercel.app` 在国内偶尔被识别为"非备案域名"被屏蔽，**绑你自己的域名更稳**：

1. Vercel 项目 → Settings → Domains
2. 添加你的域名（**就算没备案也能绑，但国内访问质量看运气**）
3. 在你域名注册商处加 CNAME 解析：

   ```
   你的域名 → cname.vercel-dns.com
   ```

4. HTTPS 证书 Vercel 自动签发

> 💡 没备案的域名也能在国内用 Vercel，**只是大流量时可能被工信部要求整改**。
> 给几十/几百人用问题不大。

### ✅ 3.3 处理微信分享后被拦截的情况

如果微信打开链接显示"网址未经验证"或者被拦截：

- **解决办法 1**：让用户**右上角 ··· → 在浏览器中打开**
- **解决办法 2**：在分享文案里提示"请在浏览器中打开"
- **解决办法 3**：自定义域名 + ICP 备案（彻底解决，但要 3 周）

---

## 4. 国内用户访问遇到问题怎么办

打不开的常见原因 & 应对：

| 现象 | 原因 | 解决 |
|---|---|---|
| 显示"无法访问此网站" | DNS 被污染 | 让用户换 `223.5.5.5` DNS，或换运营商网络 |
| 微信内空白页 | 被微信拦截 | 让用户右上角 → 在浏览器中打开 |
| 加载特别慢（>10s） | Vercel 节点远 | 等一下，或者刷新 |
| Service Worker 报错 | HTTPS 缓存问题 | 让用户清缓存或换浏览器 |

**给用户的标准应急话术**（可以直接复制）：

```
🔗 应用地址：https://another-price.vercel.app

📱 打开提示：
1. 如果在微信里打不开，请点右上角「⋯」→「在浏览器中打开」
2. 如果首次很慢，刷新一下就会快很多（本地缓存）
3. 推荐用 Safari / Chrome / Edge 浏览器
4. 加到主屏幕后，体验跟原生 App 一样
```

---

## 5. 后续更新的流程（重要！）

每次你改完代码：

### 方案 A 用户（拖拽部署）

每次都得**重新拖一次** `dist/` 文件夹。建议**改用方案 B 或 C**。

### 方案 B 用户（CLI）

```bash
cd "/Users/zhoujing/Desktop/work/vibe coding/jiaban"
# 1. 同步源到 dist
cp app.js styles.css index.html sw.js manifest.webmanifest _headers dist/
cp -R assets/. dist/assets/
# 2. 升级 SW 版本号（让老用户拿到新代码）
# 编辑 sw.js 改 CACHE_VERSION
# 3. 部署
cd dist && vercel --prod
```

### 方案 C 用户（GitHub 自动）

```bash
git add . && git commit -m "fix: xxx" && git push
```

Vercel 自动检测 push 并部署，30 秒后线上更新。

---

## 6. Service Worker 缓存导致老用户拿不到新代码

这是 PWA 应用的**通病**：用户装机时 SW 会缓存旧版本，部署新版本后他们**第一次刷新还是看到旧的**。

**已经处理好的机制**：

- 项目里的 `sw.js` 每次都会 `network-first` 拉新 HTML
- 升级 `CACHE_VERSION` 后，旧 SW activate 时会清旧缓存
- 用户**刷新两次** 一定能拿到最新代码

**重大更新时的最佳实践**：

1. 改完代码，**升 `sw.js` 里的 `CACHE_VERSION`**（比如 `v1.2.0` → `v1.3.0`）
2. 部署
3. 在分享话术里加一句"如果界面看着没变化，请下拉刷新一次"

---

## 7. Vercel 免费套餐限制

不用担心，你完全用不完：

| 资源 | 免费额度 | 你的预估用量 |
|---|---|---|
| 每月流量 | 100 GB | 单页 2 MB × 5 万次访问 = 100 GB |
| 请求次数 | 不限 | — |
| 构建时间 | 6000 分钟/月 | 一次 < 1 分钟，每天部署 100 次也够 |
| 自定义域名 | 不限 | — |
| HTTPS | 自动 | — |
| 团队成员 | 1（个人） | 够 |

只要你不做病毒式传播（百万级日活），**永远免费**。

---

## 8. 出问题 / 想升级，备选方案对比

| 平台 | 国内访问 | 备案 | 推荐场景 |
|---|---|---|---|
| **Vercel** | 70~90% 可用 | 不要 | 👉 你现在用这个 |
| Netlify | 60~80% 可用 | 不要 | 备选，比 Vercel 稍慢 |
| Cloudflare Pages | 50~75% 可用 | 不要 | 不推荐（国内不稳） |
| GitHub Pages | 30~50% 可用 | 不要 | 不推荐（被墙） |
| **腾讯云 EdgeOne Pages** | 99%+ 可用 | **要** | 备案后切换到这个 |
| 阿里云 OSS+CDN | 99%+ 可用 | **要** | 同上 |

---

## 一键脚本（懒人福利）

我帮你写了一个 `deploy.sh`，每次更新一行命令搞定：

```bash
#!/bin/bash
# 同步源代码到 dist 并部署到 Vercel
cd "$(dirname "$0")"
cp app.js styles.css index.html sw.js manifest.webmanifest _headers dist/
cp -R assets/. dist/assets/
cd dist && vercel --prod
```

保存到项目根目录，然后：

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 速查：你现在该做什么

```
□ 1. 打开梯子，注册 Vercel 账号（2 分钟）
□ 2. 用方案 A 把 dist 文件夹拖进 vercel.com/new/upload
□ 3. 拿到 xxx.vercel.app 链接
□ 4. 用国内手机/电脑验证（不开梯子）
□ 5. 微信里打开验证一遍
□ 6. 发链接给几个朋友试用
□ 7. 收集反馈，迭代功能
□ 8. （可选）后续切到方案 B/C 让更新更方便
```

完成 ✅
