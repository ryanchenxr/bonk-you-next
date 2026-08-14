/* ============================================================
 * 音频管理
 * - 背景音乐：循环播放
 * - 击中音效：使用 Audio Pool，支持短时间连续触发
 * ============================================================ */
(function (global) {
  "use strict";

  var HIT_POOL_SIZE = 6;
  var bgm = null;
  var hitPool = [];
  var poolIndex = 0;
  var enabled = true;

  function init() {
    bgm = new Audio("assets/audio/bgmusic-35s.webm");
    bgm.loop = true;
    // 背景音乐体积大（WAV），不要随页面自动预加载，避免每次打开页面都完整下载几 MB。
    // 改为 preload="none"：真正开始游戏 playBgm() 时才按需加载。
    bgm.preload = "none";
    bgm.volume = 0.6;

    for (var i = 0; i < HIT_POOL_SIZE; i++) {
      var a = new Audio("assets/audio/hit.wav");
      a.preload = "auto";
      a.volume = 0.85;
      hitPool.push(a);
    }
  }

  function playBgm() {
    if (!enabled) return;
    try {
      bgm.currentTime = 0;
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function resumeBgm() {
    if (!enabled) return;
    try {
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function pauseBgm() {
    try { bgm.pause(); } catch (e) { /* ignore */ }
  }

  function stopBgm() {
    try {
      bgm.pause();
      bgm.currentTime = 0;
    } catch (e) { /* ignore */ }
  }

  function playHit() {
    if (!enabled) return;
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
      pauseBgm();
    }
  }

  function isEnabled() {
    return enabled;
  }

  global.AudioManager = {
    init: init,
    playBgm: playBgm,
    resumeBgm: resumeBgm,
    pauseBgm: pauseBgm,
    stopBgm: stopBgm,
    playHit: playHit,
    setEnabled: setEnabled,
    isEnabled: isEnabled
  };
})(window);
