/**
 * 另外的价钱 - Apple HIG 风格实现
 *
 * 关键特性：
 * - 多页面栈管理（push / pop 物理切换，模拟 iOS 导航控制器）
 * - 大标题导航（Large Title），滚动时折叠为标准标题栏
 * - 触感反馈（vibrate + scale）
 * - 自营推广位（克制式 App Store 风格）
 * - 数据：localStorage；分享：Base64 over URL hash
 *
 * 路由：
 *   /home                   首页
 *   /settings               我的设置
 *   /pricing                价目表管理
 *   /create                 创建账单
 *   /history                账单历史
 *   /bill/<id>              本地账单详情
 *   /pay?d=<base64>         付款页（被分享人）
 */

// =====================================================================
// 基础工具
// =====================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

function haptic(intensity = 'light') {
  // 轻微触感反馈（Android 支持，iOS 仅在 PWA 中支持）
  if (!('vibrate' in navigator)) return;
  const map = { light: 8, medium: 15, heavy: 25 };
  try {
    navigator.vibrate(map[intensity] || 8);
  } catch (_) {}
}

function showToast(msg, duration = 2000) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  // 双 RAF 触发动画
  el.classList.remove('show');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

// modal 关闭过程中的"锁"：避免重复关闭/打开时互相覆盖
let _modalClosing = false;

function showModal(html, { bottom = true, onClose } = {}) {
  const root = $('#modal-root');
  // 若上一个 modal 正在关闭动画中，强制立即清空，让新的能立刻显示
  if (_modalClosing) {
    root.innerHTML = '';
    _modalClosing = false;
  }
  root.innerHTML = `
    <div class="modal-mask ${bottom ? '' : 'center'}" data-mask>
      <div class="modal-sheet" role="dialog" aria-modal="true">
        ${bottom ? '<div class="grabber"></div>' : ''}
        ${html}
      </div>
    </div>
  `;
  const mask = root.firstElementChild;
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeModal(onClose);
  });
  document.body.style.overflow = 'hidden';
  return mask;
}

function closeModal(cb) {
  const root = $('#modal-root');
  if (!root.firstElementChild) return;
  if (_modalClosing) return; // 防重复点击/事件
  _modalClosing = true;

  const sheet = root.querySelector('.modal-sheet');
  const mask = root.querySelector('.modal-mask');
  if (sheet && mask) {
    if (mask.classList.contains('center')) {
      sheet.style.animation = 'popIn 200ms var(--ease-out) reverse';
    } else {
      sheet.style.transform = 'translateY(100%)';
      sheet.style.transition = 'transform 320ms var(--ease-out)';
    }
    mask.style.background = 'rgba(0,0,0,0)';
    mask.style.transition = 'background 280ms var(--ease-out)';
  }
  const delay = sheet && mask ? 320 : 0;
  setTimeout(() => {
    root.innerHTML = '';
    document.body.style.overflow = '';
    _modalClosing = false;
    cb && cb();
  }, delay);
}

function showSuccess(title, desc, onOk, opts = {}) {
  const root = $('#modal-root');
  // 同样允许在前一个 modal 关闭中插入
  if (_modalClosing) {
    root.innerHTML = '';
    _modalClosing = false;
  }
  const descHTML = opts.rawDesc ? (desc || '') : esc(desc || '');
  root.innerHTML = `
    <div class="success-pop">
      <div class="success-card">
        <div class="checkmark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <strong>${esc(title)}</strong>
        <p>${descHTML}</p>
        <button class="btn btn-primary btn-block" id="success-ok">好的</button>
      </div>
    </div>
  `;
  document.body.style.overflow = 'hidden';
  haptic('medium');
  $('#success-ok').addEventListener('click', () => closeSuccess(onOk));
}

// success 弹层独立的关闭逻辑（带淡出动画，不复用 closeModal）
function closeSuccess(cb) {
  const root = $('#modal-root');
  const pop = root.querySelector('.success-pop');
  if (!pop) {
    document.body.style.overflow = '';
    cb && cb();
    return;
  }
  pop.classList.add('is-closing');
  setTimeout(() => {
    root.innerHTML = '';
    document.body.style.overflow = '';
    cb && cb();
  }, 220);
}

// Base64（兼容中文）
function encodeShare(obj) {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(s) {
  try {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) {
    return null;
  }
}

function fileToDataURL(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatMoney(n) {
  if (typeof n !== 'number' || isNaN(n)) return '0.00';
  return n.toFixed(2);
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

// 「长按识别二维码」首次引导：累计展示 3 次后不再出现
const PRESS_HINT_KEY = 'ap_press_hint_count';
function shouldShowPressHint() {
  try {
    const n = parseInt(sessionStorage.getItem(PRESS_HINT_KEY) || '0', 10);
    if (n >= 1) return false; // 本会话内仅首次
    const total = parseInt(localStorage.getItem(PRESS_HINT_KEY) || '0', 10);
    if (total >= 3) return false; // 跨会话累计 3 次封顶
    sessionStorage.setItem(PRESS_HINT_KEY, String(n + 1));
    localStorage.setItem(PRESS_HINT_KEY, String(total + 1));
    return true;
  } catch (_) {
    return true;
  }
}

// 构造适合粘贴到微信/聊天的分享文案（弥补 H5 无 og 卡片）
function buildShareText(bill, profile, shareURL) {
  const t = billTheme(bill);
  const senderName = (profile && profile.nickname) || '我';
  const lines = [];
  lines.push(`【${t.title}】¥${formatMoney(bill.total)}`);
  if (bill.items && bill.items.length) {
    const briefs = bill.items
      .slice(0, 3)
      .map((it) => `· ${it.label} ¥${formatMoney(it.amount * it.qty)}`);
    lines.push(briefs.join('\n'));
    if (bill.items.length > 3) lines.push(`…等 ${bill.items.length} 项`);
  }
  if (bill.note) lines.push(`备注：${bill.note}`);
  lines.push(`—— ${senderName} 发起`);
  lines.push(`点击查看明细并付款：${shareURL}`);
  return lines.join('\n');
}

// 构造回执文案
function buildReceiptText(bill, payeeName, receiptURL) {
  const t = billTheme(bill);
  const lines = [];
  lines.push(`✅ 已支付 ¥${formatMoney(bill.total)} - ${t.title}`);
  if (payeeName) lines.push(`收款人：${payeeName}`);
  lines.push(`点击此链接核对入账：${receiptURL}`);
  return lines.join('\n');
}

// 把 dataURL / URL 转成可绘制的 HTMLImageElement
function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // 静默失败，避免阻断生成
    img.src = src;
  });
}

// 把头像渲染到 canvas（含字母占位）
function drawAvatar(ctx, img, name, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    // 蓝渐变占位
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#5AC8FA');
    g.addColorStop(1, '#007AFF');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.floor(r * 0.9)}px -apple-system, "PingFang SC", system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name || '我').slice(0, 1), cx, cy + 2);
  }
  ctx.restore();
}

