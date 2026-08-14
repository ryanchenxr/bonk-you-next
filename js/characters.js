/* ============================================================
 * 角色配置
 * 人物与 PNG 文件必须一一对应，绝不随机错配。
 * 文件名以 assets/characters/ 目录下真实文件为准。
 * ============================================================ */
(function (global) {
  "use strict";

  // displayOffsetY：角色出洞后的额外纵向微调（单位 %，相对土拨鼠自身高度）。
  // 负值 = 上移（露出更多），正值 = 下移（露出更少）。默认 0。
  // 仅当某张 PNG 因透明画布/构图不同导致出洞高度差异明显时才单独调整。
  //
  // id 即 Supabase 正式 character_id，必须严格固定，绝不因每局洞口随机而改变。
  var CHARACTERS = [
    { id: "chen-xiaren", name: "陈虾仁", image: "assets/characters/陈虾仁.png", displayOffsetY: 0 },
    { id: "ximai",       name: "喜脉",   image: "assets/characters/喜脉.png",   displayOffsetY: 0 },
    { id: "xiaomo",      name: "肖沫",   image: "assets/characters/肖沫.png",   displayOffsetY: 0 },
    { id: "gumu",        name: "谷木",   image: "assets/characters/谷木.png",   displayOffsetY: 0 },
    { id: "lili",        name: "粒粒",   image: "assets/characters/粒粒.png",   displayOffsetY: 0 },
    { id: "cheche",      name: "澈澈",   image: "assets/characters/澈澈.png",   displayOffsetY: 0 },
    { id: "peiqi",       name: "佩奇",   image: "assets/characters/佩奇.png",   displayOffsetY: 0 },
    { id: "ben-ge",      name: "Ben哥",  image: "assets/characters/Ben哥.png",  displayOffsetY: 0 },
    { id: "bobo",        name: "波波",   image: "assets/characters/波波.png",   displayOffsetY: 0 }
  ];

  global.CHARACTERS = CHARACTERS;
})(window);
