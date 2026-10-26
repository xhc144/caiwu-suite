// 自制图标：蓝底白色账簿与三条绿色统计柱；无外部素材。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function createIcon(file) {
  const size = 256;
  const pixels = Buffer.alloc(size * size * 4);
  const rect = (x1, y1, x2, y2, [red, green, blue]) => {
    for (let y = y1; y < y2; y++)
      for (let x = x1; x < x2; x++) {
        const index = ((size - y - 1) * size + x) * 4;
        pixels.set([blue, green, red, 255], index);
      }
  };
  rect(12, 12, 244, 244, [25, 67, 117]);
  rect(52, 40, 204, 216, [250, 252, 255]);
  rect(52, 40, 66, 216, [209, 222, 239]);
  rect(86, 76, 178, 84, [25, 67, 117]);
  rect(86, 154, 106, 184, [20, 130, 110]);
  rect(122, 132, 142, 184, [20, 130, 110]);
  rect(158, 108, 178, 184, [20, 130, 110]);
  const mask = Buffer.alloc((size * size) / 8);
  const bitmap = Buffer.alloc(40);
  bitmap.writeUInt32LE(40, 0);
  bitmap.writeInt32LE(size, 4);
  bitmap.writeInt32LE(size * 2, 8);
  bitmap.writeUInt16LE(1, 12);
  bitmap.writeUInt16LE(32, 14);
  bitmap.writeUInt32LE(pixels.length + mask.length, 20);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(bitmap.length + pixels.length + mask.length, 14);
  header.writeUInt32LE(22, 18);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([header, bitmap, pixels, mask]));
}