// 自动换行
function wrapText(ctx, text, maxWidth) {
  const chars = Array.from(text);
  const lines = [];
  let line = '';
  for (const c of chars) {
    const test = line + c;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = c;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 圆角矩形
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 在 canvas 上画一个二维码（用 qrcode-generator 库，离线生成）
// 返回 true 表示成功，false 表示库未加载或文本过长
function drawQRCode(ctx, text, x, y, size) {
  if (typeof qrcode !== 'function' || !text) return false;
  try {
    // typeNumber = 0 表示自动选最小够装下数据的版本；'M' 为中等纠错（兼容性最好）
    const qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / count;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#1C1C1E';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          // 多绘一点 0.5px 避免子像素缝隙
          ctx.fillRect(x + c * cell, y + r * cell, cell + 0.6, cell + 0.6);
        }
      }
    }
    ctx.restore();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 生成账单图片（参照付款页风格）。
 * 750@2x，纵向长图。
 */
async function generateBillImage(bill, profile) {
  const DPR = 2;
  const W = 750;
  const theme = billTheme(bill);
  const items = bill.items || [];

  const qrImg = await loadImage(profile.wechatQR);

  // === 布局常量 ===
  const padX = 36;          // 整体左右内边距
  const cardR = 28;         // 卡片圆角
  const heroH = 360;        // Hero 高
  const itemRowH = 100;     // 每条明细高
  const itemsCardPad = 32;  // 明细卡内边距
  const qrSize = 480;       // 二维码尺寸（必须大才清晰）
  const qrCardPad = 40;     // 二维码卡内边距
  const gap = 28;           // 卡片之间间距

  const itemsCardH = items.length * itemRowH + itemsCardPad * 2;
  const qrCardH = qrSize + qrCardPad * 2;

  const topPad = 48;        // 顶部留白
  const bottomPad = 60;     // 底部留白（含底部强调标题 + 水印）
  const ctaH = 100;         // "长按..." 区域

  // 推广卡：左侧引流二维码 + 右侧文案
  const promoH = 200;       // 推广卡高
  const promoQR = 140;      // 推广二维码尺寸（约付款码的 1/3，避免视觉竞争）

  const H =
    topPad +
    heroH +
    gap +
    itemsCardH +
    gap +
    qrCardH +
    ctaH +
    promoH +
    gap +
    bottomPad;

  const canvas = document.createElement('canvas');
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // === 1. 浅灰背景（应用 group bg） ===
  ctx.fillStyle = '#F2F2F7';
  ctx.fillRect(0, 0, W, H);

  // === 2. Hero ===
  const heroX = padX;
  const heroY = topPad;
  const heroW = W - padX * 2;

  // Hero 渐变底（深蓝→深紫，仿付款页 bill-hero）
  const heroGrad = ctx.createLinearGradient(heroX, heroY, heroX + heroW, heroY + heroH);
  heroGrad.addColorStop(0, '#1f3a5e');
  heroGrad.addColorStop(0.5, '#2d4673');
  heroGrad.addColorStop(1, '#3a4d80');
  ctx.fillStyle = heroGrad;
  roundRect(ctx, heroX, heroY, heroW, heroH, cardR);
  ctx.fill();

  // 右上角柠檬绿光晕（用径向渐变 + clip 限制在卡片内）
  ctx.save();
  roundRect(ctx, heroX, heroY, heroW, heroH, cardR);
  ctx.clip();
  const glowR = 280;
  const glowCx = heroX + heroW - 60;
  const glowCy = heroY + 40;
  const glow = ctx.createRadialGradient(glowCx, glowCy, 0, glowCx, glowCy, glowR);
  glow.addColorStop(0, 'rgba(214, 241, 65, 0.75)');
  glow.addColorStop(0.55, 'rgba(214, 241, 65, 0.18)');
  glow.addColorStop(1, 'rgba(214, 241, 65, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(heroX, heroY, heroW, heroH);
  ctx.restore();

  // 主题徽章 - 黑色半透药丸
  const badgePadX = 22;
  const badgePadY = 12;
  ctx.font = '500 28px -apple-system, "PingFang SC", system-ui';
  const badgeText = `${theme.emoji}  ${theme.title}`;
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeH = 56;
  const badgeX = heroX + 36;
  const badgeY = heroY + 36;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(badgeText, badgeX + badgePadX, badgeY + badgeH / 2 + 1);

  // "应付" 标签
  ctx.font = '400 26px -apple-system, "PingFang SC", system-ui';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.textBaseline = 'top';
  ctx.fillText('应付', heroX + 36, heroY + 130);

  // 金额（柠檬绿）
  ctx.fillStyle = '#D6F141';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 56px -apple-system, "SF Pro Display", system-ui';
  const amountY = heroY + 240;
  const xMarkW = ctx.measureText('¥').width;
  ctx.fillText('¥', heroX + 36, amountY);
  ctx.font = '700 110px -apple-system, "SF Pro Display", system-ui';
  ctx.fillText(formatMoney(bill.total), heroX + 36 + xMarkW + 6, amountY);

  // 副标题（theme.desc 或 bill.note）
  const subTitle = bill.note || theme.desc || '';
  if (subTitle) {
    ctx.font = '400 24px -apple-system, "PingFang SC", system-ui';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.textBaseline = 'top';
    const subLines = wrapText(ctx, subTitle, heroW - 72);
    subLines.slice(0, 2).forEach((ln, i) => {
      ctx.fillText(ln, heroX + 36, heroY + heroH - 80 + i * 32);
    });
  }

  // === 3. 明细卡 ===
  let y = heroY + heroH + gap;

  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, padX, y, heroW, itemsCardH, cardR);
  ctx.fill();

  items.forEach((it, idx) => {
    const ty = y + itemsCardPad + idx * itemRowH;

    // 分隔线
    if (idx > 0) {
      ctx.strokeStyle = 'rgba(60, 60, 67, 0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX + 96, ty - 4);
      ctx.lineTo(padX + heroW - 32, ty - 4);
      ctx.stroke();
    }

    // emoji 圆形底
    const eR = 30;
    const eCx = padX + 32 + eR;
    const eCy = ty + itemRowH / 2 - 10;
    ctx.fillStyle = '#F2F2F7';
    ctx.beginPath();
    ctx.arc(eCx, eCy, eR + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '34px -apple-system, system-ui';
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(it.icon || '💼', eCx, eCy + 2);

    // 标题
    ctx.font = '500 30px -apple-system, "PingFang SC", system-ui';
    ctx.fillStyle = '#1C1C1E';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(it.label, padX + 96, ty + itemRowH / 2 - 6);

    // meta
    ctx.font = '400 22px -apple-system, "PingFang SC", system-ui';
    ctx.fillStyle = '#8E8E93';
    ctx.fillText(
      `${it.hours}h × ¥${formatMoney(it.amount)} × ${it.qty}`,
      padX + 96,
      ty + itemRowH / 2 + 28,
    );

    // 子金额
    ctx.font = '600 32px -apple-system, "SF Pro Display", system-ui';
    ctx.fillStyle = '#1C1C1E';
    ctx.textAlign = 'right';
    ctx.fillText(
      `¥${formatMoney(it.amount * it.qty)}`,
      padX + heroW - 32,
      ty + itemRowH / 2 + 8,
    );
  });

  // === 4. 二维码大白卡 ===
  y += itemsCardH + gap;
  ctx.textAlign = 'left';

  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, padX, y, heroW, qrCardH, cardR);
  ctx.fill();

  const qrX = padX + (heroW - qrSize) / 2;
  const qrY = y + qrCardPad;

  if (qrImg) {
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  } else {
    ctx.fillStyle = '#F2F2F7';
    ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.fillStyle = '#8E8E93';
    ctx.font = '400 24px -apple-system, "PingFang SC", system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('（未上传收款码）', qrX + qrSize / 2, qrY + qrSize / 2);
    ctx.textAlign = 'left';
  }

  // === 5. CTA "长按二维码即可识别付款" ===
  y += qrCardH;

  ctx.font = '600 32px -apple-system, "PingFang SC", system-ui';
  ctx.fillStyle = '#1C1C1E';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('长按二维码即可识别付款', W / 2, y + ctaH / 2);

  // === 6. 推广卡：扫码访问应用首页 ===
  y += ctaH;

  // 浅色背景卡，与白色付款码卡区分（不喧宾夺主）
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, padX, y, heroW, promoH, cardR);
  ctx.fill();

  // 左侧：推广二维码
  const promoQrX = padX + 36;
  const promoQrY = y + (promoH - promoQR) / 2;
  const promoURL =
    (typeof location !== 'undefined' && location.origin
      ? location.origin + '/'
      : 'https://another-price.vercel.app/');
  const qrOk = drawQRCode(ctx, promoURL, promoQrX, promoQrY, promoQR);
  if (qrOk) {
    // 二维码四角加轻框，更清晰
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(promoQrX - 0.5, promoQrY - 0.5, promoQR + 1, promoQR + 1);
  }

  // 右侧：文案
  const txtX = promoQrX + promoQR + 28;
  const txtMaxW = heroW - (txtX - padX) - 36;

  // 标题
  ctx.font = '600 30px -apple-system, "PingFang SC", system-ui';
  ctx.fillStyle = '#1C1C1E';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('也想给加班/份子钱明码标价？', txtX, y + 70);

  // 副标题
  ctx.font = '400 24px -apple-system, "PingFang SC", system-ui';
  ctx.fillStyle = '#6B7280';
  ctx.fillText('扫左侧二维码，免费使用', txtX, y + 108);

  // 域名小字（强化可信度）
  ctx.font = '500 22px -apple-system, "SF Pro Text", system-ui';
  ctx.fillStyle = '#3B82F6';
  // 把 URL 去掉协议头展示更清爽
  const showHost = promoURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // 用 wrapText 兜底，超长不撑破卡片
  const hostLines = wrapText(ctx, showHost, txtMaxW);
  ctx.fillText(hostLines[0] || showHost, txtX, y + 148);

  // === 7. 底部署名（轻量） ===
  ctx.font = '400 20px -apple-system, "PingFang SC", system-ui';
  ctx.fillStyle = '#C7C7CC';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const senderName = profile.nickname || '我';
  ctx.fillText(`由 ${senderName} 通过「另外的价钱」生成`, W / 2, H - 32);

  // 同时返回 dataURL（用于 <img src>）和 Blob（用于下载/分享，更稳定）
  const dataURL = canvas.toDataURL('image/png');
  const blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  return {
    dataURL,
    blob,
    width: canvas.width,
    height: canvas.height,
  };
}

// 生成安全的文件名：去掉系统不允许的特殊字符
function safeFileName(name) {
  // 去掉常见非法字符：/ \ : * ? " < > | 以及 ¥ 等全角符号
  // 同时把所有 . 替换成 _，避免被当成扩展名分隔符
  return String(name || '账单')
    .replace(/[/\\:*?"<>|¥￥]/g, '')
    .replace(/\./g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '账单';
}

// 通用复制（带降级），返回 Promise<boolean>
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  // 降级：textarea + execCommand（适配旧版/HTTP 场景）
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

// =====================================================================
// 数据层
// =====================================================================

const STORAGE_KEY = 'another_price_app_v1';
const LEGACY_KEYS = ['overtime_pay_app_v2'];

const DEFAULT_PROFILE = {
  nickname: '',
  avatar: '',
  bio: '',
  hourlyRate: 0,
  wechatQR: '',
  alipayQR: '',
};

const DEFAULT_PLANS = [
  { id: uid(), icon: '🍔', label: 'KFC 疯狂星期四 v 我 50', hours: 1, amount: 50 },
  { id: uid(), icon: '💼', label: '工作日加班 1 小时', hours: 1, amount: 50 },
];

const ICON_CHOICES = [
  '💼', '🌙', '🎉', '🚨', '☕', '🍱',
  '🍔', '🛠️', '💡', '🏃', '⏰', '💰',
  '🔥', '📊', '🖥️', '✏️', '🧠', '⚡',
];

// 主题：发起人为每张账单挑一个主题（emoji + 标题 + 描述）
// 不只用于加班，也可以是跑腿、份子钱、AA、代购……
const DEFAULT_THEME = {
  emoji: '💼',
  title: '加班付费',
  desc: '让每一份加班，都被认真对待',
};

const THEME_PRESETS = [
  { id: 'overtime', emoji: '💼', title: '加班付费', desc: '让每一份加班，都被认真对待' },
  { id: 'errand',   emoji: '🛵', title: '帮我跑腿', desc: '感谢你愿意帮我跑这一趟' },
  { id: 'gift',     emoji: '🎁', title: '份子钱',   desc: '祝幸福美满 · 礼到心意到' },
  { id: 'aa',       emoji: '🍽️', title: 'AA 收款',  desc: '聚会愉快，账目清晰' },
  { id: 'rent',     emoji: '🏠', title: '房租水电', desc: '本月费用清单' },
  { id: 'tutor',    emoji: '📚', title: '家教课时', desc: '本期课程结算' },
  { id: 'design',   emoji: '🎨', title: '设计稿费', desc: '感谢你认可我的作品' },
  { id: 'repair',   emoji: '🔧', title: '维修服务', desc: '辛苦了，已修好' },
  { id: 'gym',      emoji: '💪', title: '私教课', desc: '坚持就是胜利' },
  { id: 'shop',     emoji: '🛍️', title: '代购清单', desc: '已经帮你拿到啦' },
  { id: 'photo',    emoji: '📷', title: '拍摄费用', desc: '感谢这次合作' },
  { id: 'custom',   emoji: '💰', title: '自定义',   desc: '' },
];

const THEME_EMOJI_CHOICES = [
  '💼', '🛵', '🎁', '🍽️', '🏠', '📚',
  '🎨', '🔧', '💪', '🛍️', '📷', '💰',
  '🚗', '✈️', '🏥', '🐱', '🎂', '☕',
  '🎵', '🍻', '💍', '🎓', '🧧', '🌹',
];

function loadStore() {
  try {
    // 旧 key 迁移：第一次读到新 key 为空 + 老 key 存在时，搬运一次
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        const legacy = localStorage.getItem(k);
        if (legacy) {
          localStorage.setItem(STORAGE_KEY, legacy);
          try { localStorage.removeItem(k); } catch (_) {}
          raw = legacy;
          break;
        }
      }
    }
    if (raw) {
      const data = JSON.parse(raw);
      return {
        profile: { ...DEFAULT_PROFILE, ...(data.profile || {}) },
        plans: Array.isArray(data.plans) ? data.plans : DEFAULT_PLANS.slice(),
        bills: Array.isArray(data.bills) ? data.bills : [],
        lastTheme: data.lastTheme ? { ...DEFAULT_THEME, ...data.lastTheme } : { ...DEFAULT_THEME },
      };
    }
  } catch (e) {
    console.error(e);
  }
  return {
    profile: { ...DEFAULT_PROFILE },
    plans: DEFAULT_PLANS.slice(),
    bills: [],
    lastTheme: { ...DEFAULT_THEME },
  };
}

// 兼容老 bill：补全 theme
function billTheme(bill) {
  return bill && bill.theme ? { ...DEFAULT_THEME, ...bill.theme } : { ...DEFAULT_THEME };
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.error(e);
    showToast('保存失败：本地空间不足');
  }
}

