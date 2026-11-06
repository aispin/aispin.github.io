---
title: 使用 Semantic-Release 和 Github Workflow 实现自动化版本发布
description: 本文介绍了如何使用 Semantic-Release 和 GitHub Actions 实现自动化版本发布，包括安装相关包、创建个人访问令牌、配置发布文件和 GitHub 工作流，以及测试和触发发布过程的详细步骤。
date: 2024-08-10
tags: [CICD, Semantic-Release, Github Workflow, Github Actions, 自动化发布]
lang: zh
slug: semantic-release-with-github-workflow
pair: semantic-release-with-github-workflow
author: ZEO AI
---
本文介绍了如何使用 Semantic-Release 和 GitHub Actions 实现自动化版本发布，包括安装相关包、创建个人访问令牌、配置发布文件和 GitHub 工作流，以及测试和触发发布过程的详细步骤。

## 1, 安装 semantic-release 相关依赖

```bash
pnpm add -D semantic-release @semantic-release/changelog @semantic-release/git @semantic-release/github @semantic-release/npm
```

## 2, 创建一个 Github 的私人 TOKEN (下面简称 `PAT`)

- 打开 [Github Personal Access Token](https://github.com/settings/tokens) 页面
- 点击 `Generate new token`
- 在 `Repository Access` 的地方，选中你的仓库
- 给 `PAT` 授权如下:
  - Actions - read and write
  - Commit statuses - read and write
  - Contents - read and write
  - Deployments - read and write
  - Issues - read and write

注意：记得保存 `PAT`，因为你只能看到一次！

## 3, 在 Github 仓库中添加 `PAT`

- 打开 Github 仓库的首页
- 点击 `Settings` -> `Secrets and variables` -> `New repository secret`
- 输入 TOKEN 的名称为 `GH_TOKEN`， 粘贴 `PAT` 到值的地方

## 4, 在项目根目录下创建 `release.config.mjs`

```ts
const config = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    '@semantic-release/github',
    '@semantic-release/npm',
    '@semantic-release/git',
  ],
}

export default config
```

## 5, 在 `.github/workflows` 目录下创建一个名为 `release.yml` 的工作流配置文件

```yml
name: Semantic Release

on:
  push:
    branches:
      - main

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: lts/*

      - name: Install pnpm
        uses: pnpm/action-setup@v4

      - name: Install dependencies
        run: pnpm install

      - name: Run semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GH_TOKEN }}
        run: npx semantic-release
```

## 6, 本地测试下 `PAT` 和 `Semantic Release` 工作流是否配置正确

```bash
GH_TOKEN=your_pat npx semantic-release --dry-run
```

## 7, 尝试提交一个 commit 到 main 分支触发自动版本发布

```bash
git add .
git commit -m "chore(release): 0.0.1"
git push
```

## 常见问题

### 错误: Cannot push the version tag to the branch `main` on the remote Git repository with URL `http://x-access-token:[secure]@github.com/xxxx`

如果 `步骤 6` 没报错, 请做以下额外的设置:

- 打开 Github 仓库的首页
- 点击 `Settings` -> Code and automation `Actions` -> `General`
- 在 `Workflow Permissions` 的地方, 勾上 `Read and write permission` 选项
- 点击 `Save`

关于这个报错，可以到 [issue](https://github.com/semantic-release/semantic-release/issues/2481#issuecomment-1421429306) 查看更多相关信息。
