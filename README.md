# 下回打你 · Bonk You Next!

A playful browser whack-a-mole game with live player leaderboards and a "most bonked" character ranking.

## 简介

- 纯 HTML / CSS / JavaScript，无框架、无构建步骤
- 30 秒打土拨鼠小游戏
- 9 个角色，每局随机分布
- Combo ×2：连续击中得分翻倍
- 公共玩家排行榜（TOP 3 / TOP 10）
- 本轮 / 累计被打榜
- Supabase backend（公共排行榜 + 累计被打统计）
- 无需登录，匿名 player_id 自动生成

## 本地运行

直接用静态服务器打开项目即可，例如：

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

> 项目是纯静态网站，不依赖 Node server / PHP / Python backend / 构建流程。

## Supabase 配置

1. 复制模板：

   ```
   js/supabase-config.example.js
   →
   js/supabase-config.js
   ```

2. 在 `js/supabase-config.js` 中填写你自己的：

   - Project URL
   - Publishable Key

   ```js
   window.BONK_YOU_NEXT_CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabasePublishableKey: "sb_publishable_YOUR_KEY"
   };
   ```

> 只填写 Publishable Key（通常以 `sb_publishable_` 开头）。
> 不要填写 `service_role`、`sb_secret_...`、Database Password 或其他管理员凭据。
