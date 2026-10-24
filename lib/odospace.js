/**
 * Odospace 帧发送端。
 *
 * 协议（三处独立源码互相印证）：
 *
 *   - odospace/Remote-Panel 的 android/.../MainActivity.java（接收端怎么读）
 *   - odospace/Remote-Panel 的 aidardsp/aidardsp.h（AIDA64 插件侧的常量定义）
 *   - AyQWERTY/esp32-odospace 的 components/tcp_png/tcp_png.c（另一个接收端）
 *
 * 每次连接 = 一帧，客户端连上后立即发：
 *     int32 BE  command   2 = 显示图片，1 = 清屏，3 = 清屏(EX)，0 = 测试连接
 *     int32 BE  imageId   面板页号，0..9（Remote Panel 的 "panel position"）
 *     int32 BE  imageSize PNG 字节数
 *     bytes     image     完整 PNG 数据
 * 发完即由接收端 close，一帧一连接。
 *
 * AIDA64 自己就是按这个格式往 38000 推 PNG 的，所以任何能画 PNG 的进程都能
 * 顶替 AIDA64 当发送端 —— 而且因为 imageId 是页号，两者可以各占一页共存。
 */

import net from 'node:net';

/** 显示图片。 */
export const COMMAND_SHOW = 2;
/** 清屏。 */
export const COMMAND_CLEAR = 1;
/** 清屏（带参数版本，插件头文件里的 CMD_CLEAR_SCREEN_EX）。 */
export const COMMAND_CLEAR_EX = 3;
/** 测试连接，不画图。 */
export const COMMAND_TEST = 0;

/** 组一个 Odospace 帧（12 字节头 + PNG）。 */
export function buildFrame(png, imageId = 0, command = COMMAND_SHOW) {
  const header = Buffer.alloc(12);
  header.writeInt32BE(command, 0);
  header.writeInt32BE(imageId, 4);
  header.writeInt32BE(png.length, 8);
  return Buffer.concat([header, png]);
}

/**
 * 推一帧到一个 Odospace 接收端。
 * @param {{host: string, port?: number}} target 接收端（手机 Remote Panel / ESP32 屏）
 * @param {Buffer} png 完整 PNG
 * @param {{imageId?: number, command?: number, timeoutMs?: number}} [options]
 * @returns {Promise<number>} 实际写出的字节数
 */
export function sendFrame(target, png, options = {}) {
  const { imageId = 0, command = COMMAND_SHOW, timeoutMs = 4000 } = options;
  const frame = buildFrame(png, imageId, command);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: target.host, port: target.port ?? 38000 });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(frame.length);
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`timeout ${target.host}:${target.port ?? 38000}`)));
    socket.on('error', finish);
    socket.on('connect', () => {
      socket.write(frame, (error) => {
        // 写进内核缓冲区即视为成功：接收端读完就断，不给我们应用层 ACK。
        socket.end(() => finish(error ?? undefined));
      });
    });
  });
}