let store = loadStore();

// 一次性迁移：若老用户的价目表里没有 KFC 那条，软插到最前
// 用一个 flag 防止用户主动删了之后又被自动加回（尊重用户选择）
(function migrateAddKfcOnce() {
  const FLAG = 'aprice_migrated_kfc_v1';
  if (localStorage.getItem(FLAG)) return;
  try {
    const hasKfc = store.plans.some(
      (p) => typeof p.label === 'string' && /KFC|疯狂星期四|v\s*我\s*50/i.test(p.label),
    );
    if (!hasKfc) {
      store.plans = [
        { id: uid(), icon: '🍔', label: 'KFC 疯狂星期四 v 我 50', hours: 1, amount: 50 },
        ...store.plans,
      ];
      saveStore(store);
    }
    localStorage.setItem(FLAG, '1');
  } catch (_) {}
})();

const persist = () => saveStore(store);

// =====================================================================
// 自营推广位配置
// 你可以随时改成自己的内容、朋友的小程序、或接入广告 SDK
// =====================================================================

const PROMO_CONFIG = {
  // 首页底部小卡
  home: {
    enabled: true,
    tag: '推荐',
    icon: '✨',
    title: '加我微信，交流收款玩法',
    desc: '群里都是认真生活的打工人',
    cta: '加好友',
    url: '', // 留空时点击复制提示语
    fallbackToast: '微信搜索：jiaban_pay（演示用，替换为你的微信号）',
  },
  // 付款成功页大卡（被分享人看到）
  paySuccess: {
    enabled: true,
    tag: 'Sponsored',
    title: '为你推荐',
    items: [
      {
        icon: '📒',
        bg: 'var(--ios-orange)',
        title: '账单记录本',
        desc: '该收的钱，一笔都不能少',
        cta: '查看',
        url: '',
      },
      {
        icon: '💸',
        bg: 'var(--ios-green)',
        title: '工资计算器',
        desc: '看看你应得多少',
        cta: '试用',
        url: '',
      },
    ],
  },
};

function PromoCard() {
  const p = PROMO_CONFIG.home;
  if (!p.enabled) return '';
  return `
    <a class="promo" id="promo-home" role="button">
      <div class="promo-icon">${esc(p.icon)}</div>
      <div class="promo-body">
        <span class="promo-tag">${esc(p.tag)}</span>
        <div class="promo-title">${esc(p.title)}</div>
        <div class="promo-desc">${esc(p.desc)}</div>
      </div>
      <span class="promo-cta">${esc(p.cta)}</span>
    </a>
  `;
}

function PromoFeature() {
  const p = PROMO_CONFIG.paySuccess;
  if (!p.enabled) return '';
  return `
    <div class="promo-feature">
      <div class="head">
        <h3>${esc(p.title)}</h3>
        <span class="tag">${esc(p.tag)}</span>
      </div>
      ${p.items
        .map(
          (it, i) => `
        <a class="item" data-promo-idx="${i}" role="button">
          <div class="icon" style="background:${it.bg}">${esc(it.icon)}</div>
          <div>
            <div style="font-size:15px;font-weight:600;letter-spacing:-0.02em">${esc(it.title)}</div>
            <div style="margin-top:2px;color:var(--label-secondary);font-size:13px;letter-spacing:-0.01em">${esc(it.desc)}</div>
          </div>
          <span class="promo-cta">${esc(it.cta)}</span>
        </a>
      `,
        )
        .join('')}
    </div>
  `;
}

function bindPromoHandlers(root) {
  const home = root.querySelector('#promo-home');
  if (home) {
    home.addEventListener('click', () => {
      haptic('light');
      const p = PROMO_CONFIG.home;
      if (p.url) location.href = p.url;
      else showToast(p.fallbackToast, 2800);
    });
  }
  $$('[data-promo-idx]', root).forEach((el) => {
    el.addEventListener('click', () => {
      haptic('light');
      const idx = parseInt(el.dataset.promoIdx, 10);
      const item = PROMO_CONFIG.paySuccess.items[idx];
      if (item?.url) location.href = item.url;
      else showToast(`推广位（演示）：${item.title}`, 2000);
    });
  });
}

// =====================================================================
// 多页面栈管理（核心：iOS push/pop 动画）
// =====================================================================

const PageStack = (() => {
  let stack = []; // [{ path, params, el }]
  let isAnimating = false;
  let root = null;

  function init(rootEl) {
    root = rootEl;
  }

  function getRoot() {
    return root;
  }

  function buildScreen(path, params) {
    const el = document.createElement('div');
    el.className = 'screen';
    if (path === '/home') el.classList.add('is-root');
    el.dataset.path = path;
    renderInto(el, path, params);
    return el;
  }

  function push(path, params = {}, opts = {}) {
    // 动画进行中：把新请求入队，等动画完成再执行
    if (isAnimating) {
      pendingPushes.push({ path, params, opts });
      return;
    }
    isAnimating = true;

    const newScreen = buildScreen(path, params);
    // 根页面无动画，瞬间出现
    if (opts.instant || stack.length === 0) {
      newScreen.classList.add('is-current');
      root.appendChild(newScreen);
      stack.push({ path, params, el: newScreen });
      updateUrl();
      bindScroll(newScreen);
      isAnimating = false;
      flushPending();
      return;
    }

    root.appendChild(newScreen);
    const prev = stack[stack.length - 1];
    if (prev) {
      newScreen.offsetHeight; // 强制 reflow
      prev.el.classList.remove('is-current');
      prev.el.classList.add('is-stacked');
    }

    requestAnimationFrame(() => {
      newScreen.classList.add('is-current');
      setTimeout(() => {
        isAnimating = false;
        flushPending();
      }, 400);
    });

    stack.push({ path, params, el: newScreen });
    updateUrl();
    bindScroll(newScreen);
  }

  const pendingPushes = [];
  function flushPending() {
    if (isAnimating) return;
    const next = pendingPushes.shift();
    if (next) push(next.path, next.params, next.opts);
  }

  function pop() {
    if (isAnimating) return;
    if (stack.length <= 1) return;
    isAnimating = true;

    const top = stack.pop();
    const prev = stack[stack.length - 1];

    top.el.classList.remove('is-current');
    top.el.classList.add('is-exiting');

    if (prev) {
      // 关键：返回前重渲染上一页，确保看到最新数据（如改完昵称返回首页要更新）
      // 保留滚动位置避免回到顶部
      const scrollTop = prev.el.scrollTop;
      try {
        renderInto(prev.el, prev.path, prev.params);
      } catch (_) {}
      prev.el.scrollTop = scrollTop;
      bindScroll(prev.el);

      prev.el.classList.remove('is-stacked');
      prev.el.classList.add('is-current');
    }

    setTimeout(() => {
      top.el.remove();
      isAnimating = false;
    }, 400);

    updateUrl();
  }

  function replace(path, params = {}) {
    // 用于全栈重置（如完成账单后跳回历史）
    while (stack.length > 0) {
      const t = stack.pop();
      t.el.remove();
    }
    push(path, params);
  }

  function reRenderCurrent() {
    const top = stack[stack.length - 1];
    if (!top) return;
    renderInto(top.el, top.path, top.params);
    bindScroll(top.el);
  }

  function updateUrl() {
    const top = stack[stack.length - 1];
    if (!top) return;
    const qs = top.params && Object.keys(top.params).length
      ? '?' + new URLSearchParams(top.params).toString()
      : '';
    const newHash = '#' + top.path + qs;
    if (location.hash !== newHash) {
      // 不触发 hashchange 监听
      history.replaceState(null, '', newHash);
    }
  }

  function bindScroll(screen) {
    // 滚动时收起大标题，把标题填进 nav
    // 防重：同一 screen 元素多次绑定时移除旧 handler
    if (screen.__scrollHandler) {
      screen.removeEventListener('scroll', screen.__scrollHandler);
    }
    const nav = screen.querySelector('.nav');
    if (!nav) return;
    let last = -1;
    const handler = () => {
      const y = screen.scrollTop;
      const should = y > 24;
      if (should !== last) {
        nav.classList.toggle('is-condensed', should);
        last = should;
      }
    };
    screen.__scrollHandler = handler;
    screen.addEventListener('scroll', handler, { passive: true });
    handler();
  }

  function currentPath() {
    const top = stack[stack.length - 1];
    return top ? top.path : null;
  }

  return { init, push, pop, replace, reRenderCurrent, currentPath, getRoot, stackSize: () => stack.length };
})();

