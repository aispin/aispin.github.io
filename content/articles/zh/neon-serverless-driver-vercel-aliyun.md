---
title: Neon serverless-driver 结合 Vercel、阿里云实战指南
description: 本指南将介绍如何利用 Neon（Serverless PostgreSQL）、Vercel（用于前端和 Serverless Functions）以及 阿里云函数计算（FC）（作为另一种 Serverless 函数部署选择）来构建全栈应用。
date: 2024-08-26
tags: [Serverless, 函数计算, Neon, PostgreSQL]
lang: zh
slug: neon-serverless-driver-vercel-aliyun
pair: neon-serverless-driver-vercel-aliyun
author: Livin AI
---
## 概述

本指南将介绍如何利用 **Neon**（Serverless PostgreSQL）、**Vercel**（用于前端和 Serverless Functions）以及 **阿里云函数计算（FC）**（作为另一种 Serverless 函数部署选择）来构建全栈应用。我们将探讨 Neon serverless-driver 的使用场景、在不同平台部署 Serverless API 的实践，以及如何安全地连接数据库。

**适合阅读人群**：
*   前端开发者（如使用 Vue、React）
*   全栈开发者
*   对 Serverless 架构和现代 Web 开发感兴趣的人

**核心工具与服务**：
*   **Neon**: Serverless PostgreSQL 数据库，提供无服务器化的数据库体验。
*   **Neon serverless-driver (`@neondatabase/serverless`)**: 为无服务器环境优化的 PostgreSQL 驱动，尤其适合冷启动频繁的场景:cite[2]。
*   **Vercel**: 用于部署前端静态资源和 Serverless Functions（API Routes）:cite[2]:cite[6]。
*   **阿里云函数计算 (FC)**: 事件驱动的全托管 Serverless 计算服务，可用于运行后端代码和 API:cite[3]:cite[7]。

## 为什么选择这种组合？

*   **性能与优化**: Neon serverless-driver 通过 WebSocket 等协议减少传统 TCP 连接开销，特别适合 Vercel 和阿里云 FC 这种冷启动敏感的无服务器环境。
*   **开发体验**: Vercel 提供极佳的前端部署和 Git 集成体验:cite[6]，阿里云 FC 与阿里云其他服务集成紧密:cite[3]。
*   **灵活性**: 前端和轻量 API 可部署于 Vercel，而对国内用户更友好或有特定需求的 API 可部署于阿里云 FC。
*   **成本效益**: 这些服务大多提供慷慨的免费额度，适合个人项目和小型应用。

## 实战：在 Vercel API Route 中使用 Neon

Vercel 允许你在 `/api` 目录下创建 Serverless Functions:cite[2]:cite[9]。这些函数可以安全地与环境变量（如数据库连接字符串）交互。

### 步骤 1：创建 Neon 数据库并获取连接字符串

