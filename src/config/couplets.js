/**
 * 门联文案 + 「今天该挂哪一副」的解析器。
 *
 * 数据与画法分离：这里只有文字和日期规则，把字画到红纸上的是
 * utils/gateArt.js 的 makeCoupletTexture()。
 *
 * 版式硬约束（从 makeCoupletTexture 量出来的，不是拍脑袋）
 * ------------------------------------------------------
 * - 竖联 **只能 7 字**：size 110 / gap 191 / 画布高 1420，第 8 个字会溢出。
 * - 横批 **只能 4 字**：size 130 / gap 150 / 画布宽 700，第 5 个字会溢出。
 * 所以全部写成七言，横批一律四字。
 *
 * 上下联怎么贴
 * ------------
 * `upper`（上联）在门的**右边**，`lower`（下联）在左边 —— 这是面朝大门
 * 从外往里看时的读序。上联收仄声、下联收平声，下面每一副都按这个验过。
 *
 * 写作原则
 * --------
 * 1. 七言，上下联逐字对仗。
 * 2. 上联末字仄、下联末字平。
 * 3. **保留书斋母题**（灯/砚/墨/书/窗/炉/庭），季节只负责提供意象 ——
 *    否则 24 副节气联会散成 24 个互不相干的主题，门口就不再是「一间书房」。
 * 4. **不写哀声**。清明、中元这类缅怀的节日也收在「暖」上而不是「悲」上。
 * 5. 简体，与站点其余中文一致。
 *
 * 日期规则（用户 2026-10-07 拍板）
 * --------------------------------
 * - 24 个节气全要，**当天**命中（清明例外，见下）。
 * - 横批跟着一起换。
 * - 跨多天的节日按**区间**命中：春节 = 除夕 → 正月初六，国庆 = 10/1–10/7，
 *   劳动节 = 5/1–5/5，清明 = 节气当天 ±1（法定假期是 3 天）。
 * - 优先级：农历节日 > 法定假期 > 节气 > 兜底。所以中秋撞上国庆时挂中秋，
 *   春节撞上立春时挂春节。
 *
 * 日期表在 config/coupletCalendar.data.js（生成物，2026–2045）。
 * 超出范围就落到兜底那一副，不会崩。
 */
import { TERM_DAYS, TERM_MONTHS, TERM_NAMES, FESTIVAL_DAYS, FESTIVAL_NAMES } from './coupletCalendar.data';

/**
 * 兜底那一副 —— 也是「日常」那一副。
 *
 * 2026-10-08 用户拍板：日常门联改成**基于他中文名「黄泽昊」的藏头诗**，
 * 上下联首字分别嵌「泽」「昊」。所以它不再叫 'literary'，直接叫 'zehao'。
 * 日期表查不到今天时挂的就是它 —— 一年里大多数日子都是它。
 */
export const DEFAULT_COUPLET_ID = 'zehao';

/**
 * 每一副联。`label` 是它对应的节气/节日名（要和日期表里的名字**逐字相同**），
 * 兜底和彩蛋两副没有 label。
 *
 * id 只用于贴图缓存键和 ?couplet= 调试参数，所以取英文/pinyin，别用中文。
 */