function navigate(path, params = {}) {
  // 简化：所有跳转都用 push；返回用 PageStack.pop
  PageStack.push(path, params);
}

function goBack() {
  PageStack.pop();
}

// =====================================================================
// 公共片段
// =====================================================================

function NavBar({ title, back = true, right = '' } = {}) {
  return `
    <div class="nav">
      <div>${
        back
          ? `<button class="nav-back" data-back>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              返回
            </button>`
          : ''
      }</div>
      <div class="nav-title">${esc(title)}</div>
      <div style="text-align:right">${right}</div>
    </div>
  `;
}

function AvatarHTML(p, size) {
  const sizeClass = size === 80 ? 'lg' : size === 56 ? 'md' : size === 36 ? 'sm' : '';
  const content = p.avatar
    ? `<img src="${esc(p.avatar)}" alt="头像"/>`
    : `<div class="avatar-placeholder">${esc((p.nickname || '我').trim().charAt(0).toUpperCase())}</div>`;
  return `<div class="avatar-frame ${sizeClass}">${content}</div>`;
}

function ChevronRight() {
  return `<svg class="chevron" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="1 1 7 6.5 1 12"/>
  </svg>`;
}

function bindBackBtn(root) {
  const back = root.querySelector('[data-back]');
  if (back) {
    back.addEventListener('click', () => {
      haptic('light');
      goBack();
    });
  }
}

// =====================================================================
// 视图：首页
// =====================================================================

function renderHome(el) {
  const { profile, plans } = store;
  const needSetup = !profile.wechatQR && !profile.nickname;

  el.innerHTML = `
    ${NavBar({
      title: '另外的价钱',
      back: false,
      right: `<button class="nav-text-btn ${needSetup ? 'has-dot' : ''}" data-go="/settings" aria-label="我的收款码">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/>
          <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01"/>
        </svg>
        <span>收款码</span>
      </button>`,
    })}

    <div class="large-title brand-title">
      <img class="brand-logo" src="./assets/logo.svg" alt="另外的价钱"/>
      <div class="brand-text">
        <div class="brand-name">另外的价钱</div>
        <div class="large-title-subtitle">加班、跑腿、份子钱…该收的钱，一笔都不能少。</div>
      </div>
    </div>

    <div class="screen-content">
      <div class="profile-hero">
        ${AvatarHTML(profile)}
        <p class="profile-name">${esc(profile.nickname || '设置你的昵称')}</p>
        ${
          profile.bio || needSetup
            ? `<p class="profile-bio">${esc(profile.bio || '点击右上角「收款码」开始设置')}</p>`
            : ''
        }
      </div>

      ${needSetup
        ? `<div class="env-banner">第一次使用，请先上传<strong>微信赞赏码</strong>，否则对方扫不到码无法付款。</div>`
        : ''
      }

      <div class="section-header">
        <span>我的价目</span>
        <a class="link" data-go="/pricing">管理</a>
      </div>
      <div class="group">
        ${
          plans.length === 0
            ? `<div class="empty"><div class="icon">📋</div>暂无价目，点击右侧「管理」添加</div>`
            : plans.slice(0, 4)
                .map(
                  (p) => `
            <div class="plan-row">
              <div class="plan-icon-circle">${esc(p.icon || '💼')}</div>
              <div class="plan-body">
                <div class="name">${esc(p.label)}</div>
                <div class="meta">${p.hours} 小时</div>
              </div>
              <div class="plan-price">
                <div class="amount tabular">¥${formatMoney(p.amount)}</div>
                <div class="unit">${formatMoney(p.amount / Math.max(p.hours, 0.001))}/小时</div>
              </div>
            </div>
          `,
                )
                .join('') +
                (plans.length > 4
                  ? `<button class="row link-row" data-go="/pricing">
                      <div class="middle"><div class="title">查看全部 ${plans.length} 条</div></div>
                      <div class="trailing">${ChevronRight()}</div>
                    </button>`
                  : '')
        }
      </div>

      <div class="section-header"><span>快捷操作</span></div>
      <div class="group">
        <button class="row" data-go="/create">
          <div class="leading">
            <div class="row-icon bg-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </div>
          </div>
          <div class="middle"><div class="title">创建账单</div><div class="subtitle">勾选价目，生成分享链接</div></div>
          <div class="trailing">${ChevronRight()}</div>
        </button>
        <button class="row" data-go="/history">
          <div class="leading">
            <div class="row-icon bg-purple">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v14.5A1.5 1.5 0 0 1 18.5 21h-12A2.5 2.5 0 0 1 4 18.5z"/>
                <path d="M8 8h7M8 12h7M8 16h4"/>
              </svg>
            </div>
          </div>
          <div class="middle"><div class="title">账单历史</div><div class="subtitle">${store.bills.length} 条记录</div></div>
          <div class="trailing">${ChevronRight()}</div>
        </button>
      </div>

      <div class="section-header"><span>为你推荐</span></div>
      ${PromoCard()}
    </div>
  `;

  $$('[data-go]', el).forEach((b) => {
    b.addEventListener('click', () => {
      haptic('light');
      if (b.dataset.go === '/create' && store.plans.length === 0) {
        showToast('请先添加至少一条价目');
        navigate('/pricing');
        return;
      }
      navigate(b.dataset.go);
    });
  });
  bindPromoHandlers(el);
}

// =====================================================================
// 视图：我的设置
// =====================================================================

function renderSettings(el) {
  const p = store.profile;
  el.innerHTML = `
    ${NavBar({ title: '设置' })}

    <div class="large-title">
      设置
      <div class="large-title-subtitle">头像、昵称与收款码</div>
    </div>

    <div class="screen-content">
      <div class="profile-hero" style="padding-top:0">
        ${AvatarHTML(p, 80)}
        <button class="btn btn-ghost btn-sm" id="btn-upload-avatar" style="margin-top:8px">更换头像</button>
        <input type="file" id="file-avatar" accept="image/*" hidden/>
      </div>

      <div class="section-header"><span>个人信息</span></div>
      <div class="field-group">
        <div class="field inline">
          <label>昵称</label>
          <input id="inp-nickname" type="text" maxlength="20" placeholder="必填" value="${esc(p.nickname)}"/>
        </div>
        <div class="field inline">
          <label>简介</label>
          <input id="inp-bio" type="text" maxlength="40" placeholder="可选，一句话" value="${esc(p.bio)}"/>
        </div>
        <div class="field inline">
          <label>时薪</label>
          <input id="inp-rate" type="number" min="0" step="0.01" placeholder="可选" value="${p.hourlyRate || ''}"/>
        </div>
        <div class="field" style="padding-top:0">
          <div class="helper">设置后可在"创建账单"时按"小时 × 时薪"快速添加临时项。</div>
        </div>
      </div>

      <div class="section-header"><span>微信收款码</span></div>
      <div class="field-group">
        <div class="qr-single">
          <div class="qr-slot wechat ${p.wechatQR ? 'has-image' : ''}" id="slot-wechat">
            ${
              p.wechatQR
                ? `<img src="${esc(p.wechatQR)}" alt="微信收款码"/>
                   <span class="remove-btn" data-remove="wechat">×</span>`
                : `<div class="placeholder"><span class="icon">💚</span>点击上传微信收款码</div>`
            }
          </div>
          <input type="file" id="file-wechat" accept="image/*" hidden/>
          <div class="qr-hint">建议使用<strong>赞赏码</strong>，更安全</div>
        </div>
        <div class="field" style="padding-top:0">
          <div class="helper">
            <strong>如何获取赞赏码：</strong>微信 → 我 → 服务 → 收付款 →「赞赏码」→ 保存图片。<br/>
            收款码仅保存在本机，不会上传到任何服务器。
          </div>
        </div>
      </div>
    </div>

    <div class="bottom-bar">
      <button class="btn btn-primary btn-block" id="btn-save-profile">保存</button>
    </div>
  `;

  bindBackBtn(el);

  // 重渲染前先把表单里"用户已填但未点保存"的内容同步到 store，避免重置丢失
  const captureFormDraft = () => {
    const n = $('#inp-nickname', el);
    const b = $('#inp-bio', el);
    const r = $('#inp-rate', el);
    if (n) store.profile.nickname = n.value.trim() || store.profile.nickname || '';
    if (b) store.profile.bio = b.value.trim();
    if (r) store.profile.hourlyRate = parseFloat(r.value) || 0;
  };

  $('#btn-upload-avatar', el).addEventListener('click', () => {
    haptic('light');
    $('#file-avatar', el).click();
  });
  $('#file-avatar', el).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const url = await fileToDataURL(f, 240);
      captureFormDraft();
      store.profile.avatar = url;
      persist();
      renderSettings(el);
    } catch (_) {
      showToast('头像上传失败');
    }
  });

  const bindQR = (slot, file, key) => {
    $('#' + slot, el).addEventListener('click', (e) => {
      if (e.target.dataset.remove) return;
      $('#' + file, el).click();
    });
    $('#' + file, el).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const url = await fileToDataURL(f, 600);
        captureFormDraft();
        store.profile[key] = url;
        persist();
        renderSettings(el);
        haptic('medium');
      } catch (_) {
        showToast('二维码上传失败');
      }
    });
  };
  bindQR('slot-wechat', 'file-wechat', 'wechatQR');

  $$('[data-remove]', el).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      captureFormDraft();
      if (b.dataset.remove === 'wechat') store.profile.wechatQR = '';
      persist();
      renderSettings(el);
    });
  });

  $('#btn-save-profile', el).addEventListener('click', () => {
    store.profile.nickname = $('#inp-nickname', el).value.trim() || '我';
    store.profile.bio = $('#inp-bio', el).value.trim();
    store.profile.hourlyRate = parseFloat($('#inp-rate', el).value) || 0;
    persist();
    haptic('medium');
    showToast('已保存');
    setTimeout(goBack, 400);
  });
}

