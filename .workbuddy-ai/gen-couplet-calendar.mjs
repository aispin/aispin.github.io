// One-off generator. Uses lunar-javascript (downloaded to /tmp) to emit a
// COMPACT, VERIFIED date table that gets embedded in the app. The library
// itself is never shipped — only its output.
//
// Keyed by LUNAR year, not Gregorian: 腊八/小年/除夕 belong to the lunar year
// that ENDS in the following January, so a Gregorian-year scan silently loses
// them (2042's 腊八 falls in Jan 2043). Converting Lunar -> Solar and bucketing
// by the SOLAR year is the only way that stays correct.
import { createRequire } from 'node:module';
const require = createRequire('/tmp/');
const { Solar, Lunar } = require('/tmp/lunar.js');

const Y0 = 2026, Y1 = 2045;

const TERMS = [
    ['小寒', 1], ['大寒', 1], ['立春', 2], ['雨水', 2],
    ['惊蛰', 3], ['春分', 3], ['清明', 4], ['谷雨', 4],
    ['立夏', 5], ['小满', 5], ['芒种', 6], ['夏至', 6],
    ['小暑', 7], ['大暑', 7], ['立秋', 8], ['处暑', 8],
    ['白露', 9], ['秋分', 9], ['寒露', 10], ['霜降', 10],
    ['立冬', 11], ['小雪', 11], ['大雪', 12], ['冬至', 12],
];

const FESTIVALS = [
    ['春节', 1, 1], ['元宵', 1, 15], ['龙抬头', 2, 2],
    ['端午', 5, 5], ['七夕', 7, 7], ['中元', 7, 15],
    ['中秋', 8, 15], ['重阳', 9, 9],
    ['腊八', 12, 8], ['小年', 12, 23],
];
const ORDER = ['除夕', '春节', '元宵', '龙抬头', '端午', '七夕', '中元', '中秋', '重阳', '腊八', '小年'];

const pad = (n) => String(n).padStart(2, '0');
const mmdd = (s) => `${pad(s.getMonth())}${pad(s.getDay())}`;

// solarYear -> { name: ['MMDD', ...] } (a name can legitimately appear twice)
const bucket = {};
const add = (y, name, v) => {
    bucket[y] ??= {};
    (bucket[y][name] ??= []).push(v);
};

// --- 节气: walk every day of each Gregorian year ---
const termRows = [];
for (let y = Y0; y <= Y1; y++) {
    const byName = {};
    for (let m = 1; m <= 12; m++) {
        const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        for (let d = 1; d <= dim; d++) {
            const jq = Solar.fromYmd(y, m, d).getLunar().getJieQi();
            if (jq) byName[jq] = d;
        }
    }
    termRows.push(`  ${y}: '${TERMS.map(([n]) => {
        const d = byName[n];
        if (!d) throw new Error(`missing 节气 ${n} ${y}`);
        return d;
    }).join(',')}',`);
}

// --- festivals: Lunar -> Solar, then bucket by the SOLAR year ---
for (let ly = Y0 - 1; ly <= Y1 + 1; ly++) {
    for (const [name, lm, ld] of FESTIVALS) {
        const s = Lunar.fromYmd(ly, lm, ld).getSolar();
        add(s.getYear(), name, mmdd(s));
    }
    const cny = Lunar.fromYmd(ly, 1, 1).getSolar();
    add(cny.getYear(), '除夕', mmdd(cny.next(-1)));
    add(cny.getYear(), '春节', mmdd(cny));
}

const festRows = [];
for (let y = Y0; y <= Y1; y++) {
    const b = bucket[y] || {};
    const pick = (name) => {
        const list = b[name];
        // A Gregorian year can legitimately have NO 腊八 (2042: 春节 is Jan 22,
        // so 腊八 fell on Dec 30 2041) and can legitimately have TWO (2041:
        // Jan 10 for the lunar year ending Feb 1, and Dec 30 for the next).
        // Absent -> '--' ; two -> BOTH, joined with '/', because the resolver
        // has to be able to hit either one.
        if (!list?.length) return '--';
        if (list.length === 1) return list[0];
        return [...new Set(list)].sort().join('/');
    };
    festRows.push(`  ${y}: '${ORDER.map(pick).join(' ')}',`);
}

console.log('/* eslint-disable */');
console.log('export const TERM_DAYS = {');
console.log(termRows.join('\n'));
console.log('};');
console.log();
console.log('export const FESTIVAL_DAYS = {');
console.log(festRows.join('\n'));
console.log('};');
