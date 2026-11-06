# 牛马鼓励器 1.0.1 验证记录

2026-11-06，Windows x64。

- `npm test` 通过 52 项测试，覆盖计薪、工作日、状态迁移、桌面请求的窗口身份、保存回执和错误处理。
- `npm run build` 完成 TypeScript 检查和 Vite 生产构建，electron-builder 生成 Windows x64 便携 EXE。
- `npm run test:ui` 通过 4 项浏览器测试，含保存失败后保留填写内容、显示具体原因并重试成功。
- `node scripts/verify-layout.mjs` 检查 390、768、880、1024、1240 和 1440 像素宽布局，未出现横向溢出。另检查了设置和浮窗预览。
- `node scripts/smoke-packaged-bridge.mjs --transport-only <app.asar 路径>` 对照两个发行包。脚本运行打包的 preload 和主进程，模拟窗口及 IPC 并使用临时数据目录。模拟同一原生窗口有不同的 JavaScript 引用时，1.0.0 在 `getState` 被拒；1.0.1 正常读取状态，写入并在重新创建主进程后读回日薪和上下班时间，处理浮窗显示、隐私联动和返回主窗。子框架、其他窗口及无效工资均被拒绝。
- 从最终可执行文件中提取 `resources/app.asar`，其 SHA-256 与通过上述五组验收的 ASAR 一致。交付 ZIP 中的 EXE 也已与原文件逐哈希核对。
- 受控测试环境的 Windows AppContainer 目录权限使 Electron 在创建原生窗口前中止，所以桌面上的置顶、原生拖动和系统托盘尚待普通 Windows 桌面验证。应用保留了 Electron 沙箱。此便携包未进行代码签名。本次没有生成或测试 macOS 安装包。
