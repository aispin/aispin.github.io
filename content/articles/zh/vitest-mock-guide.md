---
title: Vitest 模拟第三方模块指南
description: "本指南将介绍如何利用 Vitest 模拟（mock）第三方模块。建议在 `cursor` 等编辑器中将本文添加为 AI 编程的引用文档。"
date: 2025-08-26
tags: [Vitest, Mock, Unit Test]
lang: zh
slug: vitest-mock-guide
pair: vitest-mock-guide
author: Livin AI
---
## 核心概念与 API

在 Vitest 中，`vi.mock()` 是模拟模块的核心 API。调用 `vi.mock` 后，Vitest 会**自动提升**该调用到文件的顶部，因此它会所有导入之前执行。

## 基本使用方法

### 1. 模拟整个模块

```javascript
import axios from 'axios'
// tests/math.test.js
import { vi } from 'vitest'
import { add } from './math'

// 模拟 axios 模块
vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(() => Promise.resolve({ data: 'mocked data' })),
      post: vi.fn(() => Promise.resolve({ data: 'created' }))
    }
  }
})

test('should mock axios get', async () => {
  const result = await axios.get('https://api.example.com/data')
  expect(result.data).toBe('mocked data')
  expect(axios.get).toHaveBeenCalledWith('https://api.example.com/data')
})
```

### 2. 使用 `vi.spyOn` 监听特定方法

```javascript
import * as axios from 'axios'
// tests/math.test.js
import { vi } from 'vitest'

// 监听 axios 的 get 方法并模拟其实现
vi.spyOn(axios, 'get').mockImplementation(() => Promise.resolve({ data: 'spied data' }))

test('should spy on axios get', async () => {
  const result = await axios.get('https://api.example.com/data')
  expect(result.data).toBe('spied data')
})
```

### 3. 使用 `__mocks__` 文件夹

**文件结构示例：**
```
your-project/
├── __mocks__/
│   └── axios.js      # 模拟模块
├── node_modules/
├── src/
│   └── app.js        # 业务代码
└── tests/
    └── app.test.js   # 测试文件
```

**在 `__mocks__/axios.js` 中：**
```javascript
// __mocks__/axios.js
export default {
  get: vi.fn(() => Promise.resolve({ data: 'mocked from __mocks__' })),
  post: vi.fn(() => Promise.resolve({ data: 'post mocked' }))
}
```

**在测试文件中：**
```javascript
import axios from 'axios'
// tests/app.test.js
import { vi } from 'vitest'

// 告诉 Vitest 使用 __mocks__ 中的模拟模块
vi.mock('axios') // 会自动找到 __mocks__/axios.js

test('should use mock from __mocks__ folder', async () => {
  const result = await axios.get('https://api.example.com/data')
  expect(result.data).toBe('mocked from __mocks__')
})
```

### 4. 部分模拟（保留原始实现）

```javascript
import axios from 'axios'
// tests/math.test.js
import { vi } from 'vitest'

vi.mock('axios', async () => {
  const actual = await vi.importActual('axios') // 获取原始模块
  return {
    ...actual,
    get: vi.fn(() => Promise.resolve({ data: 'partially mocked' })) // 只覆盖 get 方法
  }
})

test('should partially mock axios', async () => {
  const result = await axios.get('https://api.example.com/data')
  expect(result.data).toBe('partially mocked')
  // axios.post 等其他方法仍保持原始行为
})
```

## 注意事项与最佳实践

### 1. 提升（Hoisting）行为处理

```javascript
import axios from 'axios'
import { vi } from 'vitest'

const myMock = vi.hoisted(() => vi.fn()) // 使用 hoisted 定义变量
vi.mock('axios', () => ({ get: myMock })) // 然后在 mock 中引用
```

### 2. 模拟默认导出

```javascript
vi.mock('some-default-export-library', () => {
  return {
    default: { // 模拟默认导出
      someMethod: vi.fn()
    }
  }
})
```

### 3. 类型安全（TypeScript）

```typescript
import axios from 'axios'
import { vi } from 'vitest'

vi.mock('axios')
const mockedAxios = vi.mocked(axios) // 获得类型提示的模拟对象

test('type-safe mock', async () => {
  mockedAxios.get.mockResolvedValue({ data: 'typed mock' })
  // 现在有完整的类型提示了
})
```

### 4. 全局模拟（慎用）

**在 Vitest 配置文件中：**
```javascript
// vitest.config.js
export default {
  test: {
    setupFiles: ['./tests/setup.js'] // 指定设置文件
  }
}
```

**在设置文件中：**
```javascript
// tests/setup.js
import { vi } from 'vitest'

vi.mock('axios') // 在此文件中模拟后，对所有测试文件生效
```

### 5. 清理模拟状态

```javascript
// 在每个测试后清理模拟
afterEach(() => {
  vi.clearAllMocks()
})

// 或在 Vitest 配置中设置
export default {
  test: {
    mockReset: true // 自动重置所有模拟
  }
}
```

## 总结

Vitest 通过 `vi.mock()`, `vi.spyOn()`, `vi.hoisted()`, `vi.importActual()` 等 API 提供了灵活的模块模拟能力。掌握这些方法，你可以有效地隔离第三方依赖，编写出更可靠、更聚焦的单元测试。
