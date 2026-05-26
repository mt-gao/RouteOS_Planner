# RouteOS — 多人接送路线调度台

多人出行路线规划工具：输入终点、乘客和司机，自动计算最优接人顺序、集合点和路线方案。

## 功能

- **路线规划** — 基于高德距离矩阵，自动计算最优接人顺序与驾车路线
- **多司机/集合点** — 支持多司机分配、集合点组合，自动计算集合方式（公共交通 vs 打车）
- **AI 智能规划** — 用 DeepSeek 分析行程需求，自动生成并比较多种方案
- **AI 对话调度** — 对话式调整行程，AI 直接修改清单并同步路线
- **高德地图可视化** — 在地图上展示路线、点位，支持地址搜索与自动补全
- **路线分享** — 一键复制可读性强的路线摘要，方便发微信通知成员

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | TypeScript, Vite, 高德地图 JS API |
| API 网关 | Vercel Functions |
| AI | DeepSeek API |
| 地理/路线 | 高德 REST API |
| 托管 | Vercel (前端 + API) |

## 本地开发

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入高德和 DeepSeek 密钥

# 启动开发服务器（前端 + 本地 API）
npm run dev

# 或者只用前端（需要线上 Vercel API 可用）
npm run dev:client
```

### 环境变量

参考 `.env.example`，需要配置：

| 变量 | 说明 |
| --- | --- |
| `AMAP_KEY` | 高德 REST API 密钥 |
| `AMAP_JS_KEY` | 高德 JS API 密钥 |
| `AMAP_SECURITY_JS_CODE` | 高德安全密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |

## 部署

### Vercel 前端 + API

```bash
# Vercel 生产部署
npm run deploy
```

代码推送至 GitHub master 分支后，Vercel 会自动构建部署。`/api/*` 由 Vercel Functions 处理，不再转发到 Cloudflare Worker。

### Cloudflare Worker（可选备份）

```bash
npm run deploy:cf
```

## 许可证

MIT
