const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("zh-CN");
// "今日"统一按北京时间，与 supabase/schema.sql 中的 Asia/Shanghai 一致
const dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
const todayKey = () => dayFmt.format(new Date());
const nf = (n) => (n == null ? "—" : fmt.format(n));
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CAN_HOVER = window.matchMedia("(hover: hover)").matches;
// 与服务端令牌桶容量一致，避免合并时被截断
const GUEST_MERGE_CAP = 3000;

const cfg = window.MUYU_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

const els = {
  muyu: $("muyu"),
  combo: $("combo"),
  comboBar: $("comboBar"),
  comboRail: document.querySelector(".combo-rail"),
  srLive: $("srLive"),
  flashbang: $("flashbang"),
  myTotal: $("myTotal"),
  myToday: $("myToday"),
  globalToday: $("globalToday"),
  guestNote: $("guestNote"),
  guestLogin: $("guestLogin"),
  authBtn: $("authBtn"),
  authModal: $("authModal"),
  authFormView: $("authFormView"),
  authSentView: $("authSentView"),
  authUserView: $("authUserView"),
  loginForm: $("loginForm"),
  email: $("email"),
  sendBtn: $("sendBtn"),
  authError: $("authError"),
  sentEmail: $("sentEmail"),
  resendBtn: $("resendBtn"),
  userEmail: $("userEmail"),
  userTotal: $("userTotal"),
  userToday: $("userToday"),
  logoutBtn: $("logoutBtn"),
  soundToggle: $("soundToggle"),
  toast: $("toast"),
  rippleLayer: $("rippleLayer"),
  floatLayer: $("floatLayer"),
  sparkCanvas: $("sparkCanvas"),
  scene3d: $("scene3d"),
  impactGlow: $("impactGlow"),
  fish: document.querySelector(".muyu-fish"),
  malletArm: document.querySelector(".mallet-g"),
  wrap: document.querySelector(".muyu-wrap")
};

const state = {
  supabase: null,
  session: null,
  total: 0,
  today: 0,
  globalToday: null,
  pending: 0,
  inflight: 0,
  guest: { total: 0, today: 0, date: todayKey() },
  soundOn: localStorage.getItem("muyu_sound") !== "off",
  combo: 0,
  lastTap: 0,
  comboHide: 0,
  flushing: false,
  retry: 0,
  throttleNoticeAt: 0
};

function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

/* ---------- 动画（Web Animations API，不触发强制重排） ---------- */

const running = new WeakMap();

function play(el, keyframes, options) {
  if (!el || typeof el.animate !== "function") return null;
  running.get(el)?.cancel();
  const anim = el.animate(keyframes, options);
  running.set(el, anim);
  return anim;
}

// 复用固定数量的节点，敲击时不再创建/销毁 DOM
function makePool(parent, className, size, text) {
  const items = [];
  for (let i = 0; i < size; i++) {
    const node = document.createElement("span");
    node.className = className;
    if (text) node.textContent = text;
    parent.appendChild(node);
    items.push(node);
  }
  let i = 0;
  return () => items[i++ % size];
}

const pools = {};

function initPools() {
  pools.ripple = makePool(els.rippleLayer, "ripple", 4);
  pools.rippleMag = makePool(els.rippleLayer, "ripple mag", 4);
  pools.rippleWide = makePool(els.rippleLayer, "ripple wide", 4);
  pools.shock = makePool(els.rippleLayer, "shock", 4);
  pools.float = makePool(els.floatLayer, "float-merit", 6, "功德 +1");
}

const EASE_OUT = "cubic-bezier(.15, .8, .3, 1)";
const EASE_BOUNCE = "cubic-bezier(.18, .9, .28, 1.35)";

function ringFrames(maxScale) {
  return [
    { transform: "scale(0.4)", opacity: 0 },
    { transform: "scale(1)", opacity: 1, offset: 0.12 },
    { transform: `scale(${maxScale})`, opacity: 0 }
  ];
}

