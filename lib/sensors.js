/**
 * 传感器数据的缓存容器（**仅 HTTP 接口用，不上屏**）。
 *
 * 外部程序 POST 一组 `{id, label, value, type}` 到本桥的 `/sensors`，这里存
 * 最新一份，让 `GET /` 能一起返回。面板本身不画传感器 —— 硬件监控现在由
 * AIDA64 直连手机显示，见 README「与 AIDA64 共存」。
 *
 * 数据形状沿用 AIDA64 共享内存的 XML 片段约定（`<temp><id>..</id>...`），
 * 类型元素名：sys / temp / fan / volt / curr / pwr / duty / flow。
 */

/** 线程安全（单线程 Node 里就是「不会读到半个快照」）的传感器缓存。 */
export class SensorStore {
  /** @param {number} staleMs 超过这么久没更新就认为数据过期 */
  constructor(staleMs = 15000) {
    this.staleMs = staleMs;
    /** @type {{id: string, label: string, value: string, type: string}[]} */
    this.sensors = [];
    this.updatedAt = 0;
  }

  /** @param {{id?: string, label?: string, value?: string, type?: string}[]} list */
  update(list) {
    if (!Array.isArray(list)) return;
    this.sensors = list
      .filter((sensor) => sensor && typeof sensor === 'object')
      .map((sensor) => ({
        id: String(sensor.id ?? ''),
        label: String(sensor.label ?? ''),
        value: String(sensor.value ?? ''),
        type: String(sensor.type ?? 'sys').toLowerCase(),
      }))
      .filter((sensor) => sensor.id !== '' || sensor.label !== '');
    this.updatedAt = Date.now();
  }

  /** @returns {{id: string, label: string, value: string, type: string}[]} 过期则空数组 */
  snapshot() {
    if (this.updatedAt === 0) return [];
    if (Date.now() - this.updatedAt > this.staleMs) return [];
    return this.sensors;
  }

  /** 供面板 footer 显示的「数据多新」。 */
  ageText() {
    if (this.updatedAt === 0) return '硬件数据未接入';
    const seconds = Math.round((Date.now() - this.updatedAt) / 1000);
    if (seconds > this.staleMs / 1000) return `硬件数据过期 ${seconds}s`;
    return `硬件数据 ${seconds}s 前`;
  }
}