export const COUPLET_SETS = [
    /* ---------------- 日常（兜底）& 彩蛋 ---------------- */
    /**
     * 日常那一副：藏头「泽」「昊」，取自用户中文名黄泽昊。
     *
     *   上联  泽润庭花春入砚
     *   下联  昊涵云影月临窗
     *   横批  泽昊同春
     *
     * 逐字对仗：泽润/昊涵（名+动）、庭花/云影（名+名）、春/月、入/临、砚/窗。
     * 上联收「砚」(yàn, 去声) = 仄，下联收「窗」(chuāng, 阴平) = 平 ✓。
     * 母题仍是书房（砚、窗），与 24 节气那批同源，门口不会换季变主题。
     */
    {
        id: 'zehao',
        label: '日常',
        banner: '泽昊同春',
        upper: '泽润庭花春入砚',
        lower: '昊涵云影月临窗',
    },
    /**
     * 彩蛋。**自 2026-10-08 起不再有 UI 入口** —— 用户要求去掉「hover 门联
     * 换成另一幅」的逻辑，门口的字就该老老实实是今天那一副。这一条留着只
     * 是为了 `?couplet=funny` 还能调试贴图/版式（长词、窄字都靠它试）。
     */
    {
        id: 'funny',
        label: '搞笑',
        banner: '能跑就行',
        upper: '代码千行无告警',
        lower: '咖啡三盏到天明',
    },

    /* ---------------- 24 节气 ---------------- */
    { id: 'lichun', label: '立春', banner: '东风解冻', upper: '檐冰滴砚初濡墨', lower: '庭草回青已报春' },
    { id: 'yushui', label: '雨水', banner: '润物无声', upper: '一犁好雨匀春垄', lower: '半砚新泉养墨花' },
    { id: 'jingzhe', label: '惊蛰', banner: '春雷启蛰', upper: '雷惊蛰户虫初动', lower: '雨润新芽绿渐肥' },
    { id: 'chunfen', label: '春分', banner: '昼夜均分', upper: '昼夜均分春正半', lower: '燕莺初到日方长' },
    // 清明既是节气又是节日。用户要求缅怀类写「温馨」而不是「悲」，
    // 所以横批从「慎终追远」改成《兰亭序》的「春和景明」，
    // 内容也从「雨洗梨花」的冷调改成「梨花落后春犹在」。
    { id: 'qingming', label: '清明', banner: '春和景明', upper: '梨花落后春犹在', lower: '燕子归时雨亦香' },
    { id: 'guyu', label: '谷雨', banner: '雨生百谷', upper: '雨生百谷催耕急', lower: '风落千花入砚香' },
    { id: 'lixia', label: '立夏', banner: '绿阴初密', upper: '树阴初密春归去', lower: '荷气微生夏始来' },
    { id: 'xiaoman', label: '小满', banner: '麦齐榴绽', upper: '麦穗初齐蚕欲老', lower: '榴花半放雨初晴' },
    { id: 'mangzhong', label: '芒种', banner: '梅雨催耕', upper: '芒种催耕梅雨近', lower: '竹风送爽墨花香' },
    { id: 'xiazhi', label: '夏至', banner: '日长蝉噪', upper: '日长至后阴初动', lower: '蝉噪声中昼正闲' },
    { id: 'xiaoshu', label: '小暑', banner: '温风始至', upper: '温风始至蝉初噪', lower: '溽暑方来扇未停' },
    { id: 'dashu', label: '大暑', banner: '炎威正炽', upper: '炎威正炽蝉声急', lower: '凉雨忽来荷气清' },
    { id: 'liqiu', label: '立秋', banner: '一叶知秋', upper: '一叶初惊秋信至', lower: '新凉暗入晚窗来' },
    { id: 'chushu', label: '处暑', banner: '暑去秋来', upper: '暑气渐消秋意近', lower: '蝉声欲歇雁初来' },
    { id: 'bailu', label: '白露', banner: '露白雁斜', upper: '露凝阶白秋光冷', lower: '月满庭空雁字斜' },
    { id: 'qiufen', label: '秋分', banner: '秋色平分', upper: '昼夜均分秋过半', lower: '桂香初动月当空' },
    { id: 'hanlu', label: '寒露', banner: '露重菊黄', upper: '露重霜寒秋欲老', lower: '菊黄蟹壮酒初香' },
    { id: 'shuangjiang', label: '霜降', banner: '霜清叶落', upper: '霜清叶落山初瘦', lower: '菊绽橙黄酒正香' },
    { id: 'lidong', label: '立冬', banner: '霜叶炉红', upper: '霜叶尽时冬始立', lower: '炉火初红夜渐长' },
    { id: 'xiaoxue', label: '小雪', banner: '初雪炉温', upper: '初雪飘阶寒渐重', lower: '新炉煮酒夜方长' },
    { id: 'daxue', label: '大雪', banner: '雪满炉红', upper: '雪满空庭人迹少', lower: '炉红小阁墨香浓' },
    { id: 'dongzhi', label: '冬至', banner: '一阳来复', upper: '数九寒天阳渐动', lower: '围炉夜话岁将新' },
    { id: 'xiaohan', label: '小寒', banner: '梅雪争春', upper: '小寒初至梅将放', lower: '残雪未消炉正温' },
    { id: 'dahan', label: '大寒', banner: '岁除春近', upper: '大寒已极春将近', lower: '旧岁将除酒正香' },

    /* ---------------- 传统节日 ---------------- */
    { id: 'spring-festival', label: '春节', banner: '万象更新', upper: '爆竹声中辞旧岁', lower: '桃符门上换新春' },
    { id: 'lantern', label: '元宵', banner: '灯火可亲', upper: '千门灯火明如昼', lower: '一碗汤圆暖似春' },
    { id: 'dragon-head', label: '龙抬头', banner: '抬头见喜', upper: '龙抬头日春耕始', lower: '燕剪风时柳色新' },
    { id: 'duanwu', label: '端午', banner: '端午安康', upper: '艾叶香中驱百毒', lower: '龙舟声里竞千帆' },
    { id: 'qixi', label: '七夕', banner: '金风玉露', upper: '银汉迢迢双星会', lower: '金风细细一叶秋' },
    // 同清明：缅怀类改温馨。一盏心灯 + 半庭月色，不写悲声。
    { id: 'zhongyuan', label: '中元', banner: '月色如故', upper: '一盏心灯温旧梦', lower: '半庭月色照新秋' },
    { id: 'mid-autumn', label: '中秋', banner: '千里共月', upper: '一轮明月同千里', lower: '半盏清茶共此时' },
    { id: 'chongyang', label: '重阳', banner: '九九重阳', upper: '登高望远秋光好', lower: '采菊簪萸酒味长' },
    { id: 'laba', label: '腊八', banner: '腊八粥香', upper: '腊八粥香迎岁近', lower: '一庭梅影报春回' },
    { id: 'xiaonian', label: '小年', banner: '祭灶迎年', upper: '糖瓜祭灶迎新岁', lower: '扫舍除尘换旧符' },

    /* ---------------- 法定假期（公历固定，不进日期表） ---------------- */
    { id: 'new-year', label: '元旦', banner: '一元复始', upper: '一夜春风辞旧岁', lower: '半窗晓日启新程' },
    { id: 'labour-day', label: '劳动节', banner: '五月清和', upper: '且停手上千般事', lower: '来享人间五月天' },
    { id: 'national-day', label: '国庆', banner: '国庆同欢', upper: '七日闲身游胜景', lower: '一庭秋色伴归人' },
];