function ripple() {
  play(pools.ripple(), ringFrames(5.6), { duration: 550, easing: EASE_OUT });
  play(pools.rippleMag(), ringFrames(5.6), { duration: 700, delay: 50, easing: EASE_OUT });
  play(pools.rippleWide(), ringFrames(5.6), { duration: 900, delay: 100, easing: EASE_OUT });
  play(pools.shock(), ringFrames(3.2), { duration: 500, easing: "ease-out" });
}

function floatMerit() {
  const node = pools.float();
  node.style.left = `${(30 + Math.random() * 6).toFixed(2)}%`;
  play(node, [
    { transform: "translate(-50%, 0) scale(0.5)", opacity: 0 },
    { transform: "translate(-50%, -14px) scale(1.25)", opacity: 1, offset: 0.14 },
    { transform: "translate(-50%, -30px) scale(1)", opacity: 1, offset: 0.34 },
    { transform: "translate(-50%, -100px) scale(0.95)", opacity: 0 }
  ], { duration: 900, easing: "cubic-bezier(.2, .8, .3, 1)" });
}

function popNumber(el) {
  play(el, [
    { transform: "scale(1)" },
    { transform: "scale(1.22)", offset: 0.32 },
    { transform: "scale(1)" }
  ], { duration: 240, easing: "ease-out" });
}

function hitBody() {
  if (!REDUCED) {
    play(els.fish, [
      { transform: "scale(1) translateY(0)" },
      { transform: "scale(1.03, 0.97) translateY(2px)", offset: 0.14 },
      { transform: "scale(0.93, 0.87) translateY(9px)", offset: 0.32 },
      { transform: "scale(1.04, 0.99) translateY(-4px)", offset: 0.54 },
      { transform: "scale(0.985, 1.01) translateY(1px)", offset: 0.74 },
      { transform: "scale(1) translateY(0)" }
    ], { duration: 280, easing: EASE_BOUNCE });

    // 鼠标悬停时木槌是抬起状态（14deg），从当前姿态砸下再回到原位
    const base = CAN_HOVER && els.muyu.matches(":hover") ? 14 : 0;
    play(els.malletArm, [
      { transform: `rotate(${base}deg)` },
      { transform: "rotate(-5deg)", offset: 0.18 },
      { transform: "rotate(9deg)", offset: 0.5 },
      { transform: `rotate(${base}deg)` }
    ], { duration: 300, easing: "cubic-bezier(.2, .85, .3, 1.1)" });

    play(els.wrap, [
      { transform: "translate(0, 0)" },
      { transform: "translate(-5px, 4px)", offset: 0.2 },
      { transform: "translate(5px, -3px)", offset: 0.45 },
      { transform: "translate(-2px, 2px)", offset: 0.7 },
      { transform: "translate(0, 0)" }
    ], { duration: 200, easing: "ease-out" });
  }

  play(els.impactGlow, [
    { transform: "translate(-50%, -50%) scale(0.35)", opacity: 1 },
    { opacity: 0.35, offset: 0.6 },
    { transform: "translate(-50%, -50%) scale(1.8)", opacity: 0 }
  ], { duration: 340, easing: "ease-out" });

  play(els.flashbang, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 220, easing: "ease-out" });
}

/* ---------- 3D 木鱼（渐进增强：首屏不加载 three.js） ---------- */

const canWebGL = (() => {
  try {
    const probe = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (probe.getContext("webgl2") || probe.getContext("webgl"))
    );
  } catch {
    return false;
  }
})();

let scene3d = null;
let scene3dRequested = false;

function loadScene3d() {
  // 减少动效偏好、或没有 WebGL 时，永远停在 2D 版本
  if (scene3d || scene3dRequested || REDUCED || !canWebGL) return;
  scene3dRequested = true;
  import("./scene3d.js")
    .then((mod) => {
      scene3d = mod.createMuyuScene(els.scene3d);
      els.wrap.classList.add("is3d");
    })
    .catch(() => {
      // 加载失败（离线 / CDN 被墙）就静默留在 2D
      scene3dRequested = false;
    });
}

