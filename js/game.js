/* ============================================================
 * 「下回打你」核心游戏逻辑
 * 清晰区分：状态 / 布局 / 出洞调度 / 点击判定 / 计分 / Combo
 *           / 音频 / Supabase 排行榜 / 被打榜 / UI 更新
 *           / 开始 / 暂停 / 结束 / 重置
 * ============================================================ */
(function (global) {
  "use strict";

  /* ============ 常量 ============ */
  var GAME_DURATION_MS = 30000; // 30 秒
  var BASE_SCORE = 10;
  var COMBO_SCORE = 20;
  var COMBO_MIN = 2; // 连续第 2 次开始 ×2

  // 全局同时出现的硬上限：任何时刻最多 5 只。
  var MAX_ACTIVE_MOLES = 5;

  // 分阶段节奏（单位 ms），由易到难。
  var PHASES = [
    { until: 5000,  min: 1, max: 1, stay: [900, 1200], interval: [700, 1000], noOverlap: true  },
    { until: 15000, min: 1, max: 4, stay: [750, 1000], interval: [600, 850],  noOverlap: false },
    { until: 25000, min: 1, max: 4, stay: [650, 900],  interval: [500, 750],  noOverlap: false },
    { until: 30000, min: 2, max: 4, stay: [550, 800],  interval: [450, 650],  noOverlap: false }
  ];

  var STATE = { IDLE: "idle", COUNTDOWN: "countdown", PLAYING: "playing", PAUSED: "paused", GAMEOVER: "gameover" };
  var HIGH_KEY = "xiabudani_highscore_v1";
  var PLAYER_NAME_KEY = "smileGame.playerName";
  var PLAYER_ID_KEY = "smileGame.playerId";

  /* ============ DOM 引用 ============ */
  var board = document.getElementById("board");
  var gameContainer = document.getElementById("game-container");
  var boardWrap = document.querySelector(".board-wrap");
  var scoreEl = document.getElementById("score");
  var timeEl = document.getElementById("time");
  var highEl = document.getElementById("highscore");
  var hitsEl = document.getElementById("hits");
  var comboIndicator = document.getElementById("combo-indicator");
  var countdownOverlay = document.getElementById("countdown-overlay");
  var countdownNumber = document.getElementById("countdown-number");

  var startBtn = document.getElementById("btn-start");
  var pauseBtn = document.getElementById("btn-pause");
  var soundBtn = document.getElementById("btn-sound");
  var soundIcon = document.getElementById("sound-icon");
  var soundLabel = document.getElementById("sound-label");
  var btnViewBoard = document.getElementById("btn-view-board");
  var playerNameInput = document.getElementById("player-name");
  var btnMain = document.getElementById("btn-main");
  var boardTabButtons = document.querySelectorAll("#board-tabs .segment");
  var howtoCard = document.querySelector(".howto-card");
  var howtoToggle = document.getElementById("howto-toggle");
  var howtoToggleLabel = document.getElementById("howto-toggle-label");
  var howtoToggleArrow = document.getElementById("howto-toggle-arrow");

  var pauseOverlay = document.getElementById("pause-overlay");
  var btnResume = document.getElementById("btn-resume");

  var resultModal = document.getElementById("result-modal");
  var resultRecord = document.getElementById("result-record");
  var resultTop10 = document.getElementById("result-top10");
  var resultUpload = document.getElementById("result-upload");
  var resultScore = document.getElementById("result-score");
  var resultHits = document.getElementById("result-hits");
  var resultHigh = document.getElementById("result-high");
  var btnReplay = document.getElementById("btn-replay");
  var btnResultBoard = document.getElementById("btn-result-board");
  var btnCloseResult = document.getElementById("btn-close-result");

  var boardModal = document.getElementById("board-modal");
  var fullBoard = document.getElementById("full-board");
  var boardModalScroll = boardModal.querySelector(".board-list-scroll");
  var miniBoard = document.getElementById("mini-board");
  var btnCloseBoard = document.getElementById("btn-close-board");
  var btnCloseBoard2 = document.getElementById("btn-close-board2");

  var hitBoardList = document.getElementById("hit-board-list");
  var hitBoardTabButtons = document.querySelectorAll("#hit-board-tabs .segment");
  var btnViewHits = document.getElementById("btn-view-hits");
  var hitModal = document.getElementById("hit-modal");
  var hitModalTabButtons = document.querySelectorAll("#hit-modal-tabs .segment");
  var fullHitBoard = document.getElementById("full-hit-board");
  var btnCloseHit = document.getElementById("btn-close-hit");
  var btnCloseHit2 = document.getElementById("btn-close-hit2");

  var hammerCursor = document.getElementById("hammer-cursor");

  /* ============ 游戏状态 ============ */
  var state = STATE.IDLE;
  var slots = [];      // 9 个洞口对象
  var layout = [];     // 本局 9 个角色（按洞口顺序，名字与图片绑定）
  var score = 0;
  var hits = 0;
  var combo = 0;
  var highscore = 0;         // 本机个人最高分（localStorage）
  var globalRecord = 0;      // 全站纪录显示值（0 表示未知或空榜）
  var globalRecordKnown = false; // 是否已成功读取过排行榜（区分“未知”和“真实 0”）
  var timeLeftMs = GAME_DURATION_MS;
  var tickTimer = null;
  var roundTimer = null;
  var countdownTimer = null;
  var lastTick = 0;
  var lastUsed = [];   // 上一轮使用的洞口（用于降低连续重复概率）
  var newRecord = false;         // 本局是否刷新个人最高分
  var recordBeforeRound = null;  // 本局开始前冻结的全站纪录（null = 未知）
  var myRankBeforeRound = null;  // 本局开始前我在 TOP10 的排名（null=未知, -1=不在, >=0=排名）
  var myLeaderboardScoreBeforeRound = null; // 本局开始前我的排行榜最好成绩（null=未知/不在榜）

  // Supabase / 身份
  var playerId = "";
  var roundId = "";
  var roundCharacterHits = {};   // { character_id: 本轮被打次数 }
  var scoreSubmitted = false;    // 本局是否已发起提交（防前端重复提交）
  var submitAttempted = false;

  // 被打榜 tab 状态
  var hitBoardTab = "all";   // "round" | "all"（首页默认显示累计）
  var hitModalTab = "round";

  // 远端数据缓存
  var publicLeaderboardCache = null;   // TOP3
  var publicLeaderboardFailed = false; // TOP3（首页）
  var publicLeaderboardCache10 = null; // TOP10（总榜 authoritative）
  var publicLeaderboardFailed10 = false; // TOP10（modal 总榜）
  var publicLeaderboardRequestPromise = null; // 总榜在途请求（复用同一请求；settle 后复位以便失败重试）
  var characterHitCache = null;
  var characterHitFailed = false;

  // 设备与排行榜 tab
  var clientType = "web";  // 'mobile' | 'web'（页面加载后 detectClientType 缓存）
  var boardTab = "total";  // 'total' | 'mobile' | 'web'
  var filteredLeaderboardCache = null; // 手机榜/网页榜的筛选结果（仅 modal 显示用）
  var filteredLeaderboardFailed = false;
  var filteredLeaderboardRequestSeq = 0; // 防串榜：单调递增请求序号
  var focusMyRowAfterRender = false; // 打开/切换排行榜后，渲染完成时定位到我的成绩一次
  var lastSingleTap = null;   // iOS double-tap 追踪：{ t, x, y }
  var multiTouchActive = false; // 本次触摸交互是否出现过多指（用于区分 pinch）

  /* ============ 工具函数 ============ */
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  /* 设备识别：优先 userAgentData.mobile，fallback 到移动 UA。不用 viewport width 判断。 */
  function detectClientType() {
    var ud = global.navigator && global.navigator.userAgentData;
    if (ud && typeof ud.mobile === "boolean") {
      return ud.mobile ? "mobile" : "web";
    }
    var ua = (global.navigator && global.navigator.userAgent) || "";
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|IEMobile/i.test(ua)) {
      return "mobile";
    }
    // 现代 iPadOS Safari 使用 desktop-class / Mac UA，且可能无 userAgentData.mobile：
    // 以「MacIntel 平台 + 多点触控」补判为 mobile，不引入 tablet 类别，也不看 viewport width。
    var nav = global.navigator;
    if (nav && nav.platform === "MacIntel" && typeof nav.maxTouchPoints === "number" && nav.maxTouchPoints > 1) {
      return "mobile";
    }
    return "web";
  }

  function deviceLabel(type) {
    if (type === "mobile") return "手机端";
    if (type === "web") return "网页端";
    return null;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    var ss = s % 60;
    return (m < 10 ? "0" + m : m) + ":" + (ss < 10 ? "0" + ss : ss);
  }

  function getPhase(elapsedMs) {
    for (var i = 0; i < PHASES.length; i++) {
      if (elapsedMs < PHASES[i].until) return PHASES[i];
    }
    return PHASES[PHASES.length - 1];
  }

  function newUuid() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return global.crypto.randomUUID();
      }
    } catch (e) { /* fall through */ }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function fmtCount(n) {
    n = Number(n) || 0;
    try { return n.toLocaleString(); } catch (e) { return "" + n; }
  }

  function charById(id) {
    for (var i = 0; i < global.CHARACTERS.length; i++) {
      if (global.CHARACTERS[i].id === id) return global.CHARACTERS[i];
    }
    return null;
  }

  function charIndex(id) {
    for (var i = 0; i < global.CHARACTERS.length; i++) {
      if (global.CHARACTERS[i].id === id) return i;
    }
    return 999;
  }

  /* ============ 构建九宫格 ============ */
  function buildBoard() {
    board.innerHTML = "";
    slots = [];
    for (var i = 0; i < 9; i++) {
      var slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.index = i;
      slot.innerHTML =
        '<div class="hole"></div>' +
        '<div class="mole-viewport">' +
          '<div class="mole"><img alt=""></div>' +
        '</div>' +
        '<div class="hole-front-rim"></div>' +
        '<div class="nameplate"><span class="name"></span></div>';
      board.appendChild(slot);
      slots.push({
        el: slot,
        mole: slot.querySelector(".mole"),
        moleImg: slot.querySelector(".mole img"),
        nameEl: slot.querySelector(".name"),
        characterId: "",
        active: false,
        hit: false,
        hideTimer: null,
        stayEnd: 0,
        remaining: 0
      });
    }
  }

  /* ============ 随机布局（人物与洞口绑定，每局洗牌一次） ============ */
  function assignLayout() {
    layout = shuffle(global.CHARACTERS);
    for (var i = 0; i < 9; i++) {
      var s = slots[i];
      var ch = layout[i];
      s.nameEl.textContent = ch.name;
      s.moleImg.src = ch.image;
      s.moleImg.alt = ch.name;
      s.characterId = ch.id;
      // 应用角色出洞高度微调（默认 0）
      s.mole.style.setProperty("--dy", (ch.displayOffsetY || 0) + "%");
    }
  }

  function clearLayout() {
    for (var i = 0; i < 9; i++) {
      var s = slots[i];
      s.nameEl.textContent = "";
      s.moleImg.removeAttribute("src");
      s.moleImg.alt = "";
      s.characterId = "";
    }
  }

  /* ============ 出洞调度 ============ */
  function pickSlots(count) {
    var available = [];
    for (var i = 0; i < 9; i++) if (!slots[i].active) available.push(i);
    var n = Math.min(count, available.length);
    if (n <= 0) return [];
    available = shuffle(available);
    // 降低上一轮刚出现过的洞口被再次选中的概率（但不禁用）
    available.sort(function (a, b) {
      var ra = lastUsed.indexOf(a) >= 0 ? 1 : 0;
      var rb = lastUsed.indexOf(b) >= 0 ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return Math.random() - 0.5;
    });
    var picked = available.slice(0, n);
    lastUsed = picked.slice();
    return picked;
  }

  function activeCount() {
    var n = 0;
    for (var i = 0; i < 9; i++) if (slots[i].active) n++;
    return n;
  }

  function scheduleNextRound() {
    if (state !== STATE.PLAYING) return;
    var elapsed = GAME_DURATION_MS - timeLeftMs;
    var phase = getPhase(elapsed);
    // 全局硬上限：已有 active 的只数不能超过 MAX_ACTIVE_MOLES，剩余名额才允许新增。
    var budget = Math.max(0, MAX_ACTIVE_MOLES - activeCount());
    var count = Math.min(randInt(phase.min, phase.max), budget);
    var picked = pickSlots(count);
    var warmupStay = 0;
    for (var i = 0; i < picked.length; i++) {
      var stay = Math.round(rand(phase.stay[0], phase.stay[1]));
      if (phase.noOverlap) warmupStay = stay;
      showMole(picked[i], stay);
    }
    var delay;
    if (phase.noOverlap) {
      delay = warmupStay + randInt(200, 400);
    } else {
      delay = Math.round(rand(phase.interval[0], phase.interval[1]));
    }
    roundTimer = setTimeout(scheduleNextRound, delay);
  }

  function showMole(index, stayMs) {
    var s = slots[index];
    if (s.active) return;
    s.active = true;
    s.hit = false;
    s.stayEnd = Date.now() + stayMs;
    s.remaining = stayMs;
    s.mole.classList.remove("hit");
    s.mole.classList.add("up");
    s.hideTimer = setTimeout(function () { hideMole(index, false); }, stayMs);
  }

  function hideMole(index, wasHit) {
    var s = slots[index];
    if (s.hideTimer) { clearTimeout(s.hideTimer); s.hideTimer = null; }
    var wasActive = s.active;
    s.active = false;
    if (wasHit) s.mole.classList.add("hit");
    s.mole.classList.remove("up");
    if (wasHit) {
      setTimeout(function () { s.mole.classList.remove("hit"); }, 300);
    }
    // 土拨鼠自己缩回且未被击中 -> 中断连击
    if (!wasHit && wasActive && state === STATE.PLAYING) {
      breakCombo();
    }
  }

  function hideAllMoles() {
    for (var i = 0; i < 9; i++) {
      var s = slots[i];
      if (s.hideTimer) { clearTimeout(s.hideTimer); s.hideTimer = null; }
      s.active = false;
      s.hit = false;
      s.mole.classList.remove("up");
      s.mole.classList.remove("hit");
    }
  }

  function clearRoundTimer() {
    if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
  }

  function clearAllTimers() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    clearRoundTimer();
    if (countdownTimer) { clearInterval(countdownTimer); clearTimeout(countdownTimer); countdownTimer = null; }
    for (var i = 0; i < 9; i++) {
      if (slots[i].hideTimer) { clearTimeout(slots[i].hideTimer); slots[i].hideTimer = null; }
    }
  }

  /* ============ 点击判定 ============ */
  function onBoardPointerDown(e) {
    if (state !== STATE.PLAYING) return;
    var slotEl = e.target && e.target.closest ? e.target.closest(".slot") : null;
    if (slotEl) {
      onSlotClick(parseInt(slotEl.dataset.index, 10));
    } else {
      breakCombo();
      showMissFeedback(null);
    }
  }

  function onSlotClick(index) {
    var s = slots[index];
    if (s.active && !s.hit) {
      s.hit = true;
      hits++;
      combo++;
      var points = combo >= COMBO_MIN ? COMBO_SCORE : BASE_SCORE;
      score += points;

      // 同一有效 hit 分支里，同时累计该角色本轮被打次数
      var chId = s.characterId;
      if (chId) {
        roundCharacterHits[chId] = (roundCharacterHits[chId] || 0) + 1;
      }

      global.AudioManager.playHit();
      showHitFeedback(index, points);
      hideMole(index, true);
      updateComboUI(true);
      updateScoreUI();
      checkHighscore();
      pulseBoard();
      renderHitBoard();
    } else {
      breakCombo();
      showMissFeedback(index);
    }
  }

  /* ============ 计分 / Combo ============ */
  function breakCombo() {
    if (combo === 0) return;
    combo = 0;
    updateComboUI(false);
  }

  function checkHighscore() {
    if (score > highscore) {
      highscore = score;
      saveHighscore();
      newRecord = true;
      updateScoreUI();
    }
  }

  /* ============ 反馈特效 ============ */
  function showHitFeedback(index, points) {
    var s = slots[index];
    var el = document.createElement("div");
    el.className = "float-text" + (points >= COMBO_SCORE ? " combo" : "");
    el.textContent = "+" + points;
    s.el.appendChild(el);
    setTimeout(function () { el.remove(); }, 600);

    var spark = document.createElement("div");
    spark.className = "spark";
    s.el.appendChild(spark);
    setTimeout(function () { spark.remove(); }, 500);
  }

  function showMissFeedback(index) {
    if (index == null) return;
    var s = slots[index];
    var el = document.createElement("div");
    el.className = "float-text miss";
    el.textContent = "MISS";
    s.el.appendChild(el);
    setTimeout(function () { el.remove(); }, 450);
  }

  function pulseBoard() {
    boardWrap.classList.remove("shake");
    void boardWrap.offsetWidth;
    boardWrap.classList.add("shake");
    setTimeout(function () { boardWrap.classList.remove("shake"); }, 200);
  }

  /* ============ UI 更新 ============ */
  function updateScoreUI() {
    scoreEl.textContent = score;
    hitsEl.textContent = hits;
    highEl.textContent = globalRecord;
  }

  function updateTimeUI() {
    timeEl.textContent = fmtTime(timeLeftMs);
  }

  function updateStatsUI() {
    updateScoreUI();
    updateTimeUI();
  }

  function updateComboUI(justScored) {
    if (combo >= COMBO_MIN) {
      comboIndicator.classList.add("show");
      if (justScored) {
        comboIndicator.classList.remove("pulse");
        void comboIndicator.offsetWidth;
        comboIndicator.classList.add("pulse");
      }
    } else {
      comboIndicator.classList.remove("show");
      comboIndicator.classList.remove("pulse");
    }
  }

  /* ============ 最高分（localStorage，本机个人最高分） ============ */
  function loadHighscore() {
    try {
      var v = parseInt(localStorage.getItem(HIGH_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  }

  function saveHighscore() {
    try { localStorage.setItem(HIGH_KEY, String(highscore)); } catch (e) { /* ignore */ }
  }

  /* ============ 玩家姓名 / 匿名 player_id ============ */
  function normalizePlayerName(raw) {
    var n = (raw == null ? "" : String(raw)).trim();
    if (!n) n = "玩家";
    if (n.length > 12) n = n.slice(0, 12);
    return n;
  }

  function loadPlayerName() {
    try {
      return localStorage.getItem(PLAYER_NAME_KEY) || "";
    } catch (e) { return ""; }
  }

  function savePlayerName(name) {
    try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch (e) { /* ignore */ }
  }

  function currentPlayerName() {
    return normalizePlayerName(playerNameInput.value);
  }

  function getOrCreatePlayerId() {
    var id = "";
    try { id = localStorage.getItem(PLAYER_ID_KEY) || ""; } catch (e) { id = ""; }
    if (!id) {
      id = newUuid();
      try { localStorage.setItem(PLAYER_ID_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  /* 规范化姓名：业务仍以「玩家」作为空名 fallback，但 UI 不再把「玩家」写回输入框，
     空输入保持为空，让 placeholder「输入你的昵称」显示。 */
  function applyNormalizedName() {
    var raw = (playerNameInput.value == null ? "" : String(playerNameInput.value)).trim();
    var n = normalizePlayerName(raw);
    playerNameInput.value = raw;
    savePlayerName(n);
    return n;
  }

  /* ============ 本轮被打统计 ============ */
  function emptyRoundHits() {
    var obj = {};
    for (var i = 0; i < global.CHARACTERS.length; i++) {
      obj[global.CHARACTERS[i].id] = 0;
    }
    return obj;
  }

  function getRoundHitEntries() {
    var entries = [];
    for (var i = 0; i < global.CHARACTERS.length; i++) {
      var ch = global.CHARACTERS[i];
      entries.push({ id: ch.id, name: ch.name, hits: roundCharacterHits[ch.id] || 0 });
    }
    entries.sort(function (a, b) {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return charIndex(a.id) - charIndex(b.id);
    });
    return entries;
  }

  function hitsInvariantSum() {
    var sum = 0;
    for (var id in roundCharacterHits) {
      if (Object.prototype.hasOwnProperty.call(roundCharacterHits, id)) {
        sum += roundCharacterHits[id] || 0;
      }
    }
    return sum;
  }

  function verifyHitsInvariant() {
    return hitsInvariantSum() === hits;
  }

  /* ============ 被打榜渲染 ============ */
  function normalizeAllEntries(cache) {
    var out = [];
    for (var i = 0; i < (cache || []).length; i++) {
      var row = cache[i];
      var ch = charById(row.character_id);
      out.push({
        id: row.character_id,
        name: row.character_name || (ch ? ch.name : row.character_id),
        hits: row.total_hits || 0
      });
    }
    return out;
  }

  function appendHitEmpty(listEl, text) {
    var li = document.createElement("li");
    li.className = "hit-empty";
    li.textContent = text;
    listEl.appendChild(li);
  }

  function renderHitEntriesTo(listEl, entries, limit) {
    var n = Math.min(limit == null ? entries.length : limit, entries.length);
    for (var i = 0; i < n; i++) {
      var e = entries[i];
      var li = document.createElement("li");
      li.dataset.rank = String(i + 1);
      var nameEl = document.createElement("span");
      nameEl.className = "hit-name";
      nameEl.textContent = e.name;
      var countEl = document.createElement("span");
      countEl.className = "hit-count";
      countEl.textContent = fmtCount(e.hits) + " 次";
      li.appendChild(nameEl);
      li.appendChild(countEl);
      listEl.appendChild(li);
    }
  }

  function renderHitBoard() {
    hitBoardList.innerHTML = "";
    if (hitBoardTab === "round") {
      var entries = getRoundHitEntries();
      var anyHit = entries.some(function (e) { return e.hits > 0; });
      if (!anyHit) {
        appendHitEmpty(hitBoardList, "本轮还没人挨打");
      } else {
        renderHitEntriesTo(hitBoardList, entries, 3);
      }
    } else {
      if (characterHitFailed) {
        appendHitEmpty(hitBoardList, "累计数据暂时无法连接");
      } else if (!characterHitCache) {
        appendHitEmpty(hitBoardList, "被打榜加载中…");
      } else {
        var allEntries = normalizeAllEntries(characterHitCache);
        if (allEntries.length === 0) {
          appendHitEmpty(hitBoardList, "累计暂无记录");
        } else {
          renderHitEntriesTo(hitBoardList, allEntries, 3);
        }
      }
    }
  }

  function renderHitModalBoard() {
    fullHitBoard.innerHTML = "";
    if (hitModalTab === "round") {
      renderHitEntriesTo(fullHitBoard, getRoundHitEntries(), 9);
    } else {
      if (characterHitFailed) {
        appendHitEmpty(fullHitBoard, "累计数据暂时无法连接");
      } else if (!characterHitCache) {
        appendHitEmpty(fullHitBoard, "被打榜加载中…");
      } else {
        var allEntries = normalizeAllEntries(characterHitCache);
        if (allEntries.length === 0) {
          appendHitEmpty(fullHitBoard, "累计暂无记录");
        } else {
          renderHitEntriesTo(fullHitBoard, allEntries, 9);
        }
      }
    }
  }

  function updateHitTabs() {
    hitBoardTabButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === hitBoardTab);
    });
    hitModalTabButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === hitModalTab);
    });
  }

  /* ============ 计时 ============ */
  function tick() {
    var now = Date.now();
    var delta = now - lastTick;
    lastTick = now;
    timeLeftMs -= delta;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      updateTimeUI();
      endGame();
      return;
    }
    updateTimeUI();
  }

  /* ============ 开始 / 重置（统一进入 3 秒准备倒计时） ============ */
  function startGame() {
    clearAllTimers();
    hideAllMoles();
    hideResultModal();
    hidePauseOverlay();
    hideHammer();
    board.classList.remove("cursor-hammer");
    global.AudioManager.stopBgm();
    global.AudioManager.prepareForGame(); // 预加载 BGM + 解码 hit + 解锁 AudioContext
    global.AudioManager.playBgm(); // 真实 user gesture 内直接启动 BGM（文件前 2s 为静音前奏）

    applyNormalizedName(); // trim + 空名 -> 玩家

    score = 0;
    hits = 0;
    combo = 0;
    newRecord = false;
    // 冻结本局开始前的排行榜基线（未知时不拿 0 当证明）
    recordBeforeRound = globalRecordKnown ? globalRecord : null;
    computeMyLeaderboardBaseline();
    timeLeftMs = GAME_DURATION_MS;
    lastUsed = [];

    // 每一局：新的 round_id、本轮被打统计归零、重置提交标记
    roundId = newUuid();
    roundCharacterHits = emptyRoundHits();
    scoreSubmitted = false;
    submitAttempted = false;

    // 被打榜切回「本轮」
    hitBoardTab = "round";
    hitModalTab = "round";
    updateHitTabs();
    renderHitBoard();

    assignLayout(); // 重新随机人物与洞口的绑定
    updateStatsUI();
    updateComboUI(false);

    // 手机端：先收起玩法说明 + 定位回游戏主视图，再进入倒计时（届时锁定滚动）。
    focusMobileGameView(startCountdown);
  }

  function startCountdown() {
    state = STATE.COUNTDOWN;
    updateButtons();
    var steps = ["3", "2", "1"];
    var i = 0;
    showCountdown(steps[0]);
    countdownTimer = setInterval(function () {
      i++;
      if (i < steps.length) {
        showCountdown(steps[i]);
      } else {
        clearInterval(countdownTimer);
        countdownTimer = null;
        showCountdown("开始！");
        countdownTimer = setTimeout(function () {
          countdownTimer = null;
          hideCountdown();
          beginPlay();
        }, 600);
      }
    }, 1000);
  }

  function beginPlay() {
    state = STATE.PLAYING;
    // BGM 已在 startGame 的 user gesture 内启动，这里不碰 BGM、不重置 currentTime。
    lastTick = Date.now();
    tickTimer = setInterval(tick, 100);
    updateButtons();
    scheduleNextRound();
  }

  function showCountdown(text) {
    countdownNumber.textContent = text;
    countdownOverlay.hidden = false;
    countdownNumber.classList.remove("pop");
    void countdownNumber.offsetWidth;
    countdownNumber.classList.add("pop");
  }

  function hideCountdown() {
    countdownOverlay.hidden = true;
  }

  /* ============ 暂停 / 恢复 ============ */
  function pauseGame() {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    clearRoundTimer();
    var now = Date.now();
    for (var i = 0; i < 9; i++) {
      var s = slots[i];
      if (s.active) {
        if (s.hideTimer) { clearTimeout(s.hideTimer); s.hideTimer = null; }
        s.remaining = Math.max(0, s.stayEnd - now);
      }
    }
    global.AudioManager.pauseBgm();
    hideHammer();
    showPauseOverlay();
    updateButtons();
  }

  function resumeGame() {
    if (state !== STATE.PAUSED) return;
    // 暂停期间 viewport lock 一直保持，resume 不再 scrollIntoView，直接恢复 PLAYING，保持原视口位置。
    state = STATE.PLAYING;
    global.AudioManager.resumeBgm();
    lastTick = Date.now();
    tickTimer = setInterval(tick, 100);
    for (var i = 0; i < 9; i++) {
      var s = slots[i];
      if (s.active) {
        s.stayEnd = Date.now() + s.remaining;
        s.hideTimer = setTimeout(function (idx) {
          return function () { hideMole(idx, false); };
        }(i), s.remaining);
      }
    }
    hidePauseOverlay();
    updateButtons();
    scheduleNextRound();
  }

  /* ============ 结束 ============ */
  function endGame() {
    state = STATE.GAMEOVER;
    clearAllTimers();
    hideAllMoles();
    hideHammer();
    board.classList.remove("cursor-hammer");
    global.AudioManager.stopBgm();

    applyNormalizedName();
    updateButtons();
    showResultModal();
    // 本轮被打榜保留到下一局 countdown 才清零（玩家结束后还能看到这局谁挨打最多）
    renderHitBoard();

    // 异步提交（不阻塞结算弹窗）
    submitRoundScore(1);
  }

  /* ============ 提交成绩 ============ */
  function submitRoundScore(attempt) {
    if (scoreSubmitted) return;
    if (submitAttempted && attempt === 1) return; // 已经发起过（重试由内部处理）
    submitAttempted = true;

    if (!verifyHitsInvariant()) {
      global.console && global.console.error("成绩统计异常，未上传");
      resultUpload.textContent = "成绩统计异常，未上传";
      resultUpload.hidden = false;
      return;
    }

    if (!global.Supabase.isConfigured()) {
      resultUpload.textContent = "成绩暂未上传";
      resultUpload.hidden = false;
      return;
    }

    var payload = {
      p_player_id: playerId,
      p_player_name: currentPlayerName(),
      p_score: score,
      p_hits: hits,
      p_round_id: roundId,
      p_character_hits: roundCharacterHits,
      p_client_type: clientType
    };

    global.Supabase.submitGameScoreV2(payload).then(function () {
      scoreSubmitted = true;
      resultUpload.hidden = true;
      // 刷新公共 TOP3 / 累计被打榜；若排行榜弹窗开着也同步刷新
      loadMiniBoard();
      loadCharacterHits().then(function () {
        renderHitBoard();
        if (!hitModal.hidden) renderHitModalBoard();
      });
      loadFullBoard().then(function (list) {
        if (!list || !playerId) return; // 提交/刷新失败或无身份，不显示排行榜成就

        // 提交后“我”的真实状态
        var myRankAfter = -1;
        for (var i = 0; i < list.length; i++) {
          if (list[i].player_id === playerId) { myRankAfter = i; break; }
        }

        // 本局是否真正改善了排行榜成绩（基线未知时不猜测）
        var roundImproved = false;
        if (myRankBeforeRound === null) {
          roundImproved = false; // 未知，不发猜测成就
        } else if (myRankBeforeRound === -1) {
          roundImproved = (myRankAfter >= 0); // 开局前不在榜：本局进榜才算改善
        } else {
          roundImproved = (myLeaderboardScoreBeforeRound !== null && score > myLeaderboardScoreBeforeRound);
        }

        // 三级成就，只显示最高优先级的一个
        if (recordBeforeRound !== null && score > recordBeforeRound) {
          resultTop10.textContent = "👑 刷新全站纪录！";
          resultTop10.hidden = false;
        } else if (roundImproved && myRankAfter === 0) {
          resultTop10.textContent = "🥇 登顶排行榜！";
          resultTop10.hidden = false;
        } else if (roundImproved && myRankAfter >= 0) {
          resultTop10.textContent = "🏆 进入排行榜 TOP 10！";
          resultTop10.hidden = false;
        }
      });
    }).catch(function () {
      if (attempt === 1) {
        // 允许一次轻量自动重试（继续用同一个 round_id，数据库幂等）
        setTimeout(function () { submitRoundScore(2); }, 1200);
      } else {
        resultUpload.textContent = "成绩暂未上传";
        resultUpload.hidden = false;
      }
    });
  }

  /* ============ 按钮状态 + 姓名锁定 ============ */
  function updateNameLock() {
    var locked = (state === STATE.COUNTDOWN || state === STATE.PLAYING || state === STATE.PAUSED);
    playerNameInput.disabled = locked;
  }

  function updateButtons() {
    if (state === STATE.IDLE) {
      startBtn.textContent = "开始游戏";
      pauseBtn.textContent = "暂停";
      pauseBtn.disabled = true;
    } else if (state === STATE.COUNTDOWN) {
      startBtn.textContent = "重新开始";
      pauseBtn.textContent = "暂停";
      pauseBtn.disabled = true;
    } else if (state === STATE.PLAYING) {
      startBtn.textContent = "重新开始";
      pauseBtn.textContent = "暂停";
      pauseBtn.disabled = false;
    } else if (state === STATE.PAUSED) {
      startBtn.textContent = "重新开始";
      pauseBtn.textContent = "继续";
      pauseBtn.disabled = false;
    } else if (state === STATE.GAMEOVER) {
      startBtn.textContent = "再来一局";
      pauseBtn.textContent = "暂停";
      pauseBtn.disabled = true;
    }
    updateNameLock();
    updateMainButton();
    updateMobileChrome();
  }

  /* 手机端唯一主按钮：复用单一 state，路由到现有 start/pause/resume。 */
  function updateMainButton() {
    if (!btnMain) return;
    if (state === STATE.IDLE) {
      btnMain.textContent = "开始游戏";
      btnMain.disabled = false;
    } else if (state === STATE.COUNTDOWN) {
      btnMain.textContent = "开始游戏";
      btnMain.disabled = true; // 倒计时中不允许二次启动
    } else if (state === STATE.PLAYING) {
      btnMain.textContent = "暂停";
      btnMain.disabled = false;
    } else if (state === STATE.PAUSED) {
      btnMain.textContent = "继续";
      btnMain.disabled = false;
    } else if (state === STATE.GAMEOVER) {
      btnMain.textContent = "再来一局";
      btnMain.disabled = false;
    }
  }

  /* 玩法说明折叠是独立 UI disclosure state：手动展开/收起；开始新一局时强制折叠。 */
  function setHowtoCollapsed(collapsed) {
    if (!howtoCard) return;
    howtoCard.classList.toggle("collapsed", collapsed);
    if (howtoToggle) {
      howtoToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (howtoToggleLabel) howtoToggleLabel.textContent = collapsed ? "查看规则" : "收起";
      if (howtoToggleArrow) howtoToggleArrow.textContent = collapsed ? "▼" : "▲";
    }
  }

  /* 手机端：收起玩法说明 + 定位回游戏主视图，再执行回调；桌面端直接执行回调。
     顺序保证 scroll 发生在 game-active 锁定之前，避免锁定后定位失效。 */
  function focusMobileGameView(callback) {
    if (clientType !== "mobile") {
      callback();
      return;
    }
    setHowtoCollapsed(true);
    requestAnimationFrame(function () {
      if (gameContainer) gameContainer.scrollIntoView({ block: "start" });
      callback();
    });
  }

  /* 手机端：COUNTDOWN/PLAYING/PAUSED 都保持游戏会话视口锁；IDLE/GAMEOVER 才解锁。
     暂停只暂停计时/土拨鼠/BGM，不释放 viewport lock。 */
  function updateMobileChrome() {
    var mobile = (clientType === "mobile");
    var active = mobile && (state === STATE.COUNTDOWN || state === STATE.PLAYING || state === STATE.PAUSED);
    document.body.classList.toggle("game-active", active);
    document.documentElement.classList.toggle("game-active", active);
    if (active) {
      setHowtoCollapsed(true);
    } else {
      // 离开游戏会话（IDLE/GAMEOVER）清空 double-tap 追踪，避免残留误判
      lastSingleTap = null;
      multiTouchActive = false;
    }
  }

  function toggleSound() {
    global.AudioManager.setEnabled(!global.AudioManager.isEnabled());
    if (global.AudioManager.isEnabled()) {
      soundIcon.textContent = "🔊";
      soundLabel.textContent = "声音";
    } else {
      soundIcon.textContent = "🔇";
      soundLabel.textContent = "静音";
    }
  }

  /* ============ 暂停遮罩 ============ */
  function showPauseOverlay() { pauseOverlay.hidden = false; }
  function hidePauseOverlay() { pauseOverlay.hidden = true; }

  /* ============ 结果弹窗 ============ */
  function showResultModal() {
    resultScore.textContent = score;
    resultHits.textContent = hits;
    resultHigh.textContent = highscore;
    resultRecord.hidden = !newRecord;
    resultTop10.hidden = true;
    resultTop10.textContent = "🏆 进入排行榜 TOP 10！";
    resultUpload.hidden = true;
    resultModal.hidden = false;
  }

  function hideResultModal() { resultModal.hidden = true; }

  /* ============ 公共排行榜渲染 ============ */
  function appendMiniEmpty(text) {
    var li = document.createElement("li");
    li.className = "mini-empty";
    li.textContent = text;
    miniBoard.appendChild(li);
  }

  function appendFbEmpty(text) {
    var li = document.createElement("li");
    li.className = "fb-empty";
    li.textContent = text;
    fullBoard.appendChild(li);
  }

  function renderMiniBoard() {
    miniBoard.innerHTML = "";
    if (publicLeaderboardFailed) {
      appendMiniEmpty("排行榜暂时无法连接");
      return;
    }
    if (!publicLeaderboardCache) {
      appendMiniEmpty("排行榜加载中…");
      return;
    }
    var list = publicLeaderboardCache;
    if (list.length === 0) {
      appendMiniEmpty("暂无记录，快来挑战吧！");
      return;
    }
    for (var i = 0; i < Math.min(3, list.length); i++) {
      var e = list[i];
      var li = document.createElement("li");
      if (playerId && e.player_id === playerId) li.classList.add("highlight");
      var nameEl = document.createElement("span");
      nameEl.className = "mini-name";
      nameEl.textContent = e.player_name || "玩家";
      li.appendChild(nameEl);
      var dl = deviceLabel(e.client_type);
      if (dl) {
        var dEl = document.createElement("span");
        dEl.className = "device-tag";
        dEl.textContent = dl;
        li.appendChild(dEl);
      }
      var meta = document.createElement("span");
      meta.textContent = (e.hits || 0) + " 击";
      var sc = document.createElement("span");
      sc.className = "mini-score";
      sc.textContent = (e.score || 0) + " 分";
      li.appendChild(meta);
      li.appendChild(sc);
      miniBoard.appendChild(li);
    }
  }

  function renderFullBoard() {
    fullBoard.innerHTML = "";
    var cache, failed;
    if (boardTab === "total") {
      cache = publicLeaderboardCache10;
      failed = publicLeaderboardFailed10;
    } else {
      cache = filteredLeaderboardCache;
      failed = filteredLeaderboardFailed;
    }
    if (failed) {
      focusMyRowAfterRender = false; // 最终失败：结束本次 focus intent
      appendFbEmpty("排行榜暂时无法连接");
      return;
    }
    if (!cache) {
      // 中间 loading 状态：不消费 focus intent，等最终数据 render 再定位
      appendFbEmpty("排行榜加载中…");
      return;
    }
    if (cache.length === 0) {
      focusMyRowAfterRender = false; // 最终空榜：结束本次 focus intent，保持顶部
      appendFbEmpty("暂无记录，快来挑战吧！");
      return;
    }
    for (var i = 0; i < cache.length; i++) {
      var e = cache[i];
      var li = document.createElement("li");
      var isMe = !!(playerId && e.player_id === playerId);
      if (isMe) li.classList.add("highlight");
      var nameEl = document.createElement("span");
      nameEl.className = "fb-name";
      nameEl.textContent = e.player_name || "玩家";
      li.appendChild(nameEl);
      var dl = deviceLabel(e.client_type);
      if (dl) {
        var dEl = document.createElement("span");
        dEl.className = "device-tag";
        dEl.textContent = dl;
        li.appendChild(dEl);
      }
      if (isMe) {
        var tag = document.createElement("span");
        tag.className = "fb-me";
        tag.textContent = "我的成绩";
        li.appendChild(tag);
      }
      var scoreEl = document.createElement("span");
      scoreEl.className = "fb-score";
      scoreEl.textContent = (e.score || 0) + " 分";
      var meta = document.createElement("span");
      meta.className = "fb-meta";
      meta.textContent = (e.hits || 0) + " 击 · " + fmtDateTime(e.created_at);
      li.appendChild(scoreEl);
      li.appendChild(meta);
      fullBoard.appendChild(li);
    }
    if (focusMyRowAfterRender) {
      focusMyRowAfterRender = false;
      requestAnimationFrame(focusMyLeaderboardRowIfNeeded);
    }
  }

  /* 排行榜 modal 内智能定位到「我的成绩」：已完整可见则不动，否则滚到可视区中部。 */
  function focusMyLeaderboardRowIfNeeded() {
    var container = boardModalScroll;
    if (!container || container.clientHeight <= 0) return;
    var row = fullBoard.querySelector("li.highlight");
    if (!row) return; // 当前 tab 没有我：保持顶部
    var cr = container.getBoundingClientRect();
    var rr = row.getBoundingClientRect();
    var top = cr.top + container.clientTop;
    var bottom = top + container.clientHeight;
    if (rr.top >= top && rr.bottom <= bottom) return; // 已完整可见
    var target = container.scrollTop + (rr.top - top) - (container.clientHeight / 2) + (rr.height / 2);
    container.scrollTop = Math.max(0, target);
  }

  /* 从公共排行榜结果刷新全站纪录（第 1 名 score）。
     空榜显示 0；读取失败时不调用本函数，从而保留最近一次成功值。 */
  function applyGlobalRecord(list) {
    var arr = list || [];
    globalRecord = (arr.length > 0) ? (Number(arr[0].score) || 0) : 0;
    globalRecordKnown = true; // 成功读取过，之后才允许用 globalRecord 做纪录判断
    updateScoreUI();
  }

  /* 基于最近一次成功取得的 TOP10 冻结“我”的排行榜基线。 */
  function computeMyLeaderboardBaseline() {
    var list = publicLeaderboardCache10;
    if (!list) {
      myRankBeforeRound = null;
      myLeaderboardScoreBeforeRound = null;
      return;
    }
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].player_id === playerId) {
        myRankBeforeRound = i;
        myLeaderboardScoreBeforeRound = Number(list[i].score) || 0;
        found = true;
        break;
      }
    }
    if (!found) {
      myRankBeforeRound = -1;
      myLeaderboardScoreBeforeRound = null;
    }
  }

  function loadMiniBoard() {
    if (!global.Supabase.isConfigured()) {
      publicLeaderboardFailed = true;
      renderMiniBoard();
      return Promise.resolve();
    }
    return global.Supabase.getPublicLeaderboardV2(3, null).then(function (list) {
      publicLeaderboardCache = list || [];
      publicLeaderboardFailed = false;
      renderMiniBoard();
      applyGlobalRecord(publicLeaderboardCache);
    }).catch(function () {
      publicLeaderboardFailed = true;
      renderMiniBoard();
    });
  }

  function loadFullBoard() {
    // 复用已在途的总榜请求（返回同一个 Promise），避免重复请求导致二次 render 重置 modal scrollTop。
    if (publicLeaderboardRequestPromise) return publicLeaderboardRequestPromise;
    if (!global.Supabase.isConfigured()) {
      publicLeaderboardFailed10 = true;
      renderFullBoard();
      return Promise.resolve(null);
    }
    // 发起前把失败态恢复为 loading（cache10 仍为 null，failed10 置 false）。
    publicLeaderboardFailed10 = false;
    renderFullBoard();
    var p = global.Supabase.getPublicLeaderboardV2(10, null).then(function (list) {
      publicLeaderboardRequestPromise = null;
      publicLeaderboardCache10 = list || [];
      publicLeaderboardFailed10 = false;
      applyGlobalRecord(publicLeaderboardCache10);
      // 只有当前仍在总榜 tab 才刷新 modal，避免后台总榜返回污染手机榜/网页榜。
      if (boardTab === "total") renderFullBoard();
      return publicLeaderboardCache10;
    }).catch(function () {
      publicLeaderboardRequestPromise = null;
      publicLeaderboardFailed10 = true;
      if (boardTab === "total") renderFullBoard();
      return null;
    });
    publicLeaderboardRequestPromise = p;
    return p;
  }

  /* 手机榜/网页榜筛选结果（仅 modal 显示用，绝不写回 authoritative 状态） */
  function loadFilteredLeaderboard() {
    var requestSeq = ++filteredLeaderboardRequestSeq;
    var requestedTab = boardTab;
    var clientTypeParam = (requestedTab === "mobile") ? "mobile" : "web";
    // 切换 tab 立即进入 loading，避免先显示上一个 tab 的旧数据 / 旧 empty
    filteredLeaderboardCache = null;
    filteredLeaderboardFailed = false;
    if (!global.Supabase.isConfigured()) {
      filteredLeaderboardFailed = true;
      renderFullBoard();
      return Promise.resolve(null);
    }
    renderFullBoard();
    return global.Supabase.getPublicLeaderboardV2(10, clientTypeParam).then(function (list) {
      // 过期响应：不写缓存 / 失败态，也不渲染
      if (requestSeq !== filteredLeaderboardRequestSeq || boardTab !== requestedTab) return null;
      filteredLeaderboardCache = list || [];
      filteredLeaderboardFailed = false;
      renderFullBoard();
      return filteredLeaderboardCache;
    }).catch(function () {
      if (requestSeq !== filteredLeaderboardRequestSeq || boardTab !== requestedTab) return null;
      filteredLeaderboardFailed = true;
      filteredLeaderboardCache = null;
      renderFullBoard();
      return null;
    });
  }

  function updateBoardTabs() {
    boardTabButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === boardTab);
    });
  }

  function loadCharacterHits() {
    if (!global.Supabase.isConfigured()) {
      characterHitFailed = true;
      characterHitCache = null;
      return Promise.resolve();
    }
    return global.Supabase.getCharacterHitLeaderboard().then(function (list) {
      characterHitCache = list || [];
      characterHitFailed = false;
    }).catch(function () {
      characterHitFailed = true;
      characterHitCache = null;
    });
  }

  function showBoardModal() {
    boardModal.hidden = false;
    boardTab = "total"; // 每次重新打开都回到总榜，不记忆上次关闭前的 tab
    updateBoardTabs();
    focusMyRowAfterRender = true; // 打开时渲染完成后定位到我的成绩一次
    if (boardModalScroll) boardModalScroll.scrollTop = 0; // 名单区显式归零，不依赖 DOM 清空副作用
    // 总榜 authoritative；尚未加载成功（含失败）就允许重试
    if (!publicLeaderboardCache10) {
      loadFullBoard();
    } else {
      renderFullBoard();
    }
  }

  function hideBoardModal() { boardModal.hidden = true; }

  /* ============ 被打榜弹窗 ============ */
  function showHitModal() {
    hitModalTab = hitBoardTab;
    updateHitTabs();
    renderHitModalBoard();
    hitModal.hidden = false;
  }

  function hideHitModal() { hitModal.hidden = true; }

  /* ============ 跟随锤子光标 ============ */
  function showHammer() { hammerCursor.hidden = false; }
  function hideHammer() { hammerCursor.hidden = true; }

  function moveHammer(e) {
    if (state !== STATE.PLAYING) return;
    showHammer();
    hammerCursor.style.left = (e.clientX - 31) + "px";
    hammerCursor.style.top = (e.clientY - 40) + "px";
  }

  function smashHammer() {
    if (hammerCursor.hidden) return;
    hammerCursor.classList.remove("smash");
    void hammerCursor.offsetWidth;
    hammerCursor.classList.add("smash");
    setTimeout(function () { hammerCursor.classList.remove("smash"); }, 200);
  }

  /* ============ 初始化 ============ */
  function preloadAssets() {
    for (var i = 0; i < global.CHARACTERS.length; i++) {
      var img = new Image();
      img.src = global.CHARACTERS[i].image;
    }
  }

  function bindEvents() {
    startBtn.addEventListener("click", startGame);
    pauseBtn.addEventListener("click", function () {
      if (state === STATE.PLAYING) pauseGame();
      else if (state === STATE.PAUSED) resumeGame();
    });
    soundBtn.addEventListener("click", toggleSound);
    btnViewBoard.addEventListener("click", showBoardModal);
    btnReplay.addEventListener("click", startGame);
    btnResultBoard.addEventListener("click", function () {
      hideResultModal();
      showBoardModal();
    });
    btnCloseBoard.addEventListener("click", hideBoardModal);
    btnCloseBoard2.addEventListener("click", hideBoardModal);
    btnResume.addEventListener("click", resumeGame);
    btnCloseResult.addEventListener("click", hideResultModal);

    // 被打榜
    btnViewHits.addEventListener("click", showHitModal);
    btnCloseHit.addEventListener("click", hideHitModal);
    btnCloseHit2.addEventListener("click", hideHitModal);

    hitBoardTabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        hitBoardTab = btn.dataset.tab;
        updateHitTabs();
        renderHitBoard();
      });
    });

    hitModalTabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        hitModalTab = btn.dataset.tab;
        updateHitTabs();
        renderHitModalBoard();
      });
    });

    // 手机唯一主按钮：复用单一 state 路由
    if (btnMain) {
      btnMain.addEventListener("click", function () {
        if (state === STATE.IDLE || state === STATE.GAMEOVER) startGame();
        else if (state === STATE.PLAYING) pauseGame();
        else if (state === STATE.PAUSED) resumeGame();
      });
    }

    // 排行榜 tab：总榜 / 手机榜 / 网页榜
    boardTabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        boardTab = btn.dataset.tab;
        updateBoardTabs();
        focusMyRowAfterRender = true; // 切 tab 渲染完成后定位到我的成绩一次
        if (boardModalScroll) boardModalScroll.scrollTop = 0; // 名单区显式归零，不保存旧 tab scrollTop
        if (boardTab === "total") {
          if (!publicLeaderboardCache10) loadFullBoard();
          else renderFullBoard();
        } else {
          loadFilteredLeaderboard();
        }
      });
    });

    // iOS 防 pinch 手势（仅 game-active 时生效）
    function preventGesture(e) {
      if (document.body.classList.contains("game-active")) e.preventDefault();
    }
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });

    // iOS double-tap zoom 兜底：游戏会话内所有单指 tap 都参与追踪（含按钮/gap），
    // 命中由 pointerdown 完成，touchend 的 preventDefault 不影响计分。
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length > 1) multiTouchActive = true;
    }, { passive: true });

    document.addEventListener("touchend", function (e) {
      if (!document.body.classList.contains("game-active")) {
        lastSingleTap = null;
        multiTouchActive = false;
        return;
      }
      // 还有手指在屏幕上：多指进行中，交给 gesture，不参与 single-tap 判定
      if (e.touches.length > 0) return;
      // 多指交互的收尾：清状态，不计入 double-tap
      if (multiTouchActive) {
        multiTouchActive = false;
        lastSingleTap = null;
        return;
      }
      if (e.changedTouches.length !== 1) return;
      var t = e.changedTouches[0];
      var now = Date.now();
      if (lastSingleTap) {
        var dt = now - lastSingleTap.t;
        var dx = t.clientX - lastSingleTap.x;
        var dy = t.clientY - lastSingleTap.y;
        if (dt <= 300 && (dx * dx + dy * dy) <= 3600) {
          e.preventDefault(); // 阻止 Safari/WKWebView double-tap zoom
          lastSingleTap = null;
          return;
        }
      }
      lastSingleTap = { t: now, x: t.clientX, y: t.clientY };
    }, { passive: false });

    document.addEventListener("touchcancel", function () {
      lastSingleTap = null;
      multiTouchActive = false;
    }, { passive: true });

    // 姓名输入：失焦时规范化（空名保持空，placeholder 显示；业务 fallback 仍为「玩家」）
    playerNameInput.addEventListener("blur", function () {
      if (playerNameInput.disabled) return;
      applyNormalizedName();
    });

    // 玩法说明折叠开关（仅手机端；倒计时/游戏中强制折叠，不允许手动展开）
    if (howtoToggle) {
      howtoToggle.addEventListener("click", function () {
        if (clientType !== "mobile") return;
        if (state === STATE.COUNTDOWN || state === STATE.PLAYING) return;
        setHowtoCollapsed(!howtoCard.classList.contains("collapsed"));
      });
    }

    // 排行榜 / 被打榜弹窗：点击遮罩层不再关闭，只能通过右上角 × 或底部「关闭」按钮关闭。

    board.addEventListener("pointermove", moveHammer);
    board.addEventListener("pointerenter", function () {
      if (state === STATE.PLAYING) {
        showHammer();
        board.classList.add("cursor-hammer");
      }
    });
    board.addEventListener("pointerleave", function () {
      hideHammer();
      board.classList.remove("cursor-hammer");
    });
    board.addEventListener("pointerdown", function (e) {
      if (state !== STATE.PLAYING) return;
      smashHammer();
      global.AudioManager.recoverBgmIfNeeded(); // 若 BGM 曾被拒绝，在真实手势内恢复
      onBoardPointerDown(e);
    });
  }

  function init() {
    global.AudioManager.init();
    buildBoard();
    clearLayout();

    // 设备识别（会话内缓存）：mobile / web
    clientType = detectClientType();
    boardTab = "total";

    // 手机端玩法说明默认折叠；桌面默认展开
    setHowtoCollapsed(clientType === "mobile");

    // 读取 / 创建匿名 player_id（刷新后不变）
    playerId = getOrCreatePlayerId();

    // 读取玩家姓名：空或仅历史 fallback「玩家」时显示空（placeholder 提示）；真实昵称则直接显示。
    var savedName = (loadPlayerName() || "").trim();
    playerNameInput.value = (savedName && savedName !== "玩家") ? savedName : "";

    highscore = loadHighscore();
    roundCharacterHits = emptyRoundHits();
    updateStatsUI();
    updateButtons();
    renderMiniBoard();
    renderHitBoard();
    updateHitTabs();
    preloadAssets();
    bindEvents();

    // 并行加载远端数据，不阻塞游戏初始化
    loadMiniBoard();
    loadFullBoard(); // 预取 TOP10，供开局时冻结“我的排行榜基线”
    loadCharacterHits().then(function () {
      renderHitBoard();
    });
  }

  init();
})(window);
