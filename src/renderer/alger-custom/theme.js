/* 自定义外观：主界面壁纸、界面透明度、夜间模式亮度。在 main.ts 中引入，标题栏调色板按钮打开设置面板。 */
(() => {
  'use strict';

  const KEY = 'algerCustomTheme.v1';
  const DEFAULTS = { enabled: true, transparency: 45, darkLift: 50 };
  const DEFAULT_IMG = new URL('./wallpaper.png', import.meta.url).href;
  const DB_NAME = 'algerCustomTheme';
  const STORE = 'kv';
  const root = document.documentElement;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

  let cfg = load();
  let imageUrl = DEFAULT_IMG;
  let objectUrl = null;
  let panel = null;

  function load() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {
      console.warn('[custom-theme] 保存设置失败', e);
    }
  }

  // ---------- IndexedDB：保存用户选择的壁纸 ----------
  function withStore(mode, run) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE, mode);
        let result;
        const r = run(tx.objectStore(STORE));
        if (r) r.onsuccess = () => (result = r.result);
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  }
  const idbGet = (k) => withStore('readonly', (s) => s.get(k));
  const idbPut = (k, v) => withStore('readwrite', (s) => s.put(v, k));
  const idbDel = (k) => withStore('readwrite', (s) => s.delete(k));

  async function refreshImage() {
    let next = DEFAULT_IMG;
    try {
      const blob = await idbGet('wallpaper');
      if (blob instanceof Blob && blob.size > 0) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        next = objectUrl;
      }
    } catch (e) {
      console.warn('[custom-theme] 读取壁纸失败，使用默认壁纸', e);
    }
    imageUrl = next;
    root.style.setProperty('--ct-image', `url("${imageUrl}")`);
    updatePanel();
  }

  // ---------- 应用设置 ----------
  function apply() {
    const off = /^#\/(lyric|mini)/.test(location.hash);
    root.classList.toggle('ct-off', off);
    root.classList.toggle('ct-wall', !!cfg.enabled);
    const a = (100 - clamp(cfg.transparency, 0, 100)) / 100;
    root.style.setProperty('--ct-a', a.toFixed(3));
    root.style.setProperty('--ct-lift', String(Math.round(clamp(cfg.darkLift, 0, 100) * 0.6)));
    ensureLift();
    scheduleScan();
  }

  function ensureLift() {
    if (!document.body || document.getElementById('ct-lift')) return;
    const d = document.createElement('div');
    d.id = 'ct-lift';
    document.body.appendChild(d);
  }

  // ---------- 清空页面根容器底色，让壁纸透出来 ----------
  function parseRgb(s) {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function isBaseSurface(c) {
    if (!c || c.a < 0.6) return false;
    const dark = root.classList.contains('dark');
    return dark ? Math.max(c.r, c.g, c.b) <= 24 : Math.min(c.r, c.g, c.b) >= 246;
  }
  function isTransparent(cs) {
    const c = parseRgb(cs.backgroundColor);
    return (!c || c.a < 0.05) && cs.backgroundImage === 'none';
  }
  // 只处理“直接压在壁纸上”的元素：从主内容区往下找，只穿过透明的容器。
  // 大面积的纯白/纯黑底色清空；整行宽的标题栏、标签栏改成毛玻璃；其他卡片保持原样。
  function scan() {
    if (!cfg.enabled || root.classList.contains('ct-off')) return;
    const host = document.querySelector('.layout-page .main-content');
    if (!host) return;
    // 设置页有明确的背景层，不需要遍历表单测量布局。
    if (host.querySelector('.settings-page')) return;
    const box = host.getBoundingClientRect();
    const hostArea = box.width * box.height;
    if (hostArea < 1) return;
    let budget = 800;
    // covered：祖先里已经有一层半透明面板，再遇到大块底色就直接清空，避免层层叠加
    let level = [{ el: host, covered: false }];
    for (let depth = 0; depth < 8 && level.length && budget > 0; depth++) {
      const next = [];
      for (const { el, covered } of level) {
        for (const child of el.children) {
          if (--budget <= 0) break;
          const r = child.getBoundingClientRect();
          const area = r.width * r.height;
          if (area < hostArea * 0.02 || r.width < box.width * 0.4) continue;
          const cl = child.classList;
          if (cl.contains('ct-glass')) continue;
          if (cl.contains('ct-clear')) {
            next.push({ el: child, covered });
            continue;
          }
          if (cl.contains('ct-pane')) {
            next.push({ el: child, covered: true });
            continue;
          }
          const cs = getComputedStyle(child);
          if (isTransparent(cs)) {
            next.push({ el: child, covered });
          } else if (cs.backgroundImage === 'none' && isBaseSurface(parseRgb(cs.backgroundColor))) {
            if (area >= hostArea * 0.3) {
              cl.add(covered ? 'ct-clear' : 'ct-pane');
              next.push({ el: child, covered: true });
            } else if (r.width >= box.width * 0.85 && r.height <= 240) {
              cl.add(covered ? 'ct-clear' : 'ct-glass');
            }
          }
        }
      }
      level = next;
    }
  }
  let scanTimer = 0;
  let lastScan = 0;
  let observedHost = null;
  let contentObserver = null;
  function observeContent() {
    const host = document.querySelector('.layout-page .main-content');
    if (host === observedHost) return;
    contentObserver?.disconnect();
    observedHost = host;
    if (!host) return;
    contentObserver = new MutationObserver((records) => {
      if (root.classList.contains('ct-off')) return;
      const changedNearPageRoot = records.some(({ target }) => {
        let node = target;
        for (let depth = 0; node && depth <= 4; depth++, node = node.parentElement) {
          if (node === host) return true;
        }
        return false;
      });
      if (changedNearPageRoot) scheduleScan();
    });
    contentObserver.observe(host, { childList: true, subtree: true });
  }
  function scheduleScan() {
    if (scanTimer) return;
    const wait = Math.max(0, 300 - (Date.now() - lastScan));
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      lastScan = Date.now();
      try {
        ensureButton();
        ensureLift();
        observeContent();
        scan();
      } catch (e) {
        console.warn('[custom-theme] 扫描失败', e);
      }
    }, wait);
  }

  // ---------- 标题栏按钮 ----------
  function ensureButton() {
    const box = document.querySelector('#title-bar #buttons');
    if (!box || box.querySelector('.ct-btn')) return;
    const b = document.createElement('div');
    b.className = 'ct-btn text-gray-600 dark:text-gray-400 hover:text-green-500';
    b.title = '界面美化';
    b.innerHTML = '<i class="iconfont ri-palette-line"></i>';
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
    box.insertBefore(b, box.firstChild);
  }

  // ---------- 设置面板 ----------
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ct-panel';
    panel.innerHTML = `
      <div class="ct-head"><span>界面美化</span><span class="ct-x" title="关闭">×</span></div>
      <div class="ct-row"><span>显示壁纸</span><input type="checkbox" class="ct-enabled"></div>
      <div class="ct-preview"></div>
      <div class="ct-actions">
        <button class="ct-pick ct-primary">更换壁纸</button>
        <button class="ct-default">恢复默认壁纸</button>
      </div>
      <div class="ct-msg"></div>
      <div class="ct-row"><span>界面透明度</span><b class="ct-tv"></b></div>
      <input type="range" min="0" max="100" step="1" class="ct-trans">
      <div class="ct-hint">越高壁纸越清楚，越低文字越清楚</div>
      <div class="ct-row"><span>夜间模式亮度</span><b class="ct-dv"></b></div>
      <input type="range" min="0" max="100" step="1" class="ct-dark">
      <div class="ct-hint">只在夜间模式下生效，0% 为原始效果</div>
      <button class="ct-reset-all">恢复默认设置</button>
      <input type="file" accept="image/*" class="ct-file" hidden>`;
    document.body.appendChild(panel);

    const $ = (s) => panel.querySelector(s);
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    $('.ct-x').addEventListener('click', () => togglePanel(false));
    $('.ct-enabled').addEventListener('change', (e) => {
      cfg.enabled = e.target.checked;
      save();
      apply();
      updatePanel();
    });
    $('.ct-trans').addEventListener('input', (e) => {
      cfg.transparency = clamp(e.target.value, 0, 100);
      save();
      apply();
      updatePanel();
    });
    $('.ct-dark').addEventListener('input', (e) => {
      cfg.darkLift = clamp(e.target.value, 0, 100);
      save();
      apply();
      updatePanel();
    });
    $('.ct-pick').addEventListener('click', () => $('.ct-file').click());
    $('.ct-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showMsg('请选择图片文件');
        return;
      }
      try {
        await idbPut('wallpaper', file);
        cfg.enabled = true;
        save();
        apply();
        await refreshImage();
        showMsg('');
      } catch (err) {
        showMsg('保存壁纸失败：' + (err && err.message ? err.message : err));
      }
    });
    $('.ct-default').addEventListener('click', async () => {
      try {
        await idbDel('wallpaper');
      } catch {
        /* 没有自定义壁纸时忽略 */
      }
      await refreshImage();
    });
    $('.ct-reset-all').addEventListener('click', () => {
      cfg = { ...DEFAULTS };
      save();
      apply();
      updatePanel();
    });
    document.addEventListener('mousedown', (e) => {
      if (
        panel.classList.contains('ct-open') &&
        !panel.contains(e.target) &&
        !e.target.closest('.ct-btn')
      ) {
        togglePanel(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') togglePanel(false);
    });
    updatePanel();
  }
  function showMsg(text) {
    if (panel) panel.querySelector('.ct-msg').textContent = text;
  }
  function updatePanel() {
    if (!panel) return;
    const $ = (s) => panel.querySelector(s);
    $('.ct-enabled').checked = !!cfg.enabled;
    $('.ct-trans').value = cfg.transparency;
    $('.ct-tv').textContent = `${Math.round(cfg.transparency)}%`;
    $('.ct-dark').value = cfg.darkLift;
    $('.ct-dv').textContent = `${Math.round(cfg.darkLift)}%`;
    $('.ct-preview').style.backgroundImage = `url("${imageUrl}")`;
  }
  function togglePanel(force) {
    if (!panel) buildPanel();
    const open = typeof force === 'boolean' ? force : !panel.classList.contains('ct-open');
    panel.classList.toggle('ct-open', open);
  }

  // ---------- 启动 ----------
  function start() {
    apply();
    refreshImage();
    // 路由容器切换时重挂观察器，忽略歌词和列表内部频繁的深层 DOM 更新。
    const appRoot = document.getElementById('app') || document.body;
    new MutationObserver(scheduleScan).observe(appRoot, { childList: true });
    observeContent();
    new MutationObserver(scheduleScan).observe(root, {
      attributes: true,
      attributeFilter: ['class']
    });
    window.addEventListener('hashchange', apply);
    window.addEventListener('resize', scheduleScan);
  }
  window.__algerCustomTheme = {
    get config() {
      return { ...cfg };
    },
    set(partial) {
      cfg = { ...cfg, ...partial };
      save();
      apply();
      updatePanel();
    },
    open: () => togglePanel(true),
    close: () => togglePanel(false),
    rescan: scan
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