function scheduleScene3d() {
  if (REDUCED || !canWebGL) return;
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => loadScene3d(), { timeout: 2500 });
  } else {
    setTimeout(loadScene3d, 1200);
  }
}

/* ---------- 火花（单个 canvas + rAF，空闲时停止循环） ---------- */

const sparks = {
  ctx: null,
  w: 0,
  h: 0,
  parts: [],
  raf: 0,
  last: 0
};

// canvas 比 .muyu-wrap 四周各大 10%，敲击点在木鱼 29% / 63% 处
const SPARK_PAD = 0.1;
const SPARK_ORIGIN = { x: 0.29, y: 0.63 };
const SPARK_MAX = 160;

function initSparks() {
  const canvas = els.sparkCanvas;
  if (!canvas || !canvas.getContext) return;
  sparks.ctx = canvas.getContext("2d");
  const resize = (width, height) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sparks.w = width;
    sparks.h = height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    sparks.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  if ("ResizeObserver" in window) {
    new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      resize(width, height);
    }).observe(canvas);
  } else {
    const r = canvas.getBoundingClientRect();
    resize(r.width, r.height);
  }
}

function emitSparks() {
  if (REDUCED || !sparks.ctx || !sparks.w) return;
  const span = 1 + SPARK_PAD * 2;
  const ox = (sparks.w * (SPARK_PAD + SPARK_ORIGIN.x)) / span;
  const oy = (sparks.h * (SPARK_PAD + SPARK_ORIGIN.y)) / span;
  const scale = sparks.w / (600 * span);
  const room = SPARK_MAX - sparks.parts.length;
  const n = Math.min(14, room);
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = (180 + Math.random() * 320) * scale;
    const life = 0.35 + Math.random() * 0.3;
    sparks.parts.push({
      x: ox + (Math.random() - 0.5) * 18 * scale,
      y: oy + (Math.random() - 0.5) * 14 * scale,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      r: (2 + Math.random() * 1.8) * Math.max(scale, 0.6),
      life,
      max: life,
      white: Math.random() < 0.34
    });
  }
  if (!sparks.raf) {
    sparks.last = performance.now();
    sparks.raf = requestAnimationFrame(stepSparks);
  }
}

function stepSparks(now) {
  const dt = Math.min((now - sparks.last) / 1000, 0.05);
  sparks.last = now;
  const { ctx, w, h } = sparks;
  const gravity = 900 * (w / 720);
  ctx.clearRect(0, 0, w, h);

  let alive = 0;
  for (const p of sparks.parts) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vy += gravity * dt;
    p.vx *= 0.985;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = p.life / p.max;
    ctx.globalAlpha = k * 0.35;
    ctx.fillStyle = p.white ? "#ffffff" : "#ffd36b";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = k;
    ctx.fillStyle = p.white ? "#ffffff" : "#f4b942";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.6), 0, Math.PI * 2);
    ctx.fill();
    sparks.parts[alive++] = p;
  }
  sparks.parts.length = alive;
  ctx.globalAlpha = 1;

  if (alive > 0) {
    sparks.raf = requestAnimationFrame(stepSparks);
  } else {
    sparks.raf = 0;
    ctx.clearRect(0, 0, w, h);
  }
}

/* ---------- 连击 ---------- */