// =====================================================================
// 视图：价目表管理
// =====================================================================

function renderPricing(el) {
  el.innerHTML = `
    ${NavBar({
      title: '价目表',
      right: `<button class="nav-action" id="btn-add-plan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>`,
    })}

    <div class="large-title">
      价目表
      <div class="large-title-subtitle">为不同项目定义单次价格。</div>
    </div>

    <div class="screen-content">
      <div class="group">
        ${
          store.plans.length === 0
            ? `<div class="empty"><div class="icon">📋</div>暂无价目，点击右上角「＋」添加</div>`
            : store.plans
                .map(
                  (p) => `
              <div class="plan-row">
                <div class="plan-icon-circle">${esc(p.icon || '💼')}</div>
                <div class="plan-body">
                  <div class="name">${esc(p.label)}</div>
                  <div class="meta">${p.hours} 小时 · ¥${formatMoney(p.amount)}</div>
                </div>
                <div class="row-action-btns">
                  <button data-edit="${p.id}" aria-label="编辑">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="danger" data-del="${p.id}" aria-label="删除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </div>
              </div>
            `,
                )
                .join('')
        }
      </div>
    </div>
  `;

  bindBackBtn(el);
  $('#btn-add-plan', el).addEventListener('click', () => {
    haptic('light');
    openPlanEditor();
  });
  $$('[data-edit]', el).forEach((b) =>
    b.addEventListener('click', () => {
      haptic('light');
      openPlanEditor(b.dataset.edit);
    }),
  );
  $$('[data-del]', el).forEach((b) =>
    b.addEventListener('click', () => {
      haptic('medium');
      openConfirmDelete(b.dataset.del);
    }),
  );
}

function openConfirmDelete(id) {
  const plan = store.plans.find((p) => p.id === id);
  if (!plan) return;
  const mask = showModal(
    `
    <div class="modal-header">
      <div></div>
      <h2>删除价目</h2>
      <button class="modal-close" data-close>×</button>
    </div>
    <p style="margin:0 0 18px;color:var(--label-secondary);font-size:14px;line-height:1.5;text-align:center">
      确定要删除「${esc(plan.label)}」吗？此操作不可撤销。
    </p>
    <button class="btn btn-danger btn-block" id="confirm-del">删除</button>
    <button class="btn btn-ghost btn-block" data-close style="margin-top:8px">取消</button>
  `,
    { bottom: false },
  );
  mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal()));
  mask.querySelector('#confirm-del').addEventListener('click', () => {
    store.plans = store.plans.filter((p) => p.id !== id);
    persist();
    closeModal(() => PageStack.reRenderCurrent());
    showToast('已删除');
  });
}

function openPlanEditor(id) {
  const editing = id ? store.plans.find((p) => p.id === id) : null;
  const draft = editing
    ? { ...editing }
    : { id: uid(), icon: '💼', label: '', hours: 1, amount: 50 };

  const mask = showModal(`
    <div class="modal-header">
      <button class="modal-close" data-close>×</button>
      <h2>${editing ? '编辑价目' : '新增价目'}</h2>
      <span></span>
    </div>

    <div class="modal-scroll">
      <div class="section-header"><span>图标</span></div>
      <div class="field-group">
        <div class="icon-grid" id="icon-picker">
          ${ICON_CHOICES.map(
            (ic) => `<button data-icon="${ic}" class="${ic === draft.icon ? 'is-active' : ''}">${ic}</button>`,
          ).join('')}
        </div>
      </div>

      <div class="section-header"><span>详情</span></div>
      <div class="field-group">
        <div class="field inline">
          <label>名称</label>
          <input id="ed-label" type="text" maxlength="20" placeholder="例如：工作日加班 1 小时" value="${esc(draft.label)}"/>
        </div>
        <div class="field inline">
          <label>时长</label>
          <input id="ed-hours" type="number" min="0" step="0.5" value="${draft.hours}"/>
        </div>
        <div class="field inline">
          <label>金额</label>
          <input id="ed-amount" type="number" min="0" step="0.01" value="${draft.amount}"/>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-primary btn-block" id="ed-save">${editing ? '保存' : '新增'}</button>
    </div>
  `);

  mask.querySelectorAll('#icon-picker button').forEach((b) => {
    b.addEventListener('click', () => {
      haptic('light');
      draft.icon = b.dataset.icon;
      mask.querySelectorAll('#icon-picker button').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
    });
  });

  mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal()));

  mask.querySelector('#ed-save').addEventListener('click', () => {
    const label = mask.querySelector('#ed-label').value.trim();
    const hours = parseFloat(mask.querySelector('#ed-hours').value) || 0;
    const amount = parseFloat(mask.querySelector('#ed-amount').value) || 0;
    if (!label) return showToast('请填写名称');
    if (amount <= 0) return showToast('金额必须大于 0');

    draft.label = label;
    draft.hours = hours;
    draft.amount = amount;

    if (editing) {
      // 编辑：原位更新，并提到列表最前（让首页前 4 条预览能立刻看见改动）
      store.plans = [draft, ...store.plans.filter((p) => p.id !== editing.id)];
    } else {
      // 新增：插入到列表最前，让首页前 4 条预览能立刻看见
      store.plans.unshift(draft);
    }
    persist();
    haptic('medium');
    closeModal(() => PageStack.reRenderCurrent());
    showToast(editing ? '已更新' : '已新增');
  });
}

// =====================================================================
// 视图：创建账单
// =====================================================================

let draftBill = null;

function getDraft() {
  if (!draftBill) {
    // 默认沿用上次主题（如果有），让常用场景"创建即可发"
    const lastTheme = store.lastTheme || { ...DEFAULT_THEME };
    draftBill = { items: {}, customItems: [], note: '', theme: { ...lastTheme } };
  }
  if (!draftBill.theme) draftBill.theme = { ...DEFAULT_THEME };
  return draftBill;
}

function renderCreate(el) {
  const d = getDraft();
  const plans = store.plans;
  const total =
    plans.reduce((s, p) => s + (d.items[p.id] || 0) * p.amount, 0) +
    d.customItems.reduce((s, c) => s + c.qty * c.amount, 0);

  el.innerHTML = `
    ${NavBar({ title: '创建账单' })}
    <div class="large-title">
      创建账单
      <div class="large-title-subtitle">勾选项目并调整数量，自动汇总。</div>
    </div>

    <div class="screen-content" style="padding-bottom:120px">
      <div class="section-header"><span>主题</span></div>
      <button class="row theme-row" id="btn-theme">
        <div class="leading"><div class="theme-emoji">${esc(d.theme.emoji || '💰')}</div></div>
        <div class="middle">
          <div class="title">${esc(d.theme.title || '设置主题')}</div>
          <div class="subtitle">${esc(d.theme.desc || '点击选择或自定义')}</div>
        </div>
        <div class="trailing">${ChevronRight()}</div>
      </button>

      <div class="section-header"><span>我的价目</span></div>
      <div class="group">
        ${
          plans.length === 0
            ? `<div class="empty"><div class="icon">📋</div>请先到价目表添加</div>`
            : plans
                .map((p) => {
                  const qty = d.items[p.id] || 0;
                  return `
              <div class="plan-row ${qty > 0 ? 'is-selected' : ''}" data-plan="${p.id}">
                <div class="plan-icon-circle">${esc(p.icon || '💼')}</div>
                <div class="plan-body">
                  <div class="name">${esc(p.label)}</div>
                  <div class="meta">${p.hours}h · ¥${formatMoney(p.amount)}/次</div>
                </div>
                ${
                  qty > 0
                    ? `<div class="stepper">
                        <button data-act="dec" data-plan="${p.id}">−</button>
                        <span class="count">${qty}</span>
                        <button data-act="inc" data-plan="${p.id}">＋</button>
                      </div>`
                    : `<div class="plan-price"><div class="amount tabular">¥${formatMoney(p.amount)}</div><div class="unit">点击添加</div></div>`
                }
              </div>
            `;
                })
                .join('')
        }
      </div>

      <div class="section-header">
        <span>临时项目</span>
        <a class="link" id="btn-add-custom">＋ 自定义</a>
      </div>
      ${
        d.customItems.length === 0
          ? `<div class="group"><div class="empty" style="padding:24px 16px;font-size:13px">${
              store.profile.hourlyRate > 0
                ? `当前时薪 ¥${formatMoney(store.profile.hourlyRate)}/h，点击"+ 自定义"快速添加`
                : '没有临时项目'
            }</div></div>`
          : `<div class="group">${d.customItems
              .map(
                (c) => `
            <div class="plan-row is-selected">
              <div class="plan-icon-circle">🧮</div>
              <div class="plan-body">
                <div class="name">${esc(c.label)}</div>
                <div class="meta">${c.hours}h × ¥${formatMoney(c.amount)}</div>
              </div>
              <div class="stepper">
                <button data-act="cdec" data-id="${c.id}">−</button>
                <span class="count">${c.qty}</span>
                <button data-act="cinc" data-id="${c.id}">＋</button>
              </div>
            </div>
          `,
              )
              .join('')}</div>`
      }

      <div class="section-header"><span>备注</span></div>
      <div class="field-group">
        <div class="field">
          <textarea id="bill-note" maxlength="100" placeholder="可选，例如：5月20日帮忙改方案">${esc(d.note)}</textarea>
        </div>
      </div>
    </div>

    <div class="bottom-bar with-summary">
      <div class="bottom-summary">
        <span class="label">合计</span>
        <span class="total tabular"><small>¥</small>${formatMoney(total)}</span>
      </div>
      <button class="btn btn-primary btn-block" id="btn-generate" ${total <= 0 ? 'disabled' : ''}>生成分享链接</button>
    </div>
  `;

  bindBackBtn(el);

  $('#btn-theme', el).addEventListener('click', () => {
    haptic('light');
    openThemePicker(el);
  });

  $$('.plan-row[data-plan]', el).forEach((card) => {
    card.addEventListener('click', (e) => {
      const planId = card.dataset.plan;
      const t = e.target.closest('[data-act]');
      haptic('light');
      if (t) {
        e.stopPropagation();
        const cur = d.items[planId] || 0;
        if (t.dataset.act === 'inc') d.items[planId] = cur + 1;
        else {
          const n = cur - 1;
          if (n <= 0) delete d.items[planId];
          else d.items[planId] = n;
        }
      } else {
        if (!d.items[planId]) d.items[planId] = 1;
      }
      renderCreate(el);
    });
  });

  $$('[data-act="cinc"]', el).forEach((b) =>
    b.addEventListener('click', () => {
      haptic('light');
      const c = d.customItems.find((x) => x.id === b.dataset.id);
      c.qty++;
      renderCreate(el);
    }),
  );
  $$('[data-act="cdec"]', el).forEach((b) =>
    b.addEventListener('click', () => {
      haptic('light');
      const c = d.customItems.find((x) => x.id === b.dataset.id);
      c.qty--;
      if (c.qty <= 0) d.customItems = d.customItems.filter((x) => x.id !== c.id);
      renderCreate(el);
    }),
  );

  $('#bill-note', el).addEventListener('input', (e) => {
    d.note = e.target.value;
  });

  $('#btn-add-custom', el).addEventListener('click', () => {
    haptic('light');
    openCustomEditor(el);
  });

  $('#btn-generate', el).addEventListener('click', () => {
    haptic('medium');
    generateBillAndJump();
  });
}

function openThemePicker(screenEl) {
  const d = getDraft();
  // 当前主题：尝试匹配预设；不匹配则视为自定义
  const matchPreset = THEME_PRESETS.find(
    (p) => p.emoji === d.theme.emoji && p.title === d.theme.title,
  );
  let mode = matchPreset && matchPreset.id !== 'custom' ? 'preset' : 'custom';
  let working = { ...d.theme };

  const renderBody = () => {
    const presetsHTML = THEME_PRESETS.filter((p) => p.id !== 'custom')
      .map(
        (p) => `
        <button class="theme-card ${working.title === p.title && working.emoji === p.emoji && mode === 'preset' ? 'is-active' : ''}"
                data-preset="${p.id}">
          <div class="theme-card-emoji">${p.emoji}</div>
          <div class="theme-card-title">${esc(p.title)}</div>
        </button>
      `,
      )
      .join('');

    return `
      <div class="modal-header">
        <button class="modal-close" data-close>×</button>
        <h2>选择主题</h2>
        <span></span>
      </div>

      <div class="modal-scroll">
        <div class="section-header"><span>常用主题</span></div>
        <div class="theme-grid">
          ${presetsHTML}
        </div>

        <div class="section-header"><span>自定义</span></div>
        <div class="field-group">
          <div class="field">
            <label>表情图标</label>
            <div class="icon-grid" id="th-emoji-grid" style="padding:8px 0 0">
              ${THEME_EMOJI_CHOICES.map(
                (e) =>
                  `<button data-emoji="${e}" class="${working.emoji === e ? 'is-active' : ''}">${e}</button>`,
              ).join('')}
            </div>
          </div>
          <div class="field inline">
            <label>主题标题</label>
            <input id="th-title" type="text" maxlength="16" value="${esc(working.title)}" placeholder="例如：周年纪念"/>
          </div>
          <div class="field inline">
            <label>一句话描述</label>
            <input id="th-desc" type="text" maxlength="30" value="${esc(working.desc)}" placeholder="可选，给对方看的副标题"/>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary btn-block" id="th-save">完成</button>
      </div>
    `;
  };

  const mask = showModal(renderBody());

  // 因为内容里有重复 id（preset 按钮 + emoji 按钮），逐步绑事件
  const bind = () => {
    mask.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => closeModal()),
    );

    mask.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.preset;
        const p = THEME_PRESETS.find((x) => x.id === id);
        if (!p) return;
        haptic('light');
        working = { emoji: p.emoji, title: p.title, desc: p.desc };
        mode = 'preset';
        // 局部更新选中态
        mask.querySelectorAll('[data-preset]').forEach((x) =>
          x.classList.toggle('is-active', x.dataset.preset === id),
        );
        // 同步自定义区域的输入
        mask.querySelector('#th-title').value = p.title;
        mask.querySelector('#th-desc').value = p.desc;
        mask.querySelectorAll('#th-emoji-grid button').forEach((x) =>
          x.classList.toggle('is-active', x.dataset.emoji === p.emoji),
        );
      });
    });

    mask.querySelectorAll('#th-emoji-grid button').forEach((b) => {
      b.addEventListener('click', () => {
        haptic('light');
        working.emoji = b.dataset.emoji;
        mode = 'custom';
        mask.querySelectorAll('#th-emoji-grid button').forEach((x) =>
          x.classList.toggle('is-active', x === b),
        );
        mask.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('is-active'));
      });
    });

    mask.querySelector('#th-title').addEventListener('input', (e) => {
      working.title = e.target.value;
      mode = 'custom';
      mask.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('is-active'));
    });
    mask.querySelector('#th-desc').addEventListener('input', (e) => {
      working.desc = e.target.value;
      mode = 'custom';
      mask.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('is-active'));
    });

    mask.querySelector('#th-save').addEventListener('click', () => {
      const title = (working.title || '').trim();
      if (!title) return showToast('请填写主题标题');
      d.theme = {
        emoji: working.emoji || '💰',
        title,
        desc: (working.desc || '').trim(),
      };
      haptic('medium');
      closeModal(() => renderCreate(screenEl));
    });
  };
  bind();
}

function openCustomEditor(screenEl) {
  const defaultRate = store.profile.hourlyRate || 50;
  const mask = showModal(`
    <div class="modal-header">
      <button class="modal-close" data-close>×</button>
      <h2>临时项目</h2>
      <span></span>
    </div>
    <div class="modal-scroll">
      <div class="field-group">
        <div class="field inline">
          <label>名称</label>
          <input id="ci-label" type="text" maxlength="20" placeholder="例如：临时项目、跑腿费" value="临时项目"/>
        </div>
        <div class="field inline">
          <label>时长</label>
          <input id="ci-hours" type="number" min="0" step="0.5" value="1"/>
        </div>
        <div class="field inline">
          <label>时薪</label>
          <input id="ci-rate" type="number" min="0" step="0.01" value="${defaultRate}"/>
        </div>
        <div class="field inline">
          <label>合计</label>
          <span id="ci-total" class="tabular" style="font-size:17px;font-weight:600;color:var(--ios-blue)">¥0.00</span>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" id="ci-save">添加项目</button>
    </div>
  `);

  const update = () => {
    const h = parseFloat(mask.querySelector('#ci-hours').value) || 0;
    const r = parseFloat(mask.querySelector('#ci-rate').value) || 0;
    mask.querySelector('#ci-total').textContent = '¥' + formatMoney(h * r);
  };
  mask.querySelector('#ci-hours').addEventListener('input', update);
  mask.querySelector('#ci-rate').addEventListener('input', update);
  update();

  mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal()));
  mask.querySelector('#ci-save').addEventListener('click', () => {
    const label = mask.querySelector('#ci-label').value.trim() || '临时项目';
    const hours = parseFloat(mask.querySelector('#ci-hours').value) || 0;
    const rate = parseFloat(mask.querySelector('#ci-rate').value) || 0;
    if (hours <= 0 || rate <= 0) return showToast('时长和单价必须大于 0');
    const d = getDraft();
    d.customItems.push({
      id: uid(),
      label,
      hours,
      amount: parseFloat((hours * rate).toFixed(2)),
      qty: 1,
    });
    haptic('medium');
    closeModal(() => renderCreate(screenEl));
  });
}

function buildBillFromDraft() {
  const d = getDraft();
  const items = [];
  for (const p of store.plans) {
    const qty = d.items[p.id] || 0;
    if (qty > 0) items.push({ label: p.label, icon: p.icon, hours: p.hours, amount: p.amount, qty });
  }
  for (const c of d.customItems) {
    items.push({ label: c.label, icon: '🧮', hours: c.hours, amount: c.amount, qty: c.qty });
  }
  const total = items.reduce((s, it) => s + it.amount * it.qty, 0);
  return {
    id: uid(),
    theme: { ...DEFAULT_THEME, ...(d.theme || {}) },
    items,
    total: parseFloat(total.toFixed(2)),
    note: d.note || '',
    createdAt: Date.now(),
    status: 'pending',
  };
}

function generateBillAndJump() {
  const bill = buildBillFromDraft();
  if (bill.items.length === 0) return showToast('请至少选择一项');
  store.bills.unshift(bill);
  store.lastTheme = { ...bill.theme }; // 记住，下次默认沿用
  persist();
  draftBill = null;
  navigate('/bill/' + bill.id);
}

// =====================================================================
// 视图：本地账单详情
// =====================================================================

function renderLocalBill(el, billId) {
  const bill = store.bills.find((b) => b.id === billId);
  if (!bill) {
    showToast('账单不存在');
    setTimeout(goBack, 200);
    return;
  }

  const profile = store.profile;
  const sharePayload = {
    v: 1,
    p: {
      n: profile.nickname,
      a: profile.avatar,
      b: profile.bio,
      w: profile.wechatQR,
    },
    b: bill,
  };
  const shareURL = `${location.origin}${location.pathname}#/pay?d=${encodeShare(sharePayload)}`;

  const theme = billTheme(bill);

  el.innerHTML = `
    ${NavBar({ title: theme.title || '账单详情' })}
    <div class="large-title">账单详情</div>

    <div class="screen-content" style="padding-bottom:120px">
      <div class="bill-hero">
        <div class="theme-badge"><span class="emoji">${esc(theme.emoji)}</span><span>${esc(theme.title)}</span></div>
        <div class="label">应收</div>
        <div class="amount tabular"><small>¥</small>${formatMoney(bill.total)}</div>
        ${bill.note ? `<div class="note">${esc(bill.note)}</div>` : ''}
      </div>

      <div class="section-header"><span>明细</span></div>
      <div class="group">
        <div class="bill-items">
          ${bill.items
            .map(
              (it) => `
            <div class="bill-item">
              <div class="emoji">${esc(it.icon || '💼')}</div>
              <div>
                <div class="name">${esc(it.label)}</div>
                <div class="meta">${it.hours}h × ¥${formatMoney(it.amount)} × ${it.qty}</div>
              </div>
              <div class="sub tabular">¥${formatMoney(it.amount * it.qty)}</div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>

      <div class="section-header"><span>分享给对方</span></div>
      <div class="share-card">
        <div class="preview">
          ${AvatarHTML(profile, 56)}
          <div class="info">
            <strong>${esc(profile.nickname || '我')} 发起了一笔「${esc(theme.title)}」</strong>
            <span>合计 ¥${formatMoney(bill.total)} · ${bill.items.length} 项</span>
          </div>
        </div>
        <div class="share-actions">
          <button class="btn btn-primary btn-block" id="btn-gen-image">
            <span class="emoji" aria-hidden="true">🖼️</span>
            生成账单图片
          </button>
        </div>
      </div>

      <p class="muted" style="font-size:12px;line-height:1.7;padding:14px 4px 0">
        生成后<strong>长按图片保存到相册</strong>，发到微信群、朋友圈或私聊。<br/>
        对方<strong>长按图片</strong>即可识别二维码完成付款。
      </p>
    </div>

    <div class="bottom-bar with-summary">
      <div class="bottom-summary">
        <span class="label">状态</span>
        <span><span class="badge ${bill.status}">${bill.status === 'paid' ? '已收款' : '未收款'}</span></span>
      </div>
      ${
        bill.status === 'pending'
          ? `<button class="btn btn-primary btn-block" id="btn-mark">标记为已收款</button>`
          : `<button class="btn btn-secondary btn-block" id="btn-unmark">撤销已收款</button>`
      }
    </div>
  `;

  bindBackBtn(el);

  $('#btn-gen-image', el).addEventListener('click', () => {
    haptic('medium');
    if (!profile.wechatQR) {
      showToast('请先在「我的」上传微信收款码');
      return;
    }
    openBillImageSheet(bill, profile);
  });

  const m = $('#btn-mark', el);
  if (m) {
    m.addEventListener('click', () => {
      bill.status = 'paid';
      bill.paidAt = Date.now();
      persist();
      showSuccess('已标记为已收款', '可以在「账单历史」回顾这笔记录。', () => renderLocalBill(el, billId));
    });
  }
  const um = $('#btn-unmark', el);
  if (um) {
    um.addEventListener('click', () => {
      bill.status = 'pending';
      delete bill.paidAt;
      persist();
      renderLocalBill(el, billId);
    });
  }
}

// =====================================================================
// 视图：账单历史
// =====================================================================

function renderHistory(el) {
  const bills = store.bills;
  el.innerHTML = `
    ${NavBar({ title: '账单历史' })}
    <div class="large-title">
      账单历史
      <div class="large-title-subtitle">共 ${bills.length} 条记录</div>
    </div>

    <div class="screen-content">
      ${
        bills.length === 0
          ? `<div class="empty"><div class="icon">📭</div>还没有任何账单<br/><button class="btn btn-ghost btn-sm" data-go="/create" style="margin-top:12px">去创建</button></div>`
          : `<div class="group">${bills
              .map((b) => {
                const t = billTheme(b);
                return `
            <button class="history-card" data-id="${b.id}">
              <div class="history-emoji">${esc(t.emoji)}</div>
              <div class="history-main">
                <div class="title">${esc(t.title)}</div>
                <div class="meta">${formatDateTime(b.createdAt)} · ${b.items.length} 项${b.note ? ' · ' + esc(b.note) : ''}</div>
              </div>
              <div class="right">
                <div class="amount tabular">¥${formatMoney(b.total)}</div>
                <span class="badge ${b.status}">${b.status === 'paid' ? '已收款' : '未收款'}</span>
              </div>
            </button>
          `;
              })
              .join('')}</div>`
      }
    </div>
  `;

  bindBackBtn(el);
  $$('.history-card', el).forEach((c) => {
    c.addEventListener('click', () => {
      haptic('light');
      navigate('/bill/' + c.dataset.id);
    });
  });
  $$('[data-go]', el).forEach((b) =>
    b.addEventListener('click', () => {
      haptic('light');
      navigate(b.dataset.go);
    }),
  );
}

// =====================================================================
// 视图：付款页（被分享人）
// =====================================================================

function renderPay(el, encoded) {
  const payload = decodeShare(encoded);
  if (!payload || !payload.b || !payload.p) {
    el.innerHTML = `
      ${NavBar({ title: '另外的价钱', back: false })}
      <div class="large-title">链接无效</div>
      <div class="screen-content"><div class="empty"><div class="icon">⚠️</div>这个链接可能已失效或损坏</div></div>
    `;
    return;
  }

  const { p: payee, b: bill } = payload;
  const theme = billTheme(bill);
  const hasWX = !!payee.w;
  const payMode = hasWX ? 'wechat' : null;

  const render = () => {
    el.innerHTML = `
      ${NavBar({ title: theme.title || payee.n || '收款', back: false })}

      <div class="screen-content">
        <div class="profile-hero" style="padding-top:24px">
          ${AvatarHTML(payee, 80)}
          <p class="profile-name">${esc(payee.n || '匿名')}</p>
          <p class="profile-bio">向你发起了一笔「${esc(theme.title)}」</p>
        </div>

        <div class="bill-hero">
          <div class="theme-badge"><span class="emoji">${esc(theme.emoji)}</span><span>${esc(theme.title)}</span></div>
          <div class="label">应付</div>
          <div class="amount tabular"><small>¥</small>${formatMoney(bill.total)}</div>
          ${theme.desc ? `<div class="note">${esc(theme.desc)}</div>` : ''}
          ${bill.note ? `<div class="note">备注：${esc(bill.note)}</div>` : ''}
        </div>

        <div class="section-header"><span>明细</span></div>
        <div class="group">
          <div class="bill-items">
            ${bill.items
              .map(
                (it) => `
              <div class="bill-item">
                <div class="emoji">${esc(it.icon || '💼')}</div>
                <div>
                  <div class="name">${esc(it.label)}</div>
                  <div class="meta">${it.hours}h × ¥${formatMoney(it.amount)} × ${it.qty}</div>
                </div>
                <div class="sub tabular">¥${formatMoney(it.amount * it.qty)}</div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>

        ${
          !payMode
            ? `<div class="group" style="margin-top:22px"><div class="empty">收款人未上传微信收款码，请联系发起人</div></div>`
            : `
          <div class="qr-display">
            <div class="frame" id="qr-frame">
              <img src="${esc(payee.w)}" alt="微信收款码"/>
              ${
                shouldShowPressHint()
                  ? `<div class="qr-press-hint" aria-hidden="true">
                       <div class="ring"></div>
                       <div class="ring"></div>
                       <div class="dot"></div>
                     </div>`
                  : ''
              }
            </div>
            <div class="tip">
              <strong>长按二维码即可识别付款</strong>
              ${
                isWeChat()
                  ? '在微信内长按 → 识别图中二维码'
                  : '请用微信"扫一扫"或保存图片后从相册扫码'
              }
            </div>
          </div>

        `
        }
      </div>

      ${
        payMode
          ? `<div class="bottom-bar">
              <button class="btn btn-primary btn-block" id="btn-paid">我已支付 ¥${formatMoney(bill.total)}</button>
            </div>`
          : ''
      }
    `;

    const paid = $('#btn-paid', el);
    if (paid) {
      paid.addEventListener('click', () => {
        haptic('heavy');
        openPaidReceiptSheet(payee, bill, payMode);
      });
    }

    bindPromoHandlers(el);
  };

  render();
}

