/* ============================================================
 * Supabase 公共排行榜模块（V1，纯 fetch + REST RPC）
 *
 * 只负责三件事：
 *   getPublicLeaderboard(limit)
 *   getCharacterHitLeaderboard()
 *   submitGameScore(payload)
 *
 * 安全约定：
 *   前端只使用 Publishable Key（anon），绝不包含 service_role /
 *   sb_secret / database password 等管理员凭证。
 * ============================================================ */
(function (global) {
  "use strict";

  /* ============================================================
   * 【配置】—— 从 window.BONK_YOU_NEXT_CONFIG 读取（见 js/supabase-config.js）。
   * 不再硬编码任何真实 URL / Key；配置为空时走安全降级逻辑。
   * ============================================================ */
  var cfg = (global.BONK_YOU_NEXT_CONFIG) || {};
  var SUPABASE_URL = cfg.supabaseUrl || "";
  var SUPABASE_PUBLISHABLE_KEY = cfg.supabasePublishableKey || "";

  var FETCH_TIMEOUT_MS = 20000;

  function isConfigured() {
    return !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;
  }

  function buildHeaders() {
    return {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    };
  }

  /* 带超时的 fetch（网络失败不抛出未处理异常，交给调用方 catch）。 */
  function postJson(url, body) {
    return new Promise(function (resolve, reject) {
      var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = null;
      if (controller) {
        timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
      }
      fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body == null ? {} : body),
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          reject(new Error("RPC HTTP " + res.status));
          return;
        }
        return res.json();
      }).then(function (data) {
        if (timer) clearTimeout(timer);
        resolve(data);
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  /* Supabase RPC 返回表（SETOF）时是数组，返回 json/jsonb 时可能是对象，
     这里统一成「数组」便于渲染。 */
  function asArray(data) {
    if (data == null) return [];
    if (Array.isArray(data)) return data;
    return [data];
  }

  /* 提交结果统一成单个对象。 */
  function asObject(data) {
    if (data == null) return data;
    if (Array.isArray(data)) return data[0] || null;
    return data;
  }

  /* ============ 获取公共玩家排行榜（同一 player_id 只占一名，取历史最佳） ============ */
  function getPublicLeaderboard(limit) {
    return postJson(SUPABASE_URL + "/rest/v1/rpc/get_public_leaderboard", { p_limit: limit })
      .then(asArray);
  }

  /* ============ 获取 9 只角色累计被打榜 ============ */
  function getCharacterHitLeaderboard() {
    return postJson(SUPABASE_URL + "/rest/v1/rpc/get_character_hit_leaderboard", null)
      .then(asArray);
  }

  /* ============ 提交一局完整成绩（round_id 幂等） ============ */
  function submitGameScore(payload) {
    return postJson(SUPABASE_URL + "/rest/v1/rpc/submit_game_score", payload)
      .then(asObject);
  }

  global.Supabase = {
    isConfigured: isConfigured,
    getPublicLeaderboard: getPublicLeaderboard,
    getCharacterHitLeaderboard: getCharacterHitLeaderboard,
    submitGameScore: submitGameScore
  };
})(window);
