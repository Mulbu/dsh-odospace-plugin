window.__ModuleLoader__.load({
  id: '@mulbu/dsh-odospace',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const h = React.createElement;

    /** This bundle's locale namespace. */
    const NS = 'dsh-odospace';
    /** Sidebar panel id; also the key used to occupy the `main` slot. */
    const PANEL_ID = 'odospace';
    /** Same-origin route the Host half registers. */
    const API = '/dsh-odospace/api';
    /** Poll cadence: the panel is ambient, 2s is enough and matches the bridge's own check interval. */
    const POLL_MS = 2000;
    /** A hung sample must not stall the loop. */
    const REQUEST_TIMEOUT_MS = 8000;

    const zh = {
      'status.loading': '读取中…',
      'settings.nav': 'Odospace 面板',
      'settings.host': '推送 IP',
      'settings.host.hint': '接收端（手机 Remote Panel）的地址，留空则不推流',
      'settings.port': '端口',
      'settings.port.hint': 'Odospace 接收端口，通常是 38000',
      'settings.page': '面板页号',
      'settings.page.hint': 'AIDA64 直连手机时占 0，本插件用 1，两者不要相同',
      'settings.rows': '列表行数',
      'settings.rows.hint': '显示几个会话；填 0 变成单任务大字号视图',
      'settings.size': '推流分辨率',
      'settings.size.hint': '面板像素尺寸，格式 WxH。AIDA64 那页多少就是多少，改完下一帧生效',
      'settings.save': '保存并生效',
      'settings.saving': '保存中…',
      'settings.reset': '还原',
      'settings.saved': '已保存并立即生效',
      'settings.savedMemory': '已生效（未能写入配置文件，重启后会恢复旧值）',
      'settings.failed': '保存失败',
      'settings.unchanged': '没有改动',
      'settings.persistNote': '改动会写入插件配置并在下一个推送周期生效，无需重启。',
      'error.route': '读不到面板状态：宿主路由不可用或已停用该插件。',
    };

    const en = {
      'status.loading': 'Reading…',
      'settings.nav': 'Odospace Panel',
      'settings.host': 'Push IP',
      'settings.host.hint': 'Receiver address (the phone running Remote Panel). Empty = do not stream.',
      'settings.port': 'Port',
      'settings.port.hint': 'Odospace receiver port, usually 38000',
      'settings.page': 'Panel page',
      'settings.page.hint': 'AIDA64 occupies page 0 when it connects to the phone directly; this plugin uses 1. Keep them different.',
      'settings.rows': 'List rows',
      'settings.rows.hint': 'How many sessions to show; 0 switches to the single-task large-type view',
      'settings.size': 'Resolution',
      'settings.size.hint': 'Panel pixel size as WxH; match the AIDA64 page. Applies from the next frame.',
      'settings.save': 'Save and apply',
      'settings.saving': 'Saving…',
      'settings.reset': 'Reset',
      'settings.saved': 'Saved and applied',
      'settings.savedMemory': 'Applied (could not write the config file; reverts on restart)',
      'settings.failed': 'Save failed',
      'settings.unchanged': 'No changes',
      'settings.persistNote': 'Changes are written to the plugin config and take effect on the next push cycle; no restart needed.',
      'error.route': 'Cannot read panel state: the host route is unavailable or the plugin is disabled.',
    };

    /**
     * Colours come from theme tokens so light/dark switching works. The LED
     * colours are the one place literal values are allowed: they mirror the
     * artwork baked into the rendered JPEG (green/blue/orange/red), and a token
     * rename must not silently change what the LED means.
     */
    const CSS = [
      '[data-dsh-odospace]{box-sizing:border-box;width:100%;min-width:0;height:100%;min-height:0;',
      'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);',
      'font-size:14px;line-height:1.6;display:flex;overflow:hidden}',
      'margin-bottom:8px;padding-top:28px;display:flex;flex-wrap:wrap}',
      'display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;',
      'border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary);',
      'transition:background .15s,border-color .15s}',
      'border-color:transparent;color:var(--dsw-alias-label-on-business,#fff)}',
      'color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
      'color:var(--dsw-alias-label-secondary);font-weight:500}',
      // LED colours live in `data-led` and are literal: they must match the
      // pixels the receiver actually sees, not a themed accent.
      'padding:14px 16px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1)}',
      'color:var(--dsw-alias-label-tertiary);line-height:20px}',
      // The preview is the real rendered frame: black background, centred,
      // scaled to the card. `image-rendering:auto` keeps the JPEG smooth.
      'background:#05070B;display:flex;align-items:center;justify-content:center;',
      'aspect-ratio:var(--odo-aspect,15/8)}',
      'font-size:13px;background:var(--dsw-alias-bg-module-platform)}',
      'font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
      'font-weight:500;line-height:23px}',
      'text-overflow:ellipsis;white-space:nowrap;overflow:hidden}',
      'color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:23px;font-variant-numeric:tabular-nums}',
      'align-items:center;font-size:12px;line-height:20px;background:var(--dsw-alias-bg-module-platform);',
      'color:var(--dsw-alias-label-secondary)}',
      // Settings section (Settings → Odospace). Mirrors the host's settings rows:
      // a 13px medium label, a 34px control, 0.5px separators between rows, and
      // a primary save button on the token palette. Class names are prefixed and
      // only --dsw-alias-* tokens are referenced, so light/dark both work.
      '[data-dsh-odospace-settings]{display:flex;flex-direction:column;width:100%;min-width:0;',
      'color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '[data-dsh-odospace-settings] .odo-settings-form{display:flex;flex-direction:column}',
      '[data-dsh-odospace-settings] .odo-setting{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '[data-dsh-odospace-settings] .odo-setting+.odo-setting{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '[data-dsh-odospace-settings] .odo-setting-head{display:flex;align-items:center;gap:8px}',
      '[data-dsh-odospace-settings] .odo-setting-label{flex:1;min-width:0;font-size:13px;font-weight:500;',
      'line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '[data-dsh-odospace-settings] .odo-setting-input{box-sizing:border-box;height:34px;padding:0 12px;',
      'border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);',
      'background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;',
      'color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;',
      'transition:border-color .15s}',
      '[data-dsh-odospace-settings] .odo-setting-input:hover{border-color:var(--dsw-alias-border-l2)}',
      '[data-dsh-odospace-settings] .odo-setting-input:focus{outline:none;',
      'border-color:var(--dsw-alias-state-business-primary)}',
      '[data-dsh-odospace-settings] .odo-setting-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}',
      '[data-dsh-odospace-settings] .odo-settings-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
      'padding-top:16px}',
      '[data-dsh-odospace-settings] .odo-settings-save{appearance:none;border:1px solid transparent;',
      'border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;',
      'cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '[data-dsh-odospace-settings] .odo-settings-save:disabled{opacity:.4;cursor:default}',
      '[data-dsh-odospace-settings] .odo-settings-save:focus-visible{',
      'outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));',
      'outline-offset:1px}',
      '[data-dsh-odospace-settings] .odo-settings-reset{border:none;background:none;padding:0;font:inherit;',
      'font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '[data-dsh-odospace-settings] .odo-settings-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '[data-dsh-odospace-settings] .odo-settings-reset:disabled{cursor:default}',
      '[data-dsh-odospace-settings] .odo-settings-msg{font-size:12px;line-height:1.5;',
      'color:var(--dsw-alias-state-success-primary)}',
      '[data-dsh-odospace-settings] .odo-settings-msg[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '[data-dsh-odospace-settings] .odo-settings-msg[data-tone=muted]{color:var(--dsw-alias-label-tertiary)}',
      // Muted legend: the per-field hints and the persist note.
      '[data-dsh-odospace-settings] .odo-legend{margin:0;font-size:12px;line-height:1.6;',
      'color:var(--dsw-alias-label-tertiary)}',
    ].join('');

    /** Install the stylesheet once; returns its disposer. */
    function installStyles() {
      if (document.querySelector(`style[data-plugin="${PANEL_ID}"]`) !== null) return () => {};
      const style = document.createElement('style');
      style.dataset.plugin = PANEL_ID;
      style.textContent = CSS;
      document.head.append(style);
      return () => {
        style.remove();
      };
    }

    /** Human uptime such as `3h 12m`. */
    function formatUptime(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '—';
      const minutes = Math.floor(ms / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return `${days}d ${hours % 24}h`;
      if (hours > 0) return `${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `${minutes}m`;
      return `${Math.floor(ms / 1000)}s`;
    }

    /** Byte size for the last pushed frame. */
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '—';
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${Math.round(bytes / 1024)} KB`;
    }

    /**
     * Sidebar panel glyph.
     *
     * Render the SVG as the row's direct icon child at the size the sidebar asks
     * for — the sidebar owns the accessible navigation label, so the glyph is
     * decorative. `currentColor` makes it follow the row's active/inactive tint.
     */
    function OdospaceIcon(props) {
      const size = Number.isFinite(props?.size) ? props.size : 16;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': 'true',
        },
        h('rect', {
          x: 2.5, y: 4.5, width: 19, height: 12.5, rx: 2.5,
          stroke: 'currentColor', strokeWidth: 1.5,
        }),
        h('path', { d: 'M9 21h6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M12 17.5V21', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('rect', { x: 5.5, y: 7.5, width: 2.4, height: 2.4, rx: 0.7, fill: 'currentColor' }),
        h('rect', { x: 9.8, y: 8.2, width: 8, height: 1, rx: 0.5, fill: 'currentColor' }),
        h('rect', { x: 5.5, y: 11, width: 2.4, height: 2.4, rx: 0.7, fill: 'currentColor', opacity: 0.45 }),
        h('rect', { x: 9.8, y: 11.7, width: 6, height: 1, rx: 0.5, fill: 'currentColor', opacity: 0.45 }),
      );
    }

    /**
     * The Odospace settings section (left-bottom Settings → Odospace).
     *
     * These four fields are the ones users retune day to day — where to push,
     * on which panel page, and how many sessions to list — so they belong in the
     * global Settings panel rather than on the plugin's own page.
     *
     * The section owns its data: it fetches the values itself instead of
     * depending on the panel page being open, because a settings section must
     * work when Settings is opened directly from the sidebar.
     *
     * Saving writes through the host route, which persists to the profile patch
     * layer AND hot-swaps the running bridge, so no restart is involved.
     */
    function OdospaceSettings(props) {
      const t = props.t;
      const [state, setState] = React.useState({ phase: 'loading' });
      const [draft, setDraft] = React.useState(undefined);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState(undefined);

      /** Load current values + their legal ranges. */
      const load = React.useCallback(async () => {
        try {
          const response = await fetch(`${API}/settings`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload?.ok !== true) throw new Error('unexpected payload');
          setState({ phase: 'ok', data: payload });
          setDraft((previous) => previous ?? {
            host: String(payload.settings.host ?? ''),
            port: String(payload.settings.port ?? 38000),
            page: String(payload.settings.page ?? 1),
            tasks: String(payload.settings.tasks ?? 4),
            size: String(payload.settings.size ?? '1350x720'),
          });
        } catch {
          setState({ phase: 'error' });
        }
      }, []);

      React.useEffect(() => {
        void load();
      }, [load]);

      const bounds = state.data?.bounds;
      const set = (key) => (event) => {
        setDraft((previous) => ({ ...previous, [key]: event.target.value }));
        setMessage(undefined);
      };

      /** Parse one integer field strictly; undefined = invalid (also for blanks). */
      const toNumber = (text, range) => {
        if (typeof text !== 'string' && typeof text !== 'number') return undefined;
        const raw = String(text);
        const value = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
        if (value < range.min || value > range.max) return undefined;
        return value;
      };

      /** `"1350x720"` / `"1350 x 720"` → normalised string, or undefined when invalid. */
      const parseSize = (text) => {
        if (typeof text !== 'string') return undefined;
        const match = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/i.exec(text);
        if (match === null) return undefined;
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (width < 64 || width > 8192 || height < 64 || height > 8192) return undefined;
        return `${width}x${height}`;
      };

      const port = draft === undefined ? undefined : toNumber(draft.port, bounds?.port ?? { min: 1, max: 65535 });
      const page = draft === undefined ? undefined : toNumber(draft.page, bounds?.page ?? { min: 0, max: 9 });
      const rows = draft === undefined ? undefined : toNumber(draft.tasks, { min: 0, max: 8 });
      const size = draft === undefined ? undefined : parseSize(draft.size);
      const valid = port !== undefined && page !== undefined && rows !== undefined && size !== undefined;

      const save = async () => {
        if (!valid || saving) return;
        setSaving(true);
        setMessage(undefined);
        try {
          const response = await fetch(`${API}/settings`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({ host: draft.host.trim(), port, page, tasks: rows, size: size }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.ok !== true) {
            throw new Error(payload.error ?? `HTTP ${response.status}`);
          }
          if (payload.applied !== undefined && payload.applied.length === 0) {
            setMessage({ tone: 'muted', text: t('settings.unchanged') });
          } else {
            setMessage({
              tone: payload.persisted ? 'ok' : 'error',
              text: payload.persisted ? t('settings.saved') : t('settings.savedMemory'),
            });
          }
          await load();
        } catch (error) {
          setMessage({ tone: 'error', text: `${t('settings.failed')}: ${String(error?.message ?? error)}` });
        } finally {
          setSaving(false);
        }
      };

      const reset = () => {
        const live = state.data?.settings;
        setDraft({
          host: String(live?.host ?? ''),
          port: String(live?.port ?? 38000),
          page: String(live?.page ?? 1),
          tasks: String(live?.tasks ?? 4),
          size: String(live?.size ?? '1350x720'),
        });
        setMessage(undefined);
      };

      if (state.phase === 'error') {
        return h('div', { 'data-dsh-odospace-settings': '', 'data-state': 'error' },
          h('p', { className: 'odo-legend' }, t('error.route')));
      }
      if (draft === undefined) {
        return h('div', { 'data-dsh-odospace-settings': '', 'data-state': 'loading' },
          h('p', { className: 'odo-legend' }, t('status.loading')));
      }

      // One settings row: label, control, hint. Mirrors the host's settings rows
      // (13px medium label, 34px control, 0.5px separators) so this section reads
      // as one of the shipped pages rather than a foreign block.
      const field = (draftKey, label, hint, range, invalid, mode = 'numeric') =>
        h(
          'div',
          { className: 'odo-setting' },
          h(
            'div',
            { className: 'odo-setting-head' },
            h('label', { className: 'odo-setting-label', htmlFor: `odo-set-${draftKey}` }, label),
          ),
          h('input', {
            id: `odo-set-${draftKey}`,
            className: 'odo-setting-input',
            type: 'text',
            // Numeric fields get the numeric keypad; the resolution row is free
            // text because it carries an "x" between two numbers.
            inputMode: mode,
            value: draft[draftKey],
            onChange: set(draftKey),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void save();
            },
            'aria-invalid': invalid ? 'true' : undefined,
            'aria-describedby': hint === undefined ? undefined : `odo-set-${draftKey}-hint`,
            spellCheck: false,
            autoComplete: 'off',
          }),
          hint === undefined
            ? null
            : h('p', { className: 'odo-legend', id: `odo-set-${draftKey}-hint` }, hint),
          range === undefined
            ? null
            : h('p', { className: 'odo-legend' }, `${range.min} – ${range.max}`),
        );

      return h(
        'div',
        { 'data-dsh-odospace-settings': '', 'data-state': 'ok' },
        h('p', { className: 'odo-legend' }, t('settings.persistNote')),
        h(
          'div',
          { className: 'odo-settings-form' },
          field('host', t('settings.host'), t('settings.host.hint'), undefined, false),
          field('port', t('settings.port'), t('settings.port.hint'), bounds?.port, port === undefined),
          field('page', t('settings.page'), t('settings.page.hint'), bounds?.page, page === undefined),
          field('tasks', t('settings.rows'), t('settings.rows.hint'), { min: 0, max: 8 }, rows === undefined),
          field('size', t('settings.size'), t('settings.size.hint'), undefined, size === undefined, 'text'),
        ),
        h(
          'div',
          { className: 'odo-settings-footer' },
          h(
            'button',
            {
              type: 'button',
              className: 'odo-settings-save',
              onClick: () => void save(),
              disabled: saving || !valid,
            },
            saving ? t('settings.saving') : t('settings.save'),
          ),
          h(
            'button',
            { type: 'button', className: 'odo-settings-reset', onClick: reset, disabled: saving },
            t('settings.reset'),
          ),
          message === undefined
            ? null
            : h(
                'span',
                { className: 'odo-settings-msg', 'data-tone': message.tone },
                message.text,
              ),
        ),
      );
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'dsh-odospace: styles');
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-odospace: locale');

      // No sidebar entry and no `main` page on purpose: this plugin's whole
      // surface is the settings section below. The panel preview, push button
      // and per-session list were a second copy of information the LED panel
      // already shows on the phone, and they cost a permanent sidebar row.
      // `OdospacePage` is kept in the file (and exported) so a deployment that
      // wants the page back only has to restore these two registrations.

      // Settings → Odospace: one section in the global Settings panel at the
      // bottom of the sidebar, beside General / Models / Plugins. `order: 22`
      // puts it after Agent Presets (20) and before Skills (25) — it is a
      // feature preference, not a first-class platform page.
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: PANEL_ID,
            order: 22,
            locale: NS,
            label: () => ctx.locale.bind(NS)('settings.nav'),
          },
          OdospaceSettings,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.OdospaceSettings = OdospaceSettings;
    return module.exports;
  },
});
