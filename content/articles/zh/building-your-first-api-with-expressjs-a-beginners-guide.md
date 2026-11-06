---
title: 使用 Express.js 构建你的第一个 API：初学者指南
description: 使用 Express.js 构建你的第一个 API 的初学者友好指南
date: 2023-11-02
tags: []
lang: zh
slug: building-your-first-api-with-expressjs-a-beginners-guide
pair: building-your-first-api-with-expressjs-a-beginners-guide
author: ZEO AI
---
> 本文是使用 ChatGPT 创建的，仅作为示例文章

## 什么是 Express.js？

Express.js 是一个简洁灵活的 Node.js Web 应用程序框架，提供了一套强大的功能来开发 Web 和移动应用程序。它能够快速开发基于 Node 的 Web 应用程序，并且由于其简单性和高性能，广泛用于构建 API。

## 第一步：设置环境

在开始之前，请确保您的系统上已安装 Node.js。您可以从 Node.js 官方网站下载安装。

安装完 Node.js 后，您可以初始化您的项目：

```bash
mkdir my-express-api
cd my-express-api
npm init -y
```

这将为您的项目创建一个新的目录并初始化一个新的 Node.js 项目。

## 第二步：安装 Express.js

使用 npm（Node 包管理器）安装 Express.js：

```bash
npm install express --save
# This command installs Express.js and adds it to your project's dependencies.
```

## 第三步：创建你的第一个 Express 服务器

在你的项目目录中创建一个名为 app.js 的文件。这个文件将是你的 API 的入口点。将以下代码添加到 app.js 中：

```js
const express = require('express')

const app = express()
const port = 3000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
```

这段代码创建了一个基本的 Express 服务器，监听在 3000 端口，并对根 URL (/) 的 HTTP GET 请求返回 "Hello World!"。

## 第四步：运行你的 Express 服务器

使用 Node.js 运行你的服务器：

```bash
node app.js
# 在浏览器中访问 http://localhost:3000。您应该看到消息 "Hello World!"。
```

## 第五步：构建一个简单的 API

现在，让我们扩展我们的服务器，使其充当一个简单的 API。例如，让我们创建一个返回用户列表的端点。

将以下代码添加到你的 app.js 文件中：

```javascript
const users = [{ name: 'Alice' }, { name: 'Bob' }]

app.get('/users', (req, res) => {
  res.json(users)
})
```

现在，如果你访问 http://localhost:3000/users，你将看到用户数组的 JSON 表示。

## 第六步：测试你的 API

测试你的 API 是很重要的。你可以使用 Postman 或 curl 等工具来测试你的端点。

## 第七步：下一步

从这里开始，你可以开始构建更复杂的 API。考虑以下内容：

- 实现 CRUD（创建、读取、更新、删除）操作。
- 将你的 API 连接到数据库。
- 添加身份验证和授权。
- 使用路由和控制器组织你的代码。

## 结论

Express.js 简化了在 Node.js 中构建 API 的过程。对于想要深入后端开发的开发者来说，它是一个很好的起点。凭借其极简主义的方法，你可以自由地按照自己的意愿构建应用程序，使 Express.js 成为你开发工具包中的宝贵工具。
