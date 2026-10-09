import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

/* ---------------------------------------------------------------------
 * Why the react-hooks rules are configured by hand instead of by
 * extending `reactHooks.configs.flat.recommended`.
 *
 * eslint-plugin-react-hooks v7 bundles the **React Compiler** rules into that
 * preset, and ships them as `error`. This project does not run React Compiler:
 *
 *   - `babel-plugin-react-compiler` is not installed
 *   - there is no babel/swc config, and vite.config.js never mentions it
 *
 * So those rules describe a build we never produce, and two of them cannot be
 * satisfied at all:
 *
 *   - `preserve-manual-memoization` is literally the compiler saying
 *     "React Compiler has skipped optimizing this component". With no compiler
 *     in the pipeline there is nothing to preserve, and the rule fires on
 *     every hand-written useMemo/useCallback whose inferred deps include a ref.
 *   - `set-state-in-effect` flags the documented "synchronise with an external
 *     system" use of an effect (the 3D scene's phase, the audio bus, the
 *     loader's progress signal) as if it were derived state.
 *
 * They stay ON at `warn` so the signal is not thrown away, but they do not
 * fail CI. Everything that catches a real bug stays at `error` — see the
 * explicit list below. That list is now clean; keep it that way.
 * ------------------------------------------------------------------- */

/* Advisories that still carry signal even without the compiler — kept at warn
 * so they stay visible and get cleaned up over time. */
const COMPILER_ADVISORIES = [
  'set-state-in-effect',           // 多数是「同步外部系统」的合法用法，见文件头
  'no-deriving-state-in-effects',
  'memoized-effect-dependencies',
  'automatic-effect-dependencies',
  'incompatible-library',
  'capitalized-calls',
  'void-use-memo',
  'use-memo',
  'component-hook-factories',
  'error-boundaries',
  'globals',
  'hooks',
]

/* Zero signal for this project — see the two named cases in the header. */
const COMPILER_RULES_OFF = [
  'preserve-manual-memoization',   // 「编译器跳过了这个组件」——没有编译器就没意义
  'rule-suppression',              // 只是「这里有一个 eslint-disable」，纯噪音
  'todo',                          // 「这里有一个 TODO」，纯噪音
  'config',
  'gating',
  'invariant',
  'syntax',
  'unsupported-syntax',
  'fire',
  'fbt',
]

export default defineConfig([
  // `dist` 是构建产物；`.workbuddy-ai` 是归档目录（旧 dist 快照、字体归档、
  // vite 依赖快照都堆在那里），两者都不该进 lint。
  globalIgnores(['dist', '.workbuddy-ai']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // ── 真正会抓 bug 的 React 规则：保持 error ──────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/refs': 'error',              // 渲染期读/写 ref
      'react-hooks/purity': 'error',            // 渲染期调 Math.random/Date.now
      'react-hooks/immutability': 'error',      // 改 hook 返回值 / props
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/static-components': 'error', // 组件里定义组件 → 每次渲染重挂载
      // 依赖数组：warn（手写 deps 的漏项多是刻意的，见各处注释）
      'react-hooks/exhaustive-deps': 'warn',

      // ── React Compiler 专属规则：降为 warn / off，见文件头说明 ──────
      ...Object.fromEntries(
        COMPILER_ADVISORIES.map((rule) => [`react-hooks/${rule}`, 'warn'])
      ),
      ...Object.fromEntries(
        COMPILER_RULES_OFF.map((rule) => [`react-hooks/${rule}`, 'off'])
      ),

      // 大写或下划线开头 = 有意保留但当前没用到（接口占位、签名对齐）。
      // `argsIgnorePattern` 是给 `(_ctx) => [...]` 这类「签名要求但实现不用」
      // 的工厂参数用的（见 src/audio/ambience.js）。
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^[A-Z_]',
      }],
    },
  },

  // ---------------------------------------------------------------------
  // react-refresh/only-export-components
  //
  // 这条只影响 **dev 的 HMR 粒度**（文件混着导出组件与非组件时，改它会整页
  // 刷新而不是热替换）。它**不影响生产**，也不代表代码有错。
  //
  // 下面这些文件是**故意**混着导出的，两种都是社区标准写法：
  //
  // 1. Context 文件：`Provider` + `useXxx` 同文件，是最常见的 React Context
  //    组织方式。拆开要动十几个 import，收益只是 dev 热替换更细。
  // 2. 房间文件：把可调参数（音量、道具位置）与用它的组件放一起，源码里
  //    明确标了 "TWEAK HERE" —— 拆出去反而让人找不到。
  //
  // 用规则**自带的** allowExportNames 白名单，而不是整条关掉：白名单之外的
  // 新导出仍然会被拦下来。
  // ---------------------------------------------------------------------
  {
    files: ['src/context/*.jsx'],
    rules: {
      'react-refresh/only-export-components': ['error', {
        allowExportNames: [
          'ACHIEVEMENTS', 'useAchievements',   // AchievementsContext
          'useAudio',                          // AudioManager
          'TIERS', 'usePerformance',           // PerformanceContext
          'useScene', 'SceneContext',          // SceneContext
          'useSitePreferences',                // SitePreferences
        ],
      }],
    },
  },
  {
    files: [
      'src/components/canvas/rooms/Contact/ContactRoom.jsx',
      'src/components/canvas/rooms/Gallery/GalleryRoom.jsx',
      'src/components/canvas/rooms/ContentRoom.jsx',
    ],
    rules: {
      'react-refresh/only-export-components': ['error', {
        allowExportNames: [
          'AUDIO_SETTINGS', 'LATARNIA_SETTINGS', 'STATEK_SETTINGS',
          'GALLERY_INTERACTION_AUDIO_SETTINGS', 'drawCardTexture',
        ],
      }],
    },
  },
])