function bumpCombo() {
  const now = Date.now();
  state.combo = now - state.lastTap < 700 ? state.combo + 1 : 1;
  state.lastTap = now;

  els.comboBar.style.transform = `scaleX(${Math.min(state.combo / 20, 1)})`;
  els.comboRail.classList.add("live");

  if (state.combo >= 3) {
    els.combo.textContent = `连击 ×${state.combo}`;
    els.combo.classList.add("show");
    els.combo.classList.toggle("hot", state.combo >= 8);
  }

  // 视觉上的连击数字每敲一下都变，只在每 10 连时报给屏幕阅读器，避免刷屏
  if (state.combo >= 10 && state.combo % 10 === 0) {
    els.srLive.textContent = `连击 ${state.combo} 次`;
  }

  clearTimeout(state.comboHide);
  state.comboHide = setTimeout(() => {
    els.combo.classList.remove("show", "hot");
    els.comboRail.classList.remove("live");
    els.comboBar.style.transform = "scaleX(0)";
    state.combo = 0;
  }, 1300);
}

/* ---------- 声音（共享音频图 + 压缩器，快敲不削波） ---------- */

const audio = {
  ctx: null,
  bus: null,
  noiseBuf: null,
  noiseIn: null,
  overtoneIn: null
};

function audioGraph() {
  if (audio.ctx) return audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 8;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;

  const bus = ctx.createGain();
  bus.gain.value = 0.7;
  bus.connect(comp).connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 0.05);
  const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;

  const noiseIn = ctx.createBiquadFilter();
  noiseIn.type = "bandpass";
  noiseIn.frequency.value = 2600;
  noiseIn.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.32;
  noiseIn.connect(noiseGain).connect(bus);

  const overtoneIn = ctx.createBiquadFilter();
  overtoneIn.type = "highpass";
  overtoneIn.frequency.value = 500;
  overtoneIn.connect(bus);

  Object.assign(audio, { ctx, bus, noiseBuf, noiseIn, overtoneIn });
  return audio;
}

function sound() {
  if (!state.soundOn) return;
  try {
    const g = audioGraph();
    if (!g) return;
    const { ctx } = g;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const base = 250 * Math.pow(1.035, Math.min(state.combo, 16));

    // 低频主体
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.2, t + 0.17);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(g.bus);
    osc.start(t);
    osc.stop(t + 0.37);

    // 木质泛音
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(base * 3.2, t);
    osc2.frequency.exponentialRampToValueAtTime(base * 1.4, t + 0.1);
    gain2.gain.setValueAtTime(0.0001, t);
    gain2.gain.exponentialRampToValueAtTime(0.1, t + 0.004);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc2.connect(gain2).connect(g.overtoneIn);
    osc2.start(t);
    osc2.stop(t + 0.18);

    // 瞬态噪声（缓冲区只生成一次）
    const noise = ctx.createBufferSource();
    noise.buffer = g.noiseBuf;
    noise.connect(g.noiseIn);
    noise.start(t);
  } catch {}
}

function saveSound() {
  localStorage.setItem("muyu_sound", state.soundOn ? "on" : "off");
  els.soundToggle.setAttribute("aria-pressed", String(state.soundOn));
  els.soundToggle.setAttribute("aria-label", state.soundOn ? "关闭木鱼声" : "开启木鱼声");
}

/* ---------- 数据 ---------- */

function loadGuest() {
  try {
    const raw = JSON.parse(localStorage.getItem("muyu_guest") || "{}");
    state.guest.total = Number(raw.total) || 0;
    state.guest.today = Number(raw.today) || 0;
    state.guest.date = raw.date || todayKey();
  } catch {}
  if (state.guest.date !== todayKey()) {
    state.guest.date = todayKey();
    state.guest.today = 0;
    saveGuest();
  }
}

function saveGuest() {
  localStorage.setItem("muyu_guest", JSON.stringify(state.guest));
}

function pendingKey() {
  return state.session ? `muyu_pending_${state.session.user.id}` : null;
}

function loadPending() {
  const k = pendingKey();
  if (!k) return;
  state.pending = Number(localStorage.getItem(k)) || 0;
}

function savePending() {
  const k = pendingKey();
  if (!k) return;
  if (state.pending > 0) localStorage.setItem(k, String(state.pending));
  else localStorage.removeItem(k);
}

