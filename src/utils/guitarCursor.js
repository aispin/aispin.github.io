// 吉他光标：全站统一的自定义光标。
// 图形由 src/utils/cursorArt.js 在运行时用 canvas 画出（零图片文件），
// 热点 (13, 2) 对应琴头位置（32px 画布）。
import { getCursorValue } from './cursorArt';

const GUITAR_DEFAULT = getCursorValue('default', 'auto');
const GUITAR_POINTER = getCursorValue('pointer', 'pointer');
const GUITAR_GRAB = getCursorValue('pointer', 'grabbing');

export function setGuitarCursor(mode = 'auto') {
  if (typeof document === 'undefined') return;
  if (mode === 'pointer') {
    document.body.style.cursor = GUITAR_POINTER;
  } else if (mode === 'grabbing') {
    document.body.style.cursor = GUITAR_GRAB;
  } else {
    document.body.style.cursor = GUITAR_DEFAULT;
  }
}