const BY_ID = new Map(COUPLET_SETS.map((s) => [s.id, s]));
const BY_LABEL = new Map(COUPLET_SETS.map((s) => [s.label, s]));

/**
 * 区间命中表，单位是「天」，相对该节日/节气的**公历日期**。
 * `[before, after]` = **前几天 / 后几天**，两个都是非负数 ——
 * 不是「带符号的偏移区间」。春节的 before = 1 就是除夕。
 *
 * ⚠️ 这里踩过一次：清明的法定假期是 3 天，顺手写成 `[-1, 1]`（像是
 * 「从 -1 到 +1」），结果 `start - before` 变成 `start + 1`，
 * 窗口塌成只剩「节气后一天」—— 清明当天反而挂不上。语义是
 * 「前后各几天」，就老老实实写 `[1, 1]`。
 */
const WINDOWS = {
    // 农历节日（日期来自日期表）
    春节: [1, 6],
    元宵: [0, 0],
    龙抬头: [0, 0],
    端午: [0, 0],
    七夕: [0, 0],
    中元: [0, 0],
    中秋: [0, 0],
    重阳: [0, 0],
    腊八: [0, 0],
    小年: [0, 0],
    // 节气。只有清明跨天 —— 它的法定假期是 3 天，所以前后各放一天。
    清明: [1, 1],
};