function displayTotal() {
  return state.session ? state.total + state.pending + state.inflight : state.guest.total;
}

function displayToday() {
  return state.session ? state.today + state.pending + state.inflight : state.guest.today;
}

function render() {
  els.myTotal.textContent = nf(displayTotal());
  els.myToday.textContent = nf(displayToday());
  els.globalToday.textContent = nf(state.globalToday);
  els.guestNote.hidden = Boolean(state.session) || !configured;
  els.userTotal.textContent = nf(state.total);
  els.userToday.textContent = nf(state.today);
}

async function initSupabase() {
  if (!configured) return null;
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch {
    toast("云服务加载失败，先按游客模式玩");
    return null;
  }
}

async function loadMerit() {
  if (!state.supabase || !state.session) return;
  const { data, error } = await state.supabase
    .from("merit")
    .select("total,today_count,today_date")
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  if (error) return;
  state.total = Number(data?.total) || 0;
  state.today = data?.today_date === todayKey() ? Number(data?.today_count) || 0 : 0;
  render();
}

function noticeThrottled() {
  const now = Date.now();
  if (now - state.throttleNoticeAt < 10000) return;
  state.throttleNoticeAt = now;
  toast("敲得太快啦，超出部分没有计入功德");
}

async function flush() {
  if (state.flushing || !state.supabase || !state.session || state.pending <= 0) return;
  state.flushing = true;
  try {
    while (state.pending > 0) {
      const n = Math.min(state.pending, 500);
      state.pending -= n;
      state.inflight += n;
      savePending();
      render();
      const { data, error } = await state.supabase.rpc("add_merit", { n });
      state.inflight -= n;
      if (error) {
        state.pending += n;
        savePending();
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        state.total = Number(row.total) || 0;
        state.today = Number(row.today_count) || 0;
        // 旧版 SQL 没有 accepted 列，视为全部计入
        const accepted = row.accepted == null ? n : Number(row.accepted);
        if (accepted < n) noticeThrottled();
      }
      render();
    }
    state.retry = 0;
    refreshGlobal();
  } catch {
    state.retry = Math.min(state.retry + 1, 5);
    setTimeout(flush, 2000 * 2 ** state.retry);
  } finally {
    state.flushing = false;
    render();
  }
}

async function refreshGlobal() {
  if (!state.supabase) return;
  const { data, error } = await state.supabase
    .from("merit_global")
    .select("today")
    .maybeSingle();
  if (!error && data) {
    state.globalToday = Number(data.today) || 0;
    render();
  }
}

async function mergeGuest() {
  if (!state.session || state.guest.total <= 0) return;
  const amount = Math.min(state.guest.total, GUEST_MERGE_CAP);
  state.guest = { total: 0, today: 0, date: todayKey() };
  saveGuest();
  state.pending += amount;
  savePending();
  render();
  await flush();
}

/* ---------- 敲击 ---------- */

function tap(event) {
  event?.preventDefault?.();

  hitBody();
  scene3d?.tap();
  if (!REDUCED) ripple();
  emitSparks();
  floatMerit();
  bumpCombo();
  sound();
  navigator.vibrate?.([10, 16, 24]);

  if (state.session) {
    state.pending += 1;
    savePending();
    clearTimeout(flush.timer);
    flush.timer = setTimeout(flush, 1100);
  } else {
    if (state.guest.date !== todayKey()) {
      state.guest.date = todayKey();
      state.guest.today = 0;
    }
    state.guest.total += 1;
    state.guest.today += 1;
    saveGuest();
  }
  render();
  popNumber(els.myTotal);
  popNumber(els.myToday);
}

/* ---------- 登录 ---------- */

function showView(view) {
  els.authFormView.hidden = view !== "form";
  els.authSentView.hidden = view !== "sent";
  els.authUserView.hidden = view !== "user";
  els.authError.hidden = true;
}

