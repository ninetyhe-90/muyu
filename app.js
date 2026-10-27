const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("zh-CN");
const todayKey = () => new Date().toLocaleDateString("sv-SE");
const nf = (n) => (n == null ? "—" : fmt.format(n));

const cfg = window.MUYU_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

const els = {
  muyu: $("muyu"),
  mallet: $("mallet"),
  combo: $("combo"),
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
  floatLayer: $("floatLayer")
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
  retry: 0
};

function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

function sound() {
  if (!state.soundOn) return;
  try {
    const ctx = sound.ctx || (sound.ctx = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.19);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.78, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);

    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const noise = ctx.createBufferSource();
    const ng = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    ng.gain.value = 0.3;
    noise.buffer = buf;
    noise.connect(bp).connect(ng).connect(ctx.destination);
    noise.start(t);
  } catch {}
}

function saveSound() {
  localStorage.setItem("muyu_sound", state.soundOn ? "on" : "off");
  els.soundToggle.setAttribute("aria-pressed", String(state.soundOn));
  els.soundToggle.setAttribute("aria-label", state.soundOn ? "关闭木鱼声" : "开启木鱼声");
}

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
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
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
  const amount = Math.min(state.guest.total, 20000);
  state.guest = { total: 0, today: 0, date: todayKey() };
  saveGuest();
  state.pending += amount;
  savePending();
  render();
  await flush();
}

function ripple() {
  for (const cls of ["ripple", "ripple delay"]) {
    const r = document.createElement("span");
    r.className = cls;
    els.rippleLayer.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
  }
}

function floatMerit() {
  const f = document.createElement("span");
  f.className = "float-merit";
  f.textContent = "+1";
  f.style.left = `${56 + Math.random() * 10}%`;
  els.floatLayer.appendChild(f);
  f.addEventListener("animationend", () => f.remove());
}

function bumpCombo() {
  const now = Date.now();
  state.combo = now - state.lastTap < 650 ? state.combo + 1 : 1;
  state.lastTap = now;
  if (state.combo >= 3) {
    els.combo.textContent = `连击 ×${state.combo}`;
    els.combo.classList.add("show");
  }
  clearTimeout(state.comboHide);
  state.comboHide = setTimeout(() => {
    els.combo.classList.remove("show");
    state.combo = 0;
  }, 1100);
}

function tap(event) {
  event?.preventDefault?.();
  els.muyu.classList.remove("hit");
  els.mallet.classList.remove("swing");
  void els.muyu.offsetWidth;
  els.muyu.classList.add("hit");
  els.mallet.classList.add("swing");
  els.muyu.parentElement.classList.add("impact");
  setTimeout(() => els.muyu.classList.remove("hit"), 220);
  setTimeout(() => els.mallet.classList.remove("swing"), 220);
  setTimeout(() => els.muyu.parentElement.classList.remove("impact"), 220);

  ripple();
  floatMerit();
  bumpCombo();
  sound();
  navigator.vibrate?.([12, 30, 18]);

  if (state.session) {
    state.pending += 1;
    savePending();
    render();
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
    render();
  }
}

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
  els.authModal.hidden = false;
  setTimeout(() => (state.session ? null : els.email.focus()), 60);
}

function closeAuth() {
  els.authModal.hidden = true;
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
    if (!els.authModal.hidden) {
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
  render();

  els.muyu.addEventListener("pointerdown", tap);
  els.muyu.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") tap(e);
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) tap(e);
    if (e.key === "Escape") closeAuth();
  });

  els.soundToggle.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    saveSound();
    if (state.soundOn) sound();
  });

  els.authBtn.addEventListener("click", openAuth);
  els.guestLogin.addEventListener("click", openAuth);
  els.authModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeAuth();
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
