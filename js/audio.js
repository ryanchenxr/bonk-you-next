/* ============================================================
 * 音频管理
 * - 背景音乐：HTMLAudio（webm/Opus，循环播放，preload=auto）
 * - 击中音效：Web Audio（decode 一次 + BufferSource 复播），
 *   不支持/解码失败时回退到 HTMLAudio pool
 * ============================================================ */
(function (global) {
  "use strict";

  var HIT_POOL_SIZE = 6;
  var HIT_URL = "assets/audio/hit.wav";
  var BGM_URL = "assets/audio/bgmusic-37s.webm";

  var enabled = true;

  // BGM（HTMLAudio）
  var bgm = null;
  var bgmShouldPlay = false; // 本局是否应当播放 BGM
  var bgmLoadedOnce = false; // 是否已主动 load 过 BGM

  // Hit（Web Audio + HTMLAudio fallback）
  var audioCtx = null;
  var hitBuffer = null;
  var hitWebAudioReady = false;
  var hitFetching = false;
  var hitPool = [];
  var poolIndex = 0;

  function logBgmError(e) {
    var err = e || {};
    try {
      if (global.console && global.console.warn) {
        global.console.warn("[Audio] BGM play failed", err.name || "", err.message || "");
      }
    } catch (_) { /* ignore */ }
  }

  function init() {
    bgm = new Audio(BGM_URL);
    bgm.loop = true;
    // bgmusic 已经是压缩后的 webm，改为 auto 预加载，降低第一次播放延迟
    bgm.preload = "auto";
    bgm.volume = 0.6;

    for (var i = 0; i < HIT_POOL_SIZE; i++) {
      var a = new Audio(HIT_URL);
      a.preload = "auto";
      a.volume = 0.85;
      hitPool.push(a);
    }
  }

  function ensureHitWebAudio() {
    if (hitWebAudioReady) return;
    if (!hitBuffer && !hitFetching) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return; // 不支持 Web Audio，走 HTMLAudio fallback
      if (!audioCtx) {
        try { audioCtx = new AC(); } catch (e) { audioCtx = null; return; }
      }
      hitFetching = true;
      fetch(HIT_URL)
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          if (!audioCtx) throw new Error("no AudioContext");
          return audioCtx.decodeAudioData(buf);
        })
        .then(function (decoded) {
          hitBuffer = decoded;
          hitWebAudioReady = true;
          hitFetching = false;
        })
        .catch(function () {
          hitBuffer = null;
          hitWebAudioReady = false;
          hitFetching = false; // 解码失败继续走 HTMLAudio fallback
        });
    }
    // 在真实用户手势内解锁 AudioContext
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () {});
    }
  }

  function prepareForGame() {
    if (bgm && !bgmLoadedOnce) {
      bgmLoadedOnce = true;
      try { bgm.load(); } catch (e) { /* ignore */ }
    }
    ensureHitWebAudio();
  }

  function isBgmPlaying() {
    try { return !!(bgm && !bgm.paused && !bgm.ended); } catch (e) { return false; }
  }

  function playBgm() {
    bgmShouldPlay = true;
    if (!enabled) return;
    try {
      bgm.currentTime = 0;
      var p = bgm.play();
      if (p && p.catch) p.catch(logBgmError);
    } catch (e) { logBgmError(e); }
  }

  function resumeBgm() {
    bgmShouldPlay = true;
    if (!enabled) return;
    try {
      var p = bgm.play();
      if (p && p.catch) p.catch(logBgmError);
    } catch (e) { logBgmError(e); }
  }

  function pauseBgm() {
    bgmShouldPlay = false;
    try { bgm.pause(); } catch (e) { /* ignore */ }
  }

  function stopBgm() {
    bgmShouldPlay = false;
    try {
      bgm.pause();
      bgm.currentTime = 0;
    } catch (e) { /* ignore */ }
  }

  function recoverBgmIfNeeded() {
    if (!enabled || !bgmShouldPlay) return;
    if (isBgmPlaying()) return;
    // 在真实用户手势内再次尝试恢复 BGM（不清 currentTime）
    try {
      var p = bgm.play();
      if (p && p.catch) p.catch(logBgmError);
    } catch (e) { logBgmError(e); }
  }

  function playHit() {
    if (!enabled) return;
    if (hitWebAudioReady && audioCtx && hitBuffer) {
      try {
        if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
        var src = audioCtx.createBufferSource();
        src.buffer = hitBuffer;
        var gain = audioCtx.createGain();
        gain.gain.value = 0.85;
        src.connect(gain);
        gain.connect(audioCtx.destination);
        src.start(0);
        return;
      } catch (e) {
        // 落到 HTMLAudio fallback
      }
    }
    var a = hitPool[poolIndex % HIT_POOL_SIZE];
    poolIndex = (poolIndex + 1) % HIT_POOL_SIZE;
    try {
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function setEnabled(value) {
    enabled = !!value;
    if (!enabled) {
      // 只暂停实际媒体，不清 bgmShouldPlay（保留本局“应播放”意图）
      try { bgm.pause(); } catch (e) { /* ignore */ }
    } else if (bgmShouldPlay && !isBgmPlaying()) {
      // 重新打开声音：若本局应该播放但实际没播，则从当前位置恢复（不清 currentTime）
      try {
        var p = bgm.play();
        if (p && p.catch) p.catch(logBgmError);
      } catch (e) { logBgmError(e); }
    }
  }

  function isEnabled() {
    return enabled;
  }

  global.AudioManager = {
    init: init,
    prepareForGame: prepareForGame,
    playBgm: playBgm,
    resumeBgm: resumeBgm,
    pauseBgm: pauseBgm,
    stopBgm: stopBgm,
    playHit: playHit,
    recoverBgmIfNeeded: recoverBgmIfNeeded,
    setEnabled: setEnabled,
    isEnabled: isEnabled
  };
})(window);