function openAuth() {
  if (!configured) {
    toast("还没配置云端，先用游客模式敲吧");
    return;
  }
  if (state.session) {
    els.userEmail.textContent = state.session.user.email || "";
    els.userTotal.textContent = nf(displayTotal());
    els.userToday.textContent = nf(displayToday());
    showView("user");
  } else {
    els.email.value = "";
    showView("form");
  }
  if (!els.authModal.open) {
    // showModal 负责焦点陷阱、Esc 关闭、把背景设为 inert
    if (typeof els.authModal.showModal === "function") els.authModal.showModal();
    else els.authModal.setAttribute("open", "");
  }
  if (!state.session) setTimeout(() => els.email.focus(), 60);
}

function closeAuth() {
  if (!els.authModal.open) return;
  if (typeof els.authModal.close === "function") els.authModal.close();
  else els.authModal.removeAttribute("open");
}

function authError(msg) {
  els.authError.textContent = msg;
  els.authError.hidden = false;
}

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function sendLink(email) {
  if (!emailOk(email)) return authError("邮箱格式不太对，检查一下");
  els.sendBtn.disabled = true;
  els.sendBtn.textContent = "发送中…";
  els.authError.hidden = true;
  const { error } = await state.supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  els.sendBtn.disabled = false;
  els.sendBtn.textContent = "发送登录链接";
  if (error) return authError(error.message);
  els.sentEmail.textContent = email;
  showView("sent");
}

async function onSession(session) {
  state.session = session;
  if (session) {
    els.authBtn.textContent = session.user.email || "我的账号";
    loadPending();
    await loadMerit();
    render();
    await mergeGuest();
    await flush();
    refreshGlobal();
    if (els.authModal.open) {
      els.userEmail.textContent = session.user.email || "";
      showView("user");
    }
  } else {
    els.authBtn.textContent = "邮箱登录";
    state.total = 0;
    state.today = 0;
    state.pending = 0;
    state.inflight = 0;
    render();
  }
}

async function init() {
  loadGuest();
  saveSound();
  initPools();
  initSparks();
  render();
  scheduleScene3d();

  els.muyu.addEventListener("pointerdown", tap);
  els.muyu.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    // 按住不放时系统会自动重复触发 keydown，只认第一次
    if (!e.repeat) tap(e);
  });
  window.addEventListener("keydown", (e) => {
    // 弹窗打开时背景是 inert，空格不会被派发到 window
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      if (!e.repeat) tap(e);
    }
  });

  els.soundToggle.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    saveSound();
    if (state.soundOn) sound();
  });

  els.authBtn.addEventListener("click", openAuth);
  els.guestLogin.addEventListener("click", openAuth);
  els.authModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      closeAuth();
      return;
    }
    // 点遮罩时事件目标是 dialog 本身；Esc 由浏览器原生处理并触发 close 事件
    if (e.target === els.authModal) closeAuth();
  });

  els.loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendLink(els.email.value.trim());
  });

  els.resendBtn.addEventListener("click", () => sendLink(els.sentEmail.textContent));

  els.logoutBtn.addEventListener("click", async () => {
    await flush();
    await state.supabase.auth.signOut();
    closeAuth();
    toast("已退出，功德留在云端");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", () => flush());

  state.supabase = await initSupabase();
  if (!state.supabase) {
    render();
    return;
  }

  const { data } = await state.supabase.auth.getSession();
  await onSession(data.session);

  state.supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") onSession(null);
    else if (session && session.user.id !== state.session?.user.id) onSession(session);
  });

  refreshGlobal();
  setInterval(() => {
    if (!document.hidden) refreshGlobal();
  }, 30000);

  const hash = new URLSearchParams(location.hash.slice(1));
  const err = hash.get("error_description") || hash.get("error");
  if (err) {
    toast("登录链接失效了，请重新发送");
    history.replaceState(null, "", location.pathname + location.search);
  }
}

init();
