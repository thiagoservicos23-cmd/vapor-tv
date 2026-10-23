/* ============================================================
   VAPOR TV — logica principal
   - Grade de baloes (trilhos horizontais estilo PS5)
   - Player mpegts via protocolo stream:// (proxy Rust, sem CORS)
   - Controle: teclado, mouse, gamepad (Xbox / DualSense)
   ============================================================ */
(function () {
  'use strict';

  // ---------- preparo da lista ----------
  const RAW = (window.CHANNELS || []).filter(c => c && c.url);
  // remove: A Fazenda, Pay-Per-View (PPV) e Bleach
  const BLOCK = /fazenda|bleach|pay[\s-]*per[\s-]*view|payper|\bppv\b/i;
  const is24h = c => /^\s*\[24h\]/i.test(c.name || '') || /^\s*(\[24h\]|24\s*horas)/i.test(c.group || '');
  const isAdult = c => /adulto|\+18|xxx/i.test((c.group || '') + ' ' + (c.name || ''));
  const cleanGroup = g => (g || 'Canais').replace(/^Canais\s*\|\s*/, '') || 'Canais';

  const kept = RAW.filter(c => !BLOCK.test((c.name || '') + ' ' + (c.group || '')));

  // nome base + variante (4K / FHD / HD / SD / [H265])
  const QRANK = { 'FHD': 0, 'HD': 1, 'SD': 2, 'FHD H265': 3, 'HD H265': 4, '4K': 5, '4K H265': 6 };
  function splitVariant(name) {
    let n = name || 'Canal', q = '', h265 = false;
    n = n.replace(/\s*\[(H265|HEVC)\]/ig, () => { h265 = true; return ''; });
    n = n.replace(/\s+(4K|UHD|FHD|FULL\s?HD|HD|SD)\s*$/i, (m, a) => { q = a.toUpperCase().replace(/\s/g, ''); if (q === 'UHD') q = '4K'; if (q === 'FULLHD') q = 'FHD'; return ''; });
    n = n.replace(/\s+(4K|UHD|FHD|HD|SD)(?=\s*\[)/i, (m, a) => { q = a.toUpperCase(); if (q === 'UHD') q = '4K'; return ''; }); // ex: "AXN FHD [LEG]"
    return { base: n.trim(), quality: q, h265 };
  }

  const entryMap = new Map();
  const ENTRIES = [];
  kept.forEach(c => {
    const gName = cleanGroup(c.group);
    const grp = is24h(c) ? '24H' : (isAdult(c) ? 'ADULT' : 'NORMAL');
    const sv = splitVariant(c.name);
    const key = gName + '||' + sv.base.toLowerCase();
    let e = entryMap.get(key);
    if (!e) {
      e = { name: sv.base, logo: c.logo, group: gName, kind: grp, variants: [] };
      entryMap.set(key, e); ENTRIES.push(e);
    }
    if (!e.logo && c.logo) e.logo = c.logo;
    const label = sv.quality ? (sv.quality + (sv.h265 ? ' H265' : '')) : (sv.h265 ? 'H265' : 'Original');
    e.variants.push({ label, url: c.url, logo: c.logo, rank: (label in QRANK) ? QRANK[label] : 9 });
  });
  ENTRIES.forEach(e => {
    e.variants.sort((a, b) => a.rank - b.rank);
    // rotulos repetidos viram "SD", "SD (2)"...
    const seen = {};
    e.variants.forEach(v => { seen[v.label] = (seen[v.label] || 0) + 1; if (seen[v.label] > 1) v.label += ' (' + seen[v.label] + ')'; });
  });
  // ordem final: normais -> 24H -> adultos (estavel)
  const ORD = { NORMAL: 0, '24H': 1, ADULT: 2 };
  ENTRIES.forEach((e, i) => { e._i = i; });
  ENTRIES.sort((a, b) => (ORD[a.kind] - ORD[b.kind]) || (a._i - b._i));
  // grupos precisam ficar contiguos pela ordem do tipo; reordena por tipo+primeira aparicao do grupo
  const gFirst = new Map();
  ENTRIES.forEach((e, i) => { const k = e.kind + '||' + e.group; if (!gFirst.has(k)) gFirst.set(k, i); });
  ENTRIES.sort((a, b) => (ORD[a.kind] - ORD[b.kind]) || (gFirst.get(a.kind + '||' + a.group) - gFirst.get(b.kind + '||' + b.group)) || (a._i - b._i));
  ENTRIES.forEach((e, i) => { e.index = i; });

  // lista plana de variaveis tocaveis (usada pelo player)
  const CHANNELS = [];
  ENTRIES.forEach(e => e.variants.forEach(v => {
    v.entry = e; v.global = CHANNELS.length;
    v.name = e.variants.length > 1 ? `${e.name} · ${v.label}` : e.name;
    v.group = e.group;
    CHANNELS.push(v);
  }));
  if (!ENTRIES.length) {
    document.getElementById('hero-name').textContent = 'Nenhum canal carregado';
    return;
  }

  // ---------- sons de navegacao (PS5) ----------
  const SFX = (() => {
    const files = { nav: 'src/assets/audio/navigation.wav', act: 'src/assets/audio/activation.wav' };
    const vol = { nav: 0.5, act: 0.7 };
    let muted = localStorage.getItem('vaportv_uimute') === '1';
    let ctx = null, ok = false; const buf = {}; const pool = {};
    function init() {
      if (ok || ctx) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        Object.keys(files).forEach(k => fetch(files[k]).then(r => r.arrayBuffer())
          .then(ab => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
          .then(b => { buf[k] = b; }).catch(() => { }));
        ok = true;
      } catch (e) { ctx = null; }
      Object.keys(files).forEach(k => { pool[k] = new Audio(files[k]); pool[k].volume = vol[k]; pool[k].preload = 'auto'; });
    }
    function play(k) {
      if (muted || (!ok && !ctx)) return;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { });
      if (ctx && buf[k]) {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf[k]; g.gain.value = vol[k];
        src.connect(g); g.connect(ctx.destination); src.start(0);
      } else if (pool[k]) { try { const a = pool[k].cloneNode(); a.volume = vol[k]; a.play().catch(() => { }); } catch (e) { } }
    }
    // navegador so libera audio apos um gesto do usuario: inicia no primeiro
    const arm = () => { init(); };
    ['keydown', 'pointerdown', 'mousedown', 'touchstart'].forEach(ev => window.addEventListener(ev, arm, { once: true, capture: true }));
    const btn = document.getElementById('ui-sound-btn');
    const paint = () => { if (btn) { btn.classList.toggle('off', muted); btn.title = muted ? 'Sons da interface: desligados (M / Y)' : 'Sons da interface: ligados (M / Y)'; btn.setAttribute('aria-pressed', muted ? 'true' : 'false'); } };
    function toggle() {
      muted = !muted; localStorage.setItem('vaportv_uimute', muted ? '1' : '0'); paint();
      if (!muted) { arm(); setTimeout(() => play('nav'), 30); } // confirma com um som ao religar
    }
    if (btn) btn.addEventListener('click', e => { e.currentTarget.blur(); toggle(); });
    paint();
    return { nav: () => play('nav'), act: () => play('act'), arm, toggle };
  })();

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const base64url = s => {
    const b = btoa(unescape(encodeURIComponent(s)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  // Proxy HTTP local (Rust, 127.0.0.1) que faz streaming chunked e contorna CORS
  const PROXY_PORT = window.__STREAM_PROXY_PORT || 14311;
  // Tauri (desktop/Android): proxy local em 127.0.0.1. Web (Netlify): Edge Function em /proxy.
  const IS_TAURI = !!(window.__TAURI__ || window.__TAURI_INTERNALS__) || /^tauri:|tauri\.localhost/.test(location.href);
  const PROXY_BASE = window.__WEB_PROXY || (IS_TAURI ? `http://127.0.0.1:${PROXY_PORT}/proxy?u=` : '/proxy?u=');
  const proxyUrl = remote => PROXY_BASE + base64url(remote);

  // Web (https): o navegador bloqueia http:// (conteudo misto). Duas rotas:
  //  0) rewrite do Netlify  /x/<host>/<caminho>  -> http://<host>/<caminho>  (arquivo _redirects, funciona ate com upload por arrastar)
  //  1) Edge Function       /proxy?u=<base64url>
  const HTTPS_PAGE = location.protocol === 'https:';
  function viaRewrite(u) {
    const m = /^http:\/\/([^\/:]+)(?::(\d+))?(\/.*)?$/i.exec(u || '');
    if (!m) return u;
    return '/x/' + m[1] + (m[2] && m[2] !== '80' ? '~' + m[2] : '') + (m[3] || '/');
  }
  // logos: http:// em pagina https e bloqueado
  function imgUrl(u) {
    if (!u || !/^http:\/\//i.test(u) || !HTTPS_PAGE) return u;
    return IS_TAURI ? proxyUrl(u) : viaRewrite(u);
  }
  // Rotas de reproducao (como no HTML original que funciona): a PRIMEIRA e a URL direta
  // com mpegts.js. Se falhar (https bloqueia http, CORS), cada tentativa alterna para a proxima.
  const b64 = remote => base64url(remote);
  const ROUTES = IS_TAURI
    ? [r => r, r => proxyUrl(r)]
    : [r => r, r => viaRewrite(r), r => (window.__WEB_PROXY || '/proxy?u=') + b64(r)];
  let curRoute = 0;
  const savedRoute = () => (parseInt(localStorage.getItem('vaportv_route') || '0', 10) || 0) % ROUTES.length;
  function streamUrl(remote) {
    curRoute = (savedRoute() + retries) % ROUTES.length;
    return ROUTES[curRoute](remote);
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- constroi trilhos por categoria ----------
  const groups = [];
  const groupIndex = new Map();
  ENTRIES.forEach((e, i) => {
    const g = e.group;
    if (!groupIndex.has(g)) { groupIndex.set(g, groups.length); groups.push({ name: g, items: [] }); }
    groups[groupIndex.get(g)].items.push({ ch: e, global: i });
  });

  const railsEl = $('rails');
  const railEls = []; // {el, row, tiles[]}
  groups.forEach((g, ri) => {
    const rail = document.createElement('section');
    rail.className = 'rail';
    const label = document.createElement('div');
    label.className = 'rail-label';
    label.innerHTML = `<span>${g.name}</span><span class="count">${g.items.length} canais</span>`;
    const row = document.createElement('div');
    row.className = 'rail-row';
    const tiles = g.items.map((it, ti) => {
      const t = document.createElement('div');
      t.className = 'tile';
      t.dataset.rail = ri; t.dataset.idx = ti; t.dataset.global = it.global;
      const name = it.ch.name || 'Canal';
      if (it.ch.logo) {
        const img = document.createElement('img');
        img.src = imgUrl(it.ch.logo); img.alt = name;
        img.onerror = () => { img.remove(); fallback(t, name); };
        // se a logo demorar mais de 1.5s, mostra a letra de fallback
        setTimeout(() => {
          if (img.parentNode && (!img.complete || img.naturalWidth === 0)) {
            img.remove(); fallback(t, name);
          }
        }, 1500);
        t.appendChild(img);
      } else {
        fallback(t, name);
      }
      const nm = document.createElement('div');
      nm.className = 'tile-name'; nm.textContent = name;
      t.appendChild(nm);
      if (it.ch.variants.length > 1) {
        const b = document.createElement('div'); b.className = 'tile-badge'; b.textContent = it.ch.variants.length;
        t.appendChild(b);
      }
      t.addEventListener('click', () => { setFocus(ri, ti); activateEntry(it.global); });
      t.addEventListener('mouseenter', () => setFocus(ri, ti));
      row.appendChild(t);
      return t;
    });
    // rodinha do mouse rola o trilho na horizontal
    row.addEventListener('wheel', e => {
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }, { passive: false });

    rail.appendChild(label); rail.appendChild(row);
    railsEl.appendChild(rail);
    railEls.push({ el: rail, row, tiles });
  });

  function fallback(tile, name) {
    if (tile.querySelector('.fallback')) return;
    const fb = document.createElement('div');
    fb.className = 'fallback';
    fb.textContent = (name.replace(/\[.*?\]/g, '').trim()[0] || '?').toUpperCase();
    tile.insertBefore(fb, tile.firstChild);
  }

  // ---------- foco / navegacao na grade ----------
  let focus = { rail: 0, idx: 0 };

  function setFocus(r, i) {
    r = clamp(r, 0, railEls.length - 1);
    i = clamp(i, 0, railEls[r].tiles.length - 1);
    if (focus && (focus.rail !== r || focus.idx !== i)) SFX.nav();
    railEls.forEach((rw, ri) => rw.tiles.forEach((t, ti) => t.classList.toggle('focused', ri === r && ti === i)));
    focus = { rail: r, idx: i };
    const tile = railEls[r].tiles[i];
    // scroll horizontal do trilho
    tile.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    // scroll vertical da pagina
    railEls[r].el.scrollIntoView({ behavior: 'auto', block: 'center' });
    updateHero();
  }

  function currentGlobal() {
    return parseInt(railEls[focus.rail].tiles[focus.idx].dataset.global, 10);
  }

  function updateHero() {
    const g = currentGlobal();
    const ch = ENTRIES[g];
    $('hero-name').textContent = ch.name || 'Canal';
    $('hero-group').textContent = (ch.group || 'CANAIS').toUpperCase();
    $('hero-meta').textContent = `Canal ${g + 1} de ${ENTRIES.length}  ·  ${ch.group}` + (ch.variants.length > 1 ? `  ·  ${ch.variants.length} qualidades` : '');
    $('focused-sub').textContent = `${groups[focus.rail].name} · ${focus.idx + 1}/${groups[focus.rail].items.length}`;
  }

  // ---------- relogio ----------
  function tick() {
    const d = new Date();
    $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  tick(); setInterval(tick, 10000);

  // ============================================================
  // PLAYER
  // ============================================================
  const playerEl = $('player'), video = $('video'), overlay = $('player-overlay');
  // Tela "Carregando canal" removida: stub sem efeito visual.
  const loadingEl = { hidden: true };
  // O aviso de erro foi removido: o app reconecta em silencio, sem nunca mostrar mensagem.
  const errorEl = { hidden: true };
  let mpegPlayer = null;
  let currentIndex = 0;
  let hideTimer = null;
  let loadTimer = null;
  let watchTimer = null;
  let uiVisible = true;
  let playToken = 0;
  let startedCb = null;
  let retries = 0;
  let stallTimer = null;
  let openDebounce = null;
  ['playing', 'canplay', 'timeupdate'].forEach(ev => video.addEventListener(ev, () => { if (startedCb) startedCb(); }));
  let lastT = -1, lastTWall = 0;
  function isActuallyPlaying() {
    return !video.paused && video.readyState >= 3 && video.currentTime > 0 &&
      (performance.now() - lastTWall) < 3000;
  }
  video.addEventListener('timeupdate', () => {
    if (video.currentTime !== lastT) { lastT = video.currentTime; lastTWall = performance.now(); }
    // video avancando = canal OK: garante que nenhum overlay de erro fique por cima
    if (!errorEl.hidden && !video.paused) { errorEl.hidden = true; loadingEl.hidden = true; }
  });
  // Watchdog: se o video nao avancar por 10s (buffer esgotado, sem pausa do usuario), recarrega o canal.
  const STALL_MS = 10000;
  let lastProgress = performance.now();
  video.addEventListener('timeupdate', () => { lastProgress = performance.now(); });
  ['playing', 'seeked', 'pause'].forEach(ev => video.addEventListener(ev, () => { lastProgress = performance.now(); }));
  setInterval(() => {
    if (playerEl.hidden || video.paused || video.ended) { lastProgress = performance.now(); return; }
    if (performance.now() - lastProgress >= STALL_MS) {
      lastProgress = performance.now();
      autoRetry(); // recarrega o canal atual
    }
  }, 1000);
  function autoRetry() {
    retries++;
    const i = currentIndex, tok = playToken;
    const wait = Math.min(600 + retries * 700, 5000);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!playerEl.hidden && i === currentIndex) openPlayer(i, true); }, wait);
    return true;
  }
  let retryTimer = null;

  const volume = {
    level: parseFloat(localStorage.getItem('vaportv_volume') || '0.8'),
    muted: localStorage.getItem('vaportv_muted') === '1'
  };

  const volSlider = $('volume'), volPct = $('vol-pct');
  function applyVolume() {
    video.volume = clamp(volume.level, 0, 1);
    video.muted = volume.muted;
    const pct = Math.round((volume.muted ? 0 : volume.level) * 100);
    volSlider.value = pct;
    volSlider.style.setProperty('--vol', pct + '%');
    volPct.textContent = pct + '%';
    $('ico-vol').hidden = volume.muted || volume.level === 0;
    $('ico-mute').hidden = !(volume.muted || volume.level === 0);
    localStorage.setItem('vaportv_volume', String(volume.level));
    localStorage.setItem('vaportv_muted', volume.muted ? '1' : '0');
  }
  volSlider.addEventListener('input', () => {
    volume.level = volSlider.value / 100;
    volume.muted = volume.level === 0;
    applyVolume(); showToast(volume.muted ? 'Mudo' : 'Volume ' + Math.round(volume.level * 100) + '%');
  });
  $('btn-mute').addEventListener('click', toggleMute);
  function toggleMute() { volume.muted = !volume.muted; applyVolume(); showToast(volume.muted ? 'Mudo' : 'Som ligado'); }

  function changeVolume(delta) {
    volume.level = clamp(volume.level + delta, 0, 1);
    if (volume.level > 0) volume.muted = false;
    applyVolume();
    showToast(volume.muted || volume.level === 0 ? 'Mudo' : 'Volume ' + Math.round(volume.level * 100) + '%');
  }

  // toast
  const toast = document.createElement('div');
  toast.className = 'toast'; document.body.appendChild(toast);
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  function destroyPlayer() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    startedCb = null; playToken++;
    if (mpegPlayer) {
      try { mpegPlayer.pause(); mpegPlayer.unload(); mpegPlayer.detachMediaElement(); mpegPlayer.destroy(); } catch (e) { }
      mpegPlayer = null;
    }
    video.removeAttribute('src'); video.load();
  }

  function openPlayer(globalIndex, isRetry) {
    lastProgress = performance.now();
    if (!isRetry) retries = 0;
    currentIndex = clamp(globalIndex, 0, CHANNELS.length - 1);
    const ch = CHANNELS[currentIndex];
    playerEl.hidden = false;
    errorEl.hidden = true; loadingEl.hidden = false;
    $('player-ch-name').textContent = ch.name || 'Canal';
    $('player-ch-group').textContent = ch.group || '—';
    $('player-logo').src = imgUrl(ch.logo) || '';
    $('ch-counter').textContent = (ch.entry.index + 1) + ' / ' + ENTRIES.length;
    applyVolume();
    showUI();

    destroyPlayer();

    const url = streamUrl(ch.url);
    const canMpegts = window.mpegts && mpegts.isSupported && mpegts.isSupported();

    if (canMpegts) {
      try {
        mpegPlayer = mpegts.createPlayer(
          { type: 'mpegts', isLive: true, url, hasAudio: true, hasVideo: true },
          {
            enableWorker: false,
            lazyLoad: false,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 30,
            autoCleanupMinBackwardDuration: 15,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 15,
            liveBufferLatencyMinRemain: 3
          }
        );
        mpegPlayer.attachMediaElement(video);
        mpegPlayer.load();

        // Marca reproducao iniciada em QUALQUER um desses eventos (timeupdate
        // e o mais confiavel para streams ao vivo). Esconde loading e erro.
        let started = false;
        const myToken = ++playToken;
        const markStarted = () => {
          if (started || myToken !== playToken) return;
          started = true;
          try { localStorage.setItem('vaportv_route', String(curRoute)); } catch (e) { }
          loadingEl.hidden = true;
          errorEl.hidden = true;
          retries = 0;
          if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
          if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
        };
        startedCb = markStarted;

        // So mostra erro em erros FATAIS. Erros transitorios de rede sao
        // comuns em live e o mpegts.js se recupera sozinho.
        const onFatal = (msg) => {
          if (myToken !== playToken) return;
          if (isActuallyPlaying()) return; // tocando fluido: ignora erro transitorio
          if (autoRetry()) return;
          loadingEl.hidden = true;
          showError(msg);
        };
        // Apenas erro FATAL de MIDIA mostra overlay. Erros de rede sao
        // transitorios e o mpegts.js se recupera sozinho.
        mpegPlayer.on(mpegts.Events.ERROR, (errType, errDetail, errInfo) => {
          if (started && isActuallyPlaying()) return;
          if (errType === mpegts.ErrorTypes.NETWORK_ERROR && started) { autoRetry(); return; }
          if (errType === mpegts.ErrorTypes.NETWORK_ERROR || (errInfo && errInfo.fatal) || errType === mpegts.ErrorTypes.MEDIA_ERROR) {
            onFatal('Falha ao carregar o stream. O canal pode estar offline ou usar codec HEVC/H265 não suportado.');
          }
        });

        mpegPlayer.play().catch(() => { /* autoplay bloqueado — usuario pode apertar espaco */ });

        // Watchdog a prova de falhas: esconde loading/erro assim que o video
        // realmente esta reproduzindo, independente de eventos terem fired.
        if (watchTimer) clearInterval(watchTimer);
        watchTimer = setInterval(() => {
          if (video.readyState >= 2 || video.currentTime > 0 || (!video.paused && video.readyState >= 1)) {
            markStarted();
            clearInterval(watchTimer); watchTimer = null;
          }
        }, 400);

        // timeout de carregamento (so dispara se nao começou a tocar)
        if (loadTimer) clearTimeout(loadTimer);
        loadTimer = setTimeout(() => {
          if (!started && !playerEl.hidden && myToken === playToken) { if (autoRetry()) return; loadingEl.hidden = true; showError('Tempo esgotado ao carregar o stream.'); }
        }, 12000);
      } catch (e) {
        showError('Erro ao inicializar o player: ' + e.message);
      }
    } else {
      // fallback nativo (raramente funciona com .ts, mas tentamos)
      video.src = streamUrl(ch.url);
      video.play().catch(() => { });
      video.addEventListener('playing', () => { loadingEl.hidden = true; }, { once: true });
      video.addEventListener('error', () => { loadingEl.hidden = true; showError('Seu ambiente não suporta reprodução MPEG-TS.'); }, { once: true });
    }
  }

  function showError() { /* removido: nunca exibe mensagem de erro */ if (!playerEl.hidden && !isActuallyPlaying()) autoRetry(); }

  function closePlayer() {
    SFX.nav();
    clearTimeout(retryTimer); retries = 0;
    destroyPlayer();
    playerEl.hidden = true;
    errorEl.hidden = true; loadingEl.hidden = true;
  }

  let pendingEntry = null;
  function nextChannel(dir) {
    const n = ENTRIES.length;
    const base = pendingEntry !== null ? pendingEntry : CHANNELS[currentIndex].entry.index;
    pendingEntry = ((base + dir) % n + n) % n;
    SFX.nav();
    const e = ENTRIES[pendingEntry];
    const v = pickVariant(e);
    $('ch-counter').textContent = (pendingEntry + 1) + ' / ' + n;
    $('player-ch-name').textContent = v.name;
    $('player-logo').src = imgUrl(e.logo) || '';
    destroyPlayer(); loadingEl.hidden = false; clearTimeout(retryTimer);
    clearTimeout(openDebounce);
    openDebounce = setTimeout(() => { pendingEntry = null; openPlayer(v.global); }, 220);
  }

  // ---------- escolha de qualidade (popup) ----------
  const PREF = ['HD', 'FHD', 'SD', 'FHD H265', 'HD H265', '4K']; // HD primeiro: menos banda, menos lag
  function pickVariant(e) {
    const last = localStorage.getItem('vaportv_quality');
    let v = last && e.variants.find(x => x.label === last);
    if (!v) for (const p of PREF) { v = e.variants.find(x => x.label === p); if (v) break; }
    return v || e.variants[0];
  }
  const vpEl = $('variant-popup'), vpList = $('vp-list');
  let vpOpen = false, vpFocus = 0, vpEntry = null;

  function activateEntry(ei) {
    const e = ENTRIES[ei];
    if (e.variants.length === 1) { SFX.act(); openPlayer(e.variants[0].global); return; }
    openVariantPopup(e);
  }
  function openVariantPopup(e) {
    vpEntry = e; vpOpen = true; vpFocus = Math.max(0, e.variants.indexOf(pickVariant(e)));
    $('vp-title').textContent = e.name;
    $('vp-sub').textContent = e.group + ' · escolha a qualidade';
    vpList.innerHTML = '';
    e.variants.forEach((v, i) => {
      const b = document.createElement('button');
      b.className = 'vp-item'; b.type = 'button';
      const img = document.createElement('img'); img.alt = '';
      img.src = imgUrl(v.logo || e.logo || ''); img.onerror = () => { img.style.visibility = 'hidden'; };
      const lb = document.createElement('span'); lb.className = 'vp-label'; lb.textContent = v.label;
      const nm = document.createElement('span'); nm.className = 'vp-name'; nm.textContent = e.name;
      const txt = document.createElement('div'); txt.className = 'vp-txt'; txt.appendChild(lb); txt.appendChild(nm);
      b.appendChild(img); b.appendChild(txt);
      b.addEventListener('click', () => chooseVariant(i));
      b.addEventListener('mouseenter', () => setVpFocus(i));
      vpList.appendChild(b);
    });
    vpEl.hidden = false; SFX.act(); setVpFocus(vpFocus);
  }
  function setVpFocus(i) {
    const items = vpList.children; if (!items.length) return;
    const nf = clamp(i, 0, items.length - 1);
    if (nf !== vpFocus && !vpEl.hidden) SFX.nav();
    vpFocus = nf;
    Array.from(items).forEach((el, k) => el.classList.toggle('focused', k === vpFocus));
    items[vpFocus].scrollIntoView({ block: 'nearest' });
  }
  function closeVariantPopup() { SFX.nav(); vpOpen = false; vpEl.hidden = true; vpEntry = null; }
  function chooseVariant(i) {
    const v = vpEntry.variants[i];
    localStorage.setItem('vaportv_quality', v.label.replace(/ \(\d+\)$/, ''));
    closeVariantPopup(); SFX.act();
    openPlayer(v.global);
  }
  $('vp-close').addEventListener('click', closeVariantPopup);
  vpEl.addEventListener('click', e => { if (e.target === vpEl) closeVariantPopup(); });
  function vpDirection(dir) {
    if (dir === 'up' || dir === 'left') setVpFocus(vpFocus - 1);
    else if (dir === 'down' || dir === 'right') setVpFocus(vpFocus + 1);
  }

  // botoes do player
  $('btn-close').addEventListener('click', closePlayer);
  $('btn-prev').addEventListener('click', () => nextChannel(-1));
  $('btn-next').addEventListener('click', () => nextChannel(1));
  $('btn-playpause').addEventListener('click', togglePlayPause);
  function togglePlayPause() {
    if (video.paused) { video.play().catch(() => { }); }
    else { video.pause(); }
    $('ico-play').hidden = !video.paused;
    $('ico-pause').hidden = video.paused;
  }
  video.addEventListener('play', () => { $('ico-play').hidden = true; $('ico-pause').hidden = false; });
  video.addEventListener('pause', () => { $('ico-play').hidden = false; $('ico-pause').hidden = true; });

  // auto-esconder UI do player
  function showUI() {
    uiVisible = true; overlay.classList.remove('hidden-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { uiVisible = false; overlay.classList.add('hidden-ui'); }, 3200);
  }
  ['mousemove', 'mousedown', 'touchstart'].forEach(ev => playerEl.addEventListener(ev, showUI));
  playerEl.addEventListener('wheel', e => { changeVolume(e.deltaY < 0 ? 0.05 : -0.05); showUI(); }, { passive: true });
  video.addEventListener('click', () => { togglePlayPause(); showUI(); });
  video.addEventListener('dblclick', toggleFullscreen);
  $('player-logo').addEventListener('error', e => { e.target.style.display = 'none'; });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    else document.documentElement.requestFullscreen().catch(() => { });
  }

  // ============================================================
  // TECLADO
  // ============================================================
  document.addEventListener('keydown', e => {
    const inPlayer = !playerEl.hidden;
    const k = e.key;

    if (k === 'F11' || k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); return; }

    if (vpOpen) {
      e.preventDefault();
      if (k === 'Escape' || k === 'Backspace') closeVariantPopup();
      else if (k === 'Enter' || k === ' ') chooseVariant(vpFocus);
      else if (k === 'ArrowUp') vpDirection('up');
      else if (k === 'ArrowDown') vpDirection('down');
      else if (k === 'ArrowLeft') vpDirection('left');
      else if (k === 'ArrowRight') vpDirection('right');
      return;
    }

    if (inPlayer) {
      switch (k) {
        case 'ArrowLeft': e.preventDefault(); nextChannel(-1); showUI(); return;
        case 'ArrowRight': e.preventDefault(); nextChannel(1); showUI(); return;
        case 'ArrowUp': e.preventDefault(); changeVolume(0.05); showUI(); return;
        case 'ArrowDown': e.preventDefault(); changeVolume(-0.05); showUI(); return;
        case 'Escape': case 'Backspace': e.preventDefault(); closePlayer(); return;
        case ' ': e.preventDefault(); togglePlayPause(); showUI(); return;
        case 'm': case 'M': toggleMute(); showUI(); return;
        case 'Enter': e.preventDefault(); if (!errorEl.hidden) nextChannel(1); return;
      }
      return;
    }

    // grade
    switch (k) {
      case 'm': case 'M': e.preventDefault(); SFX.toggle(); return;
      case 'ArrowLeft': e.preventDefault(); setFocus(focus.rail, focus.idx - 1); return;
      case 'ArrowRight': e.preventDefault(); setFocus(focus.rail, focus.idx + 1); return;
      case 'ArrowUp': e.preventDefault(); setFocus(focus.rail - 1, focus.idx); return;
      case 'ArrowDown': e.preventDefault(); setFocus(focus.rail + 1, focus.idx); return;
      case 'Enter': case ' ': e.preventDefault(); activateEntry(currentGlobal()); return;
    }
  });

  // ============================================================
  // GAMEPAD (Xbox / DualSense) — polling com borda e repeticao
  // ============================================================
  const gpState = { prev: {}, repeat: { t: 0, dir: null } };
  const DEADZONE = 0.55;

  function pollGamepad(now) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) { if (p) { pad = p; break; } }

    if (!pad) { requestAnimationFrame(pollGamepad); return; }
    if (pad.buttons.some(b => b.pressed)) SFX.arm();

    const inPlayer = !playerEl.hidden;
    const btn = i => pad.buttons[i] && pad.buttons[i].pressed;
    const pressed = i => { const cur = !!btn(i); const was = !!gpState.prev[i]; gpState.prev[i] = cur; return cur && !was; };

    // eixos -> direcao (com repeticao ao segurar)
    let dir = null;
    const lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
    if (pad.buttons[14] && pad.buttons[14].pressed) dir = 'left';
    else if (pad.buttons[15] && pad.buttons[15].pressed) dir = 'right';
    else if (pad.buttons[12] && pad.buttons[12].pressed) dir = 'up';
    else if (pad.buttons[13] && pad.buttons[13].pressed) dir = 'down';
    else if (lx < -DEADZONE) dir = 'left';
    else if (lx > DEADZONE) dir = 'right';
    else if (ly < -DEADZONE) dir = 'up';
    else if (ly > DEADZONE) dir = 'down';

    if (dir) {
      const sameAsBefore = gpState.repeat.dir === dir;
      const interval = sameAsBefore ? 260 : 0; // primeiro movimento imediato
      if (!sameAsBefore || now - gpState.repeat.t > interval) {
        gpState.repeat.t = now; gpState.repeat.dir = dir;
        if (vpOpen) vpDirection(dir); else handleGPDirection(dir, inPlayer);
      }
    } else {
      gpState.repeat.dir = null;
    }

    // botoes (borda)
    if (vpOpen) {
      if (pressed(0)) chooseVariant(vpFocus);
      if (pressed(1)) closeVariantPopup();
      for (const i of [2, 4, 5, 9]) pressed(i);
      requestAnimationFrame(pollGamepad); return;
    }
    if (!inPlayer && pressed(3)) SFX.toggle(); // Y / Triangulo: liga/desliga sons da interface
    if (pressed(0)) { // A / Cross (✕)
      if (inPlayer) { if (!errorEl.hidden) nextChannel(1); else { togglePlayPause(); showUI(); } }
      else activateEntry(currentGlobal());
    }
    if (pressed(1)) { // B / Circle (○)
      if (inPlayer) closePlayer();
    }
    if (pressed(2)) { // X / Square (■) — mudo
      if (inPlayer) { toggleMute(); showUI(); }
    }
    if (pressed(4)) { // LB / L1 — canal anterior
      if (inPlayer) { nextChannel(-1); showUI(); }
    }
    if (pressed(5)) { // RB / R1 — proximo canal
      if (inPlayer) { nextChannel(1); showUI(); }
    }
    if (pressed(9)) { // Start — tela cheia
      toggleFullscreen();
    }

    requestAnimationFrame(pollGamepad);
  }

  function handleGPDirection(dir, inPlayer) {
    if (inPlayer) {
      showUI();
      if (dir === 'left') nextChannel(-1);
      else if (dir === 'right') nextChannel(1);
      else if (dir === 'up') changeVolume(0.05);
      else if (dir === 'down') changeVolume(-0.05);
    } else {
      if (dir === 'left') setFocus(focus.rail, focus.idx - 1);
      else if (dir === 'right') setFocus(focus.rail, focus.idx + 1);
      else if (dir === 'up') setFocus(focus.rail - 1, focus.idx);
      else if (dir === 'down') setFocus(focus.rail + 1, focus.idx);
    }
  }

  // inicia polling (so funciona apos primeiro evento de gamepad em alguns navegadores)
  window.addEventListener('gamepadconnected', () => showToast('Controle conectado'));
  window.addEventListener('gamepaddisconnected', () => showToast('Controle desconectado'));
  requestAnimationFrame(pollGamepad);

  // ---------- init ----------
  applyVolume();
  setFocus(0, 0);
})();
