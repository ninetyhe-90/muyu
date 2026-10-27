# 敲木鱼 · 功德 +1

登录邮箱，敲一下木鱼，积一份功德。纯静态前端（GitHub Pages）+ Supabase 邮箱魔法链接登录与功德存储。

线上地址：https://ninetyhe-90.github.io/muyu/

## 功能

- 点击 / 空格敲木鱼，木鱼声、涟漪、`+1` 飘字、连击提示
- 邮箱魔法链接登录，无需密码
- 功德云端同步：累计功德、今日功德、全站今日功德
- 游客模式：未登录也能敲，功德存本机；登录后自动并入账号
- 移动端适配、减少动效偏好、键盘可操作

## 接自己的 Supabase（5 分钟）

1. 在 [supabase.com](https://supabase.com) 新建项目，进入 **SQL Editor**，把 [`supabase/schema.sql`](supabase/schema.sql) 整段执行。
2. 进入 **Authentication → URL Configuration**：
   - Site URL：`https://ninetyhe-90.github.io/muyu/`
   - Redirect URLs：加入 `https://ninetyhe-90.github.io/muyu/`（本地调试再加 `http://localhost:8080/`）
3. 进入 **Project Settings → API**，复制 `Project URL` 和 `anon public` key。
4. 填入 [`config.js`](config.js)：

```js
window.MUYU_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

5. 提交并推送，等待 GitHub Pages 重新部署。

`anon` key 本来就是公开的，数据由行级安全（RLS）和 `security definer` 函数保护；不要把 `service_role` key 放进前端。

## 本地预览

```bash
python3 -m http.server 8080
```

打开 http://localhost:8080/ 。未填 `config.js` 时自动进入游客模式。

## 部署

仓库已开启 GitHub Pages（`main` 分支根目录）。改完直接 `git push`，约 1 分钟生效。

绑定自有域名时，在仓库 Settings → Pages → Custom domain 填写域名，并按 GitHub 提示配置 DNS。

## 数据表

`public.merit`：每人一行，`total` 累计功德、`today_count` 今日功德，`add_merit(n)` 原子累加（单次上限 500，防误触刷量）。

`public.merit_global`：只读聚合视图，向匿名用户暴露全站总量。

## License

[MIT](LICENSE)