1.  访问 [Neon](https://neon.tech/) 并注册账号。
2.  创建一个新项目和新数据库。
3.  在项目的 "Connection Details" 中获取数据库连接字符串（`DATABASE_URL`），其格式类似于：
    ```
    postgres://user:password@ep-cool-darkness-123456.us-east-2.aws.neon.tech/dbname?sslmode=require
    ```

### 步骤 2：在 Vercel 项目中设置环境变量

**切勿将 `DATABASE_URL` 直接硬编码在前端代码或公开的 API 路由中**，否则会导致严重的安全风险。

1.  在你的 Vercel 项目 Dashboard (或使用 Vercel CLI) 中，找到项目的 "Settings" -> "Environment Variables"。
2.  添加一个环境变量，例如：
    *   `NAME`: `DATABASE_URL`
    *   `VALUE`: 你的 Neon 连接字符串
3.  （可选）如果你计划本地开发，在项目根目录创建 `.env.local` 文件并同样添加该环境变量（确保该文件已在 `.gitignore` 中）。

### 步骤 3：创建 Vercel API Route 并查询 Neon

假设你有一个 Next.js 项目（其他框架类似）。

1.  **安装驱动**：
    ```bash
    npm install @neondatabase/serverless
    ```

2.  **创建 API 路由**：在 `pages/api` 或 `app/api` 目录下创建文件，例如 `pages/api/users.js`：

    ```javascript
    // pages/api/users.js
    import { neon } from '@neondatabase/serverless'

    /**
     * @param {import('next').NextApiRequest} req
     * @param {import('next').NextApiResponse} res
     */
    export default async function handler(req, res) {
      // 从环境变量读取连接字符串
      const databaseUrl = process.env.DATABASE_URL

      if (!databaseUrl) {
        return res.status(500).json({ error: 'DATABASE_URL environment variable is not set.' })
      }

      // 初始化 Neon client
      const sql = neon(databaseUrl)

      try {
        // 执行查询
        const users = await sql`SELECT id, name, email FROM users LIMIT 10`
        // 返回 JSON 响应
        res.status(200).json({ users })
      }
      catch (error) {
        console.error('Database error:', error)
        res.status(500).json({ error: 'Internal Server Error' })
      }
    }

    // 配置运行时环境（可选，但推荐用于边缘环境）
    export const config = {
      runtime: 'edge', // 使用 Vercel 的边缘运行时以获得更佳性能
    }
    ```

3.  **部署到 Vercel**：将代码推送到你的 Git 仓库，Vercel 会自动部署。你的 API 端点将是 `https://your-app.vercel.app/api/users`。

## 实战：在阿里云函数计算中使用 Neon

阿里云函数计算 (FC) 是另一个部署 Serverless 函数的强大平台:cite[3]:cite[7]。

### 步骤 1：创建函数并配置环境变量

1.  **创建服务与函数**：登录阿里云控制台，进入函数计算。首先创建一个服务（用于逻辑分组和环境隔离），然后在该服务下创建一个 HTTP 函数:cite[3]。
2.  **配置环境变量**：在函数配置中，添加环境变量 `DATABASE_URL`，值为你的 Neon 连接字符串。

### 步骤 2：编写函数代码

你可以使用 **Serverless Devs** 工具进行本地开发和部署:cite[3]。

1.  **初始化项目**（如果尚未）：
    ```bash
    s init start-fc-http-nodejs -d my-neon-app
    cd my-neon-app
    ```

2.  **安装依赖**和**编写代码** (`index.js`)：
    ```javascript
    // index.js
    const { neon } = require('@neondatabase/serverless')

    exports.handler = async (req, res) => {
      // 从环境变量获取连接字符串
      const databaseUrl = process.env.DATABASE_URL

      if (!databaseUrl) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'DATABASE_URL environment variable is not set.' }),
        }
      }

      const sql = neon(databaseUrl)

      try {
        const users = await sql`SELECT id, name, email FROM users LIMIT 10`
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*', // 根据需要配置 CORS
          },
          body: JSON.stringify({ users }),
        }
      }
      catch (error) {
        console.error('Database error:', error)
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Internal Server Error' }),
        }
      }
    }
    ```
    更新 `package.json` 中的 `dependencies` 以包含 `@neondatabase/serverless`。

3.  **部署到阿里云 FC**：
    ```bash
    s deploy
    ```

4.  **触发函数**：部署成功后，你会获得一个 HTTP 触发器 URL，用于访问你的函数。

## 安全性与最佳实践

1.  **永远保护凭证**：
    *   **绝对不要**在前端代码或公开的客户端中嵌入数据库连接字符串。
    *   始终通过环境变量在 Serverless 函数中传递敏感信息。
    *   利用 Vercel 和阿里云提供的安全环境变量配置功能。

2.  **连接管理**：
    *   Neon serverless-driver 旨在高效处理无服务器环境的连接。避免在函数中创建传统的长时连接池。
    *   考虑启用 Neon 的 **连接池**（Connection Pooling）功能，它可以更好地处理大量并发连接，与 serverless-driver 搭配使用效果更佳。

3.  **网络与性能**：
    *   你的 Neon 数据库、Vercel 函数和阿里云函数可能分布在不同的地理区域。尽量让它们的地域靠近，以减少网络延迟。
    *   注意 Vercel 免费计划的 Serverless Function 执行超时限制（Hobby 计划为 5秒）:cite[2]:cite[9]，优化数据库查询以避免超时。

4.  **监控与日志**：
    *   **Vercel**: 使用 `vercel logs` 命令行或 Dashboard 查看函数日志:cite[6]。
    *   **阿里云 FC**: 在控制台查看函数执行的日志和指标:cite[3]:cite[7]。
    *   **Neon**: 在 Neon Dashboard 中监控数据库查询性能和资源使用情况。

## 总结与决策

| 场景/需求                                                                 | 推荐部署平台             | 注意事项                                                                                                |
| :---------------------------------------------------------------------- | :------------------- | :---------------------------------------------------------------------------------------------------- |
| **项目主体用户在国内，要求 API 访问低延迟**                                     | **阿里云函数计算 (FC)**   | 需备案域名（如果提供 Web 服务），利用阿里云国内生态。                                                                 |
| **项目面向全球用户，或前端与 API 紧密耦合，追求极致的开发部署体验**                         | **Vercel API Routes** | 注意免费计划的限制（如超时时间、出口流量）:cite[6]。Vercel 对 `api` 目录下的路由有内置支持:cite[2]:cite[9]。                 |
| **需要同时满足国内外用户访问，或将不同功能的 API 部署到不同平台**                           | **混合部署 (Vercel + FC)** | 前端可放在 Vercel，部分 API 在 Vercel，另一部分在 FC。需统一管理环境变量和 CORS 配置。                                           |
| **数据库操作非常简单，且冷启动速度是最高优先级**                                   | **Neon serverless-driver** | 其协议优化有助于减少连接建立时间。                                                                                    |
| **需要执行复杂事务或长时间运行的数据库操作**                                     | 需仔细设计                 | Vercel 免费计划函数超时时间较短（5秒）:cite[2]:cite[9]，阿里云 FC 默认超时时间可配置更长:cite[3]。可能需要拆解任务或选择其他后台作业方案。 |

**核心原则**：
*   **前端静态资源**、**与前端强相关的轻量 API** -> **Vercel** 是不错的选择。
*   **数据密集型 API**、**主要服务国内用户的 API**、**需要与阿里云其他服务深度集成的后端逻辑** -> **阿里云函数计算**值得考虑。
*   **数据库连接与操作** -> 无论在哪个平台，**Neon serverless-driver** 都能为无服务器环境提供优化的体验。

通过结合 Neon、Vercel 和阿里云函数计算的优势，你可以构建出高性能、可扩展且成本效益高的现代全栈应用程序。始终将安全性放在首位，并充分利用各平台提供的监控工具来优化你的应用。