// 发起人点"生成账单图片"后的预览 + 保存弹层
function openBillImageSheet(bill, profile) {
  const inWeChat = isWeChat();
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // 在移动端 / 微信里，主路径就是"长按图片保存"；
  // 在桌面端，给"下载到电脑"按钮。
  const tipText = inWeChat
    ? '<strong>长按上方图片 → 保存到相册</strong><br/>然后在微信里发给对方，对方长按图片即可识别二维码付款。'
    : isMobile
      ? '<strong>长按上方图片 → 保存到相册</strong><br/>然后在微信里发给对方，对方长按图片即可识别二维码付款。'
      : '<strong>右键图片 → 图片另存为，或点下方按钮下载。</strong><br/>把图片发到微信群/聊天里，对方长按图片即可扫码付款。';

  const mask = showModal(`
    <div class="modal-header">
      <div style="width:32px"></div>
      <h2>账单图片</h2>
      <button class="modal-close" data-close>×</button>
    </div>
    <div class="modal-scroll">
      <div class="bill-image-loading" id="bi-loading">
        <div class="spinner"></div>
        <p>正在生成图片…</p>
      </div>
      <div class="bill-image-preview" id="bi-preview" hidden>
        <img id="bi-img" alt="账单图片"/>
      </div>
      <p class="bill-image-tip" id="bi-tip" hidden>${tipText}</p>
    </div>
    <div class="modal-footer" id="bi-footer" hidden>
      <button class="btn btn-primary btn-block" id="bi-download">
        ${isMobile ? '在新窗口打开（再长按保存）' : '下载图片到本地'}
      </button>
    </div>
  `);

  let blobURL = null;
  const cleanup = () => {
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
      blobURL = null;
    }
  };
  mask.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      cleanup();
      closeModal();
    }),
  );

  (async () => {
    try {
      const { dataURL, blob } = await generateBillImage(bill, profile);
      const loading = mask.querySelector('#bi-loading');
      const preview = mask.querySelector('#bi-preview');
      const tip = mask.querySelector('#bi-tip');
      const footer = mask.querySelector('#bi-footer');
      const img = mask.querySelector('#bi-img');

      img.src = dataURL;
      loading.hidden = true;
      preview.hidden = false;
      tip.hidden = false;
      footer.hidden = false;

      blobURL = URL.createObjectURL(blob);
      const theme = billTheme(bill);
      const fileName = safeFileName(`${theme.title}-${formatMoney(bill.total)}`) + '.png';

      mask.querySelector('#bi-download').addEventListener('click', async () => {
        haptic('light');

        // 移动端 / 微信内：a.download 不一定生效，直接新窗口打开图片，用户长按保存
        if (isMobile) {
          window.open(blobURL, '_blank');
          return;
        }

        // 桌面端：用 blob URL + 清理过的文件名触发下载
        const a = document.createElement('a');
        a.href = blobURL;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('已开始下载');
      });
    } catch (e) {
      const loading = mask.querySelector('#bi-loading');
      loading.innerHTML = '<p style="color:var(--ios-red)">生成失败，请稍后重试</p>';
    }
  })();
}