/** 公历固定日期的假期，[月, 日, 持续天数]。 */
const FIXED_HOLIDAYS = [
    ['new-year', 1, 1, 1],
    ['labour-day', 5, 1, 5],
    ['national-day', 10, 1, 7],
];

/** 第几天（UTC 天数，只用来做区间比较，不涉及时区语义）。 */
const dayNumber = (y, month, day) => Math.floor(Date.UTC(y, month - 1, day) / 86400000);

/** 'MMDD' → 当年的第几天。'--' 或非法值返回 null。 */
const parseMmdd = (y, mmdd) => {
    if (!mmdd || mmdd === '--' || mmdd.length !== 4) return null;
    const m = Number(mmdd.slice(0, 2));
    const d = Number(mmdd.slice(2));
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    return dayNumber(y, m, d);
};

/**
 * 今天是哪一副门联。
 *
 * 优先级：农历节日 > 法定假期 > 节气 > 兜底。逐条按「最具体的先判」，
 * 所以中秋落在国庆区间里时挂中秋、春节落在立春当天时挂春节。
 *
 * @param {Date} [date] 默认现在。传参是为了能单测，也让 ?couplet= 之外
 *                      还能在控制台里试别的日期。
 * @returns {{set: object, reason: 'festival'|'holiday'|'term'|'default', label: string|null}}
 */
export function resolveCoupletSet(date = new Date()) {
    const y = date.getFullYear();
    const today = dayNumber(y, date.getMonth() + 1, date.getDate());

    const hit = (label, start, window) => {
        if (start === null) return false;
        const [before, after] = window;
        return today >= start - before && today <= start + after;
    };

    // --- 1. 农历节日（日期表） ---
    const festRow = FESTIVAL_DAYS[y];
    if (festRow) {
        const toks = festRow.split(/\s+/);
        for (let i = 0; i < FESTIVAL_NAMES.length; i++) {
            const label = FESTIVAL_NAMES[i];
            const window = WINDOWS[label];
            if (!window) continue;
            const set = BY_LABEL.get(label);
            if (!set) continue;
            // 一年里可能出现两次的节日（只有腊八会这样）在格子里写成
            // '0110/1230' —— 两个日期都要判，不能只取一个。
            for (const cand of String(toks[i]).split('/')) {
                if (hit(label, parseMmdd(y, cand), window)) {
                    return { set, reason: 'festival', label };
                }
            }
        }
    }

    // --- 2. 公历固定假期 ---
    for (const [id, m, d, days] of FIXED_HOLIDAYS) {
        const start = dayNumber(y, m, d);
        if (today >= start && today < start + days) {
            const set = BY_ID.get(id);
            if (set) return { set, reason: 'holiday', label: set.label };
        }
    }

    // --- 3. 节气（当天；清明 ±1） ---
    const termRow = TERM_DAYS[y];
    if (termRow) {
        const days = termRow.split(',');
        for (let i = 0; i < TERM_NAMES.length; i++) {
            const label = TERM_NAMES[i];
            const set = BY_LABEL.get(label);
            if (!set) continue;
            const window = WINDOWS[label] || [0, 0];
            const start = dayNumber(y, TERM_MONTHS[i], Number(days[i]));
            if (hit(label, start, window)) return { set, reason: 'term', label };
        }
    }

    // --- 4. 兜底 ---
    return { set: BY_ID.get(DEFAULT_COUPLET_ID), reason: 'default', label: null };
}

/**
 * ?couplet= 调试覆盖。传 id（'lichun'）或中文名（'立春'）都认；
 * 传 'off' 强制用兜底那一副。
 *
 * 有它才能验收 —— 否则要看别的节气得改系统时间。
 *
 * @param {string} [search] 默认读 location.search
 * @returns {object|null} 命中的那一副，没传/没命中返回 null
 */
export function coupletOverride(search = (typeof window !== 'undefined' ? window.location.search : '')) {
    const raw = new URLSearchParams(search).get('couplet');
    if (!raw) return null;
    if (raw === 'off' || raw === 'default') return BY_ID.get(DEFAULT_COUPLET_ID);
    return BY_ID.get(raw) || BY_LABEL.get(raw) || null;
}
