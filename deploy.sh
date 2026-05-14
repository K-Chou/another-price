#!/bin/bash
# 另外的价钱 · Vercel 一键部署脚本
# 用法：./deploy.sh
# 前置：已 npm i -g vercel 并 vercel login

set -e

cd "$(dirname "$0")"

echo "==> 同步源代码到 dist/ ..."
cp app.js styles.css index.html sw.js manifest.webmanifest _headers dist/
cp -R assets/. dist/assets/

echo "==> 当前 sw.js 版本号："
grep "CACHE_VERSION" sw.js | head -1

echo ""
echo "==> 提醒：如果本次是重大更新，请记得升级 sw.js 里的 CACHE_VERSION"
echo "    （让老用户能拿到新代码，否则会被旧缓存命中）"
echo ""

echo "==> 部署到 Vercel ..."
cd dist && vercel --prod

echo ""
echo "✅ 部署完成！"
