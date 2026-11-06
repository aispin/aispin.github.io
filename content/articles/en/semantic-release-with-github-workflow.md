---
title: Automating Releases with Semantic-Release and GitHub Actions
description: This article explains how to automate releases using Semantic-Release and GitHub Actions. It covers installing necessary packages, creating a personal access token, configuring release files and GitHub workflows, and testing and triggering the release process.
date: 2024-08-10
tags: [CICD, Semantic-Release, Github Workflow, Github Actions, Automated Release]
lang: en
slug: semantic-release-with-github-workflow
pair: semantic-release-with-github-workflow
author: ZEO AI
---
This article explains how to automate releases using Semantic-Release and GitHub Actions. It covers installing necessary packages, creating a personal access token, configuring release files and GitHub workflows, and testing and triggering the release process.

## Background

In modern software development, continuous integration and continuous deployment (CI/CD) are essential practices to ensure that code changes are automatically tested, integrated, and deployed. However, managing releases manually can be time-consuming and error-prone. This is where automated release tools like Semantic-Release come into play. By integrating Semantic-Release with GitHub Actions, you can automate the entire release process, from versioning to publishing, ensuring consistency and reducing the risk of human error.

## Why Automate Releases?

Automating releases provides several benefits:

- Consistency: Ensures that every release follows the same process and standards.
- Efficiency: Saves time by automating repetitive tasks.
- Accuracy: Reduces the risk of human error in the release process.
- Traceability: Maintains a clear history of changes and releases.

## How to Automate Releases with Semantic-Release and GitHub Actions

### 1, Install semantic-release related packages

```bash
pnpm add -D semantic-release @semantic-release/changelog @semantic-release/git @semantic-release/github @semantic-release/npm
```

### 2, Create a Fine-grained personal access token (AKA `PAT`) in the Github's Developer Settings

- Go to [Github Personal Access Token](https://github.com/settings/tokens)
- Click `Generate new token`
- Select your repo in the `Repository Access` section
- Apply the following Permissions to the `PAT`:
  - Actions - read and write
  - Commit statuses - read and write
  - Contents - read and write
  - Deployments - read and write
  - Issues - read and write

### 3, Add the `PAT` to your Github repository's secrets

- Go to your Github repository
- Click `Settings` -> `Secrets and variables` -> `New repository secret`
- Name the secret `GH_TOKEN` and paste the `PAT` as the value

### 4, Create a `release.config.mjs` file in the root of your project

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

### 5, Create a Github workflow file named `release.yml` in the `.github/workflows` directory

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

### 6, Test the `PAT` and the workflow locally without pushing to the main branch

```bash
GH_TOKEN=your_pat npx semantic-release --dry-run
```

### 7, Push a commit to the main branch to trigger the release

```bash
git add .
git commit -m "chore(release): 0.0.1"
git push
```

That's it! Enjoy the automated release process!

## QA

### Error: Cannot push the version tag to the branch `main` on the remote Git repository with URL `http://x-access-token:[secure]@github.com/xxxx`

If `Step 6` is fine, try the following configuration on you repository:

- Go to your Github repository
- Click `Settings` -> Code and automation `Actions` -> `General`
- In the `Workflow Permissions` section, check the `Read and write permission` option
- Click `Save`

View the [issue](https://github.com/semantic-release/semantic-release/issues/2481#issuecomment-1421429306) for more details.

After that, try to push a commit to the main branch again.