// 被分享人点"我已支付"后弹出的回执确认面板
function openPaidReceiptSheet(payee, bill, payMode) {
  const theme = billTheme(bill);
  const payeeName = payee.n || '对方';
  const mask = showModal(`
    <div class="modal-header">
      <button class="modal-close" data-close>×</button>
      <h2>确认已支付</h2>
      <div style="width:32px"></div>
    </div>

    <div class="receipt-confirm">
      <div class="receipt-emoji">${esc(theme.emoji)}</div>
      <div class="receipt-title">${esc(theme.title)}</div>
      <div class="receipt-amount tabular"><small>¥</small>${formatMoney(bill.total)}</div>
      <div class="receipt-meta">付给 ${esc(payeeName)} · 微信</div>
    </div>

    <div class="field-group">
      <div class="field inline">
        <label>留言</label>
        <input id="rc-note" type="text" maxlength="30" placeholder="可选，例如：转账备注里写了我的名字"/>
      </div>
    </div>

    <div class="receipt-tip">
      点击确认后，链接将自动复制到剪贴板。<br/>
      <strong>回到微信粘贴发送给 ${esc(payeeName)}，他点开即完成对账。</strong>
    </div>

    <div class="modal-footer">
      <button class="btn btn-primary btn-block" id="rc-send">已支付，复制回执发给${esc(payeeName)}</button>
    </div>
  `);

  mask.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => closeModal()),
  );

  mask.querySelector('#rc-send').addEventListener('click', async () => {
    haptic('medium');
    const note = mask.querySelector('#rc-note').value.trim();
    const receipt = {
      bid: bill.id,
      t: bill.total,
      tt: theme.title,
      te: theme.emoji,
      pn: payeeName,
      m: payMode || 'wechat',
      at: Date.now(),
      n: note,
    };
    const receiptURL = `${location.origin}${location.pathname}#/receipt?d=${encodeShare(receipt)}`;
    const receiptText = buildReceiptText(bill, payeeName, receiptURL);
    const copied = await copyText(receiptText);

    closeModal(() => {
      showSuccess(
        copied ? '回执已复制' : '回执已生成',
        copied
          ? `请回到微信，粘贴到与 ${esc(payeeName)} 的聊天里发送。<br/>对方点开后会自动收到付款核对提醒。`
          : `请手动复制下方链接发送给 ${esc(payeeName)}：<br/><code style="word-break:break-all;font-size:11px;display:block;margin-top:8px;padding:8px;background:var(--fill-tertiary);border-radius:8px">${esc(receiptURL)}</code>`,
        null,
        { rawDesc: true },
      );
    });
  });
}

