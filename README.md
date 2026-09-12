# 缩微胶片接卷核验台

缩微胶片数字化时，相邻两卷常因换卷而重复拍摄数帧。本工具是一个**纯前端**核验台：
操作员分别粘贴左卷（先拍摄）与右卷（后拍摄）按走片顺序记录的片边帧码，应用自动寻找
两卷间最长的完全相同重叠段，给出唯一接缝，并明确指出哪些重复帧被安全移除。

## 帧码规则

- 每行必须是 **两个大写字母后接六位数字**（例如 `AB123456`）。
- 读取时去除每行首尾空白，但**不改写内容**（小写、错位等一律判为格式非法，不做自动修正）。
- 同一卷内不允许出现重复帧码。

## 接卷判据

- 寻找「左卷后缀」与「右卷前缀」**完全相同**的最长连续段。
- 重叠长度 **至少 3 帧** 才允许接卷；存在多个可行长度时只采用最长者。
- 接卷结果中重叠帧只保留一份（剔除右卷前缀中的重复帧）。
- 以下情况一律定位原因、且不产生任何接卷结果：
  - 任一行格式非法（报告侧别与行号）；
  - 单卷内出现重复帧码（报告帧码与两处行号）；
  - 最长重叠不足 3 帧；
  - 仅将右卷倒序后才能相接（提示右卷可能未按走片顺序记录）。
- 输入逐键即时重新核验：修正输入后立即得到唯一的新接缝，不会残留旧结果。

## 界面

- 顶部双栏粘贴区（左卷 / 右卷）。
- 中部**双栏逐行对位**视图，重叠区高亮，便于逐行核对。
- 底部展示最终帧序列（含接缝标记）、接缝两侧帧码与剔除数量。

## 技术栈

TypeScript + React + Vite；Vitest 固定匹配判据（单元测试）；
Playwright 覆盖「粘贴 → 对位 → 结果 / 报错 → 修正 → 新接缝」的完整流程。

## 本地开发

```bash
npm install
npm run dev        # 启动开发服务器
npm run test       # Vitest：匹配判据单元测试
npm run e2e        # Playwright：端到端流程（自动构建并启动 preview）
npm run verify     # 一次性验收：构建 + 单元测试 + 端到端测试
```

## Docker 发布

```bash
# 启动 Web 服务，宿主端口由 WEB_PORT 覆盖（默认 8080）
WEB_PORT=9000 docker compose up --build web

# 一次性验收服务：在容器内运行完整验收（构建 + Vitest + Playwright），结束后退出
docker compose run --rm verify
# 或
docker compose up --build --exit-code-from verify verify
```

## 目录结构

```
src/lib/splice.ts        匹配与校验核心（解析、最长重叠、接缝、对位数据）
src/lib/splice.test.ts   Vitest：固定匹配判据
src/App.tsx              交互界面（粘贴、对位高亮、结果与错误定位）
e2e/splice.spec.ts       Playwright：粘贴到结果的完整流程
Dockerfile               多阶段：verify（验收）/ web（nginx 静态发布）
docker-compose.yml       web 服务（WEB_PORT 覆盖宿主端口）+ verify 一次性验收服务
```