// =====================================================================
// 视图：付款回执（收款人/发起人侧）
// =====================================================================

function renderReceipt(el, encoded) {
  const r = decodeShare(encoded);
  if (!r || !r.bid) {
    el.innerHTML = `
      ${NavBar({ title: '付款回执', back: false })}
      <div class="large-title">回执无效</div>
      <div class="screen-content"><div class="empty"><div class="icon">⚠️</div>这个回执链接可能已失效或损坏</div></div>
    `;
    return;
  }

  const bill = store.bills.find((b) => b.id === r.bid);
  const matched = !!bill;
  const payerNote = r.n || '';
  const payMethod = r.m === 'alipay' ? '支付宝' : '微信';
  const when = new Date(r.at);
  const whenText = `${when.getMonth() + 1}月${when.getDate()}日 ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;

  const alreadyPaid = matched && bill.status === 'paid';

  el.innerHTML = `
    ${NavBar({
      title: '付款回执',
      back: false,
      right: matched
        ? `<button class="nav-action" data-go="/home">完成</button>`
        : `<button class="nav-action" data-go="/home">首页</button>`,
    })}

    <div class="screen-content" style="padding-top:8px">
      <div class="receipt-banner ${alreadyPaid ? 'is-done' : matched ? 'is-pending' : 'is-orphan'}">
        <div class="receipt-banner-icon">
          ${alreadyPaid
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<span>🔔</span>'
          }
        </div>
        <div class="receipt-banner-text">
          ${alreadyPaid
            ? `<strong>已确认入账</strong><span>这笔账单状态已是「已收款」</span>`
            : matched
              ? `<strong>对方称已付款，请核对入账</strong><span>已为你匹配到本机的一笔账单</span>`
              : `<strong>对方称已付款</strong><span>未在本机找到对应账单，可能换了设备或清了缓存</span>`
          }
        </div>
      </div>

      <div class="receipt-card">
        <div class="receipt-emoji">${esc(r.te || '💰')}</div>
        <div class="receipt-title">${esc(r.tt || '收款')}</div>
        <div class="receipt-amount tabular"><small>¥</small>${formatMoney(r.t)}</div>
        <div class="receipt-grid">
          <div><span>付款方式</span><b>${payMethod}</b></div>
          <div><span>声称付款时间</span><b>${whenText}</b></div>
          ${payerNote ? `<div class="full"><span>对方留言</span><b>${esc(payerNote)}</b></div>` : ''}
        </div>
      </div>

      ${matched
        ? `
        <div class="section-header"><span>本机匹配到的账单</span></div>
        <button class="row" data-go="/bill/${esc(bill.id)}">
          <div class="leading">
            <div class="row-icon bg-lemon">${esc(billTheme(bill).emoji)}</div>
          </div>
          <div class="middle">
            <div class="title">${esc(billTheme(bill).title)}</div>
            <div class="subtitle">${formatDateTime(bill.createdAt)} · ${bill.items.length} 项 · ¥${formatMoney(bill.total)}</div>
          </div>
          <div class="trailing">
            <span class="badge ${bill.status}">${bill.status === 'paid' ? '已收款' : '未收款'}</span>
          </div>
        </button>
        `
        : `
        <div class="muted" style="font-size:13px;line-height:1.6;padding:14px 16px 0">
          提示：账单数据保存在你发起这笔账单时所用的那台设备/浏览器里。如果你刚换了手机或清空了浏览器数据，可能找不到原始账单。下面这张回执已展示了对方付款的全部声明信息，你可以截图作为凭证。
        </div>
        `
      }
    </div>

    ${matched && !alreadyPaid
      ? `<div class="bottom-bar with-summary">
          <div class="bottom-summary">
            <span class="label">应收</span>
            <span class="tabular" style="font-weight:600;font-size:17px">¥${formatMoney(bill.total)}</span>
          </div>
          <button class="btn btn-primary btn-block" id="btn-confirm-paid">确认已入账，标记为已收款</button>
        </div>`
      : ''
    }
  `;

  $$('[data-go]', el).forEach((b) =>
    b.addEventListener('click', () => {
      haptic('light');
      const dest = b.dataset.go;
      if (dest === '/home') {
        PageStack.replace('/home');
      } else if (dest.startsWith('/bill/')) {
        PageStack.replace('/home');
        PageStack.push(dest);
      } else {
        navigate(dest);
      }
    }),
  );

  const confirmBtn = $('#btn-confirm-paid', el);
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      haptic('heavy');
      const idx = store.bills.findIndex((b) => b.id === r.bid);
      if (idx >= 0) {
        store.bills[idx].status = 'paid';
        store.bills[idx].paidAt = Date.now();
        persist();
      }
      showSuccess('已入账', `这笔「${billTheme(bill).title}」¥${formatMoney(bill.total)} 已标记为已收款。`, () => {
        // 重置栈：home 垫底 → 跳到账单详情，方便返回查看
        PageStack.replace('/home');
        PageStack.push('/bill/' + r.bid);
      });
    });
  }
}

// =====================================================================
// 渲染分发
// =====================================================================

function renderInto(el, path, params) {
  el.scrollTop = 0;
  if (path === '/home') return renderHome(el);
  if (path === '/settings') return renderSettings(el);
  if (path === '/pricing') return renderPricing(el);
  if (path === '/create') return renderCreate(el);
  if (path === '/history') return renderHistory(el);
  if (path.startsWith('/bill/')) return renderLocalBill(el, path.split('/')[2]);
  if (path === '/pay') return renderPay(el, params.d || '');
  if (path === '/receipt') return renderReceipt(el, params.d || '');
  return renderHome(el);
}

// =====================================================================
// 启动
// =====================================================================

function boot() {
  const stack = document.createElement('div');
  stack.className = 'screen-stack';
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(stack);
  PageStack.init(stack);

  // 解析初始 URL
  const hash = location.hash.replace(/^#/, '') || '/home';
  const [path, qs] = hash.split('?');
  const params = {};
  if (qs) new URLSearchParams(qs).forEach((v, k) => (params[k] = v));

  // /pay 和 /receipt 是从外部链接打开、无返回的页面，直接 push
  const isExternal = path === '/pay' || path === '/receipt';
  if (path !== '/home' && !isExternal) {
    PageStack.push('/home', {}, { instant: true });
    PageStack.push(path, params);
  } else {
    PageStack.push(path, params, { instant: true });
  }

  // 监听浏览器返回键（针对手势返回）
  window.addEventListener('popstate', () => {
    if (PageStack.currentPath() !== '/home') {
      goBack();
    }
  });

  // 注册 Service Worker（HTTPS 或 localhost 才会生效；非 file://）
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 静默：SW 失败不影响应用
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
