window.__ModuleLoader__.load({
  id: '@local/dsh-odospace',
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
      'panel': 'Odospace 面板',
      'title': 'Odospace 面板',
      'subtitle': 'dsh 任务进度实时推送到 Odospace 接收端',
      'status.on': '推流中',
      'status.off': '未配置接收端',
      'status.error': '连接失败',
      'status.loading': '读取中…',
      'status.dryrun': '只渲染不推送',
      'config.receiver': '接收端',
      'config.page': '页号',
      'config.size': '分辨率',
      'config.view': '视图',
      'config.mode': '模式',
      'view.list': '任务列表',
      'view.single': '单任务',
      'mode.blink': '灯效',
      'mode.static': '静态',
      'stats.pushed': '已推送',
      'stats.rendered': '已渲染',
      'stats.failed': '失败',
      'stats.uptime': '运行',
      'stats.lastError': '最近错误',
      'settings.title': '设置',
      'settings.host': '推送 IP',
      'settings.host.hint': '接收端（手机 Remote Panel）的地址，留空则不推流',
      'settings.port': '端口',
      'settings.port.hint': 'Odospace 接收端口，通常是 38000',
      'settings.page': '面板页号',
      'settings.page.hint': 'AIDA64 直连手机时占 0，本插件用 1，两者不要相同',
      'settings.rows': '列表行数',
      'settings.rows.hint': '显示几个会话；填 0 变成单任务大字号视图',
      'settings.save': '保存并生效',
      'settings.saving': '保存中…',
      'settings.reset': '还原',
      'settings.saved': '已保存并立即生效',
      'settings.savedMemory': '已生效（未能写入配置文件，重启后会恢复旧值）',
      'settings.failed': '保存失败',
      'settings.unchanged': '没有改动',
      'settings.persistNote': '改动会写入插件配置并在下一个推送周期生效，无需重启。',
      'actions.push': '立即推一帧',
      'actions.preview': '刷新预览',
      'actions.pushing': '推送中…',
      'preview.title': '当前面板预览',
      'preview.hint': '按当前配置实时渲染，与推送给接收端的画面一致',
      'preview.empty': '还没有可用的帧',
      'tasks.title': '会话',
      'tasks.empty': '暂无会话',
      'tasks.current': '当前',
      'led.fail': '连接失败',
      'led.ask': '等待回答',
      'led.tool': '正在执行',
      'led.run': '正在思考',
      'led.done': '任务完成',
      'led.idle': '空闲',
      'meta.updated': '更新于',
      'meta.never': '从未',
      'error.route': '读不到面板状态：宿主路由不可用或已停用该插件。',
      'error.config': '在插件配置里设置 host 以开始推流。',
    };

    const en = {
      'panel': 'Odospace Panel',
      'title': 'Odospace Panel',
      'subtitle': 'Live dsh task progress pushed to an Odospace receiver',
      'status.on': 'Streaming',
      'status.off': 'No receiver configured',
      'status.error': 'Connection failed',
      'status.loading': 'Reading…',
      'status.dryrun': 'Render only',
      'config.receiver': 'Receiver',
      'config.page': 'Page',
      'config.size': 'Resolution',
      'config.view': 'View',
      'config.mode': 'Mode',
      'view.list': 'Task list',
      'view.single': 'Single task',
      'mode.blink': 'Blinking LEDs',
      'mode.static': 'Static',
      'stats.pushed': 'Pushed',
      'stats.rendered': 'Rendered',
      'stats.failed': 'Failed',
      'stats.uptime': 'Uptime',
      'stats.lastError': 'Last error',
      'settings.title': 'Settings',
      'settings.host': 'Push IP',
      'settings.host.hint': 'Receiver address (the phone running Remote Panel). Empty = do not stream.',
      'settings.port': 'Port',
      'settings.port.hint': 'Odospace receiver port, usually 38000',
      'settings.page': 'Panel page',
      'settings.page.hint': 'AIDA64 occupies page 0 when it connects to the phone directly; this plugin uses 1. Keep them different.',
      'settings.rows': 'List rows',
      'settings.rows.hint': 'How many sessions to show; 0 switches to the single-task large-type view',
      'settings.save': 'Save and apply',
      'settings.saving': 'Saving…',
      'settings.reset': 'Reset',
      'settings.saved': 'Saved and applied',
      'settings.savedMemory': 'Applied (could not write the config file; reverts on restart)',
      'settings.failed': 'Save failed',
      'settings.unchanged': 'No changes',
      'settings.persistNote': 'Changes are written to the plugin config and take effect on the next push cycle; no restart needed.',
      'actions.push': 'Push a frame',
      'actions.preview': 'Refresh preview',
      'actions.pushing': 'Pushing…',
      'preview.title': 'Current panel',
      'preview.hint': 'Rendered live from the current configuration, identical to what the receiver gets',
      'preview.empty': 'No frame yet',
      'tasks.title': 'Sessions',
      'tasks.empty': 'No sessions',
      'tasks.current': 'current',
      'led.fail': 'Connection failed',
      'led.ask': 'Waiting for you',
      'led.tool': 'Running a tool',
      'led.run': 'Thinking',
      'led.done': 'Done',
      'led.idle': 'Idle',
      'meta.updated': 'Updated',
      'meta.never': 'never',
      'error.route': 'Cannot read panel state: the host route is unavailable or the plugin is disabled.',
      'error.config': 'Set host in the plugin config to start streaming.',
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
      '[data-dsh-odospace] .odo-pane{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}',
      '[data-dsh-odospace] .odo-scroll{scrollbar-gutter:stable;flex:1;min-height:0;overflow:auto}',
      '[data-dsh-odospace] .odo-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}',
      '[data-dsh-odospace] .odo-heading{justify-content:space-between;align-items:center;gap:16px;',
      'margin-bottom:8px;padding-top:28px;display:flex;flex-wrap:wrap}',
      '[data-dsh-odospace][data-platform=darwin] .odo-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}',
      '[data-dsh-odospace] .odo-heading h1{flex:1;min-width:0;margin:0;font-size:20px;font-weight:500;line-height:28px}',
      '[data-dsh-odospace] .odo-actions{flex:none;align-items:center;gap:8px;display:flex}',
      '[data-dsh-odospace] .odo-btn{box-sizing:border-box;height:32px;border-radius:16px;padding:0 14px;',
      'display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;',
      'border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary);',
      'transition:background .15s,border-color .15s}',
      '[data-dsh-odospace] .odo-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '[data-dsh-odospace] .odo-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '[data-dsh-odospace] .odo-btn:disabled{opacity:.55;cursor:default}',
      '[data-dsh-odospace] .odo-btn[data-variant=primary]{background:var(--dsw-alias-state-business-primary);',
      'border-color:transparent;color:var(--dsw-alias-label-on-business,#fff)}',
      '[data-dsh-odospace] .odo-led-bar{flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 20px;display:flex;',
      'color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
      '[data-dsh-odospace] .odo-status{display:inline-flex;align-items:center;gap:6px;',
      'color:var(--dsw-alias-label-secondary);font-weight:500}',
      '[data-dsh-odospace] .odo-dot{width:8px;height:8px;border-radius:999px;flex:none;background:var(--dsw-alias-label-caption)}',
      // LED colours live in `data-led` and are literal: they must match the
      // pixels the receiver actually sees, not a themed accent.
      '[data-dsh-odospace] .odo-dot[data-led=fail]{background:#F87171}',
      '[data-dsh-odospace] .odo-dot[data-led=ask],[data-dsh-odospace] .odo-dot[data-led=tool]{background:#FB923C}',
      '[data-dsh-odospace] .odo-dot[data-led=run]{background:#60A5FA}',
      '[data-dsh-odospace] .odo-dot[data-led=done]{background:#4ADE80}',
      '[data-dsh-odospace] .odo-dot[data-led=idle]{background:#4F5968}',
      '[data-dsh-odospace] .odo-card{border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;',
      'padding:14px 16px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1)}',
      '[data-dsh-odospace] .odo-card h2{margin:0 0 10px;font-size:13px;font-weight:500;',
      'color:var(--dsw-alias-label-tertiary);line-height:20px}',
      '[data-dsh-odospace] .odo-hint{margin:0 0 10px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}',
      // The preview is the real rendered frame: black background, centred,
      // scaled to the card. `image-rendering:auto` keeps the JPEG smooth.
      '[data-dsh-odospace] .odo-shot{position:relative;width:100%;border-radius:12px;overflow:hidden;',
      'background:#05070B;display:flex;align-items:center;justify-content:center;',
      'aspect-ratio:var(--odo-aspect,15/8)}',
      '[data-dsh-odospace] .odo-shot img{display:block;width:100%;height:100%;object-fit:contain}',
      '[data-dsh-odospace] .odo-shot[data-empty=true]{color:var(--dsw-alias-label-caption);',
      'font-size:13px;background:var(--dsw-alias-bg-module-platform)}',
      '[data-dsh-odospace] .odo-grid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 16px;display:grid}',
      '[data-dsh-odospace] .odo-field{min-width:0;display:flex;flex-direction:column;gap:2px}',
      '[data-dsh-odospace] .odo-field dt{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;margin:0}',
      '[data-dsh-odospace] .odo-field dd{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;',
      'font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
      '[data-dsh-odospace] .odo-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}',
      '[data-dsh-odospace] .odo-row{border-radius:12px;padding:8px;display:flex;align-items:flex-start;gap:12px}',
      '[data-dsh-odospace] .odo-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '[data-dsh-odospace] .odo-row .odo-dot{margin-top:8px;width:10px;height:10px}',
      '[data-dsh-odospace] .odo-row-body{flex:1;min-width:0;display:flex;flex-direction:column}',
      '[data-dsh-odospace] .odo-row-title{text-overflow:ellipsis;white-space:nowrap;overflow:hidden;',
      'font-weight:500;line-height:23px}',
      '[data-dsh-odospace] .odo-row-sub{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:21px;',
      'text-overflow:ellipsis;white-space:nowrap;overflow:hidden}',
      '[data-dsh-odospace] .odo-row-meta{flex:none;display:flex;align-items:center;gap:8px;',
      'color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:23px;font-variant-numeric:tabular-nums}',
      '[data-dsh-odospace] .odo-tag{border-radius:999px;padding:0 8px;height:20px;display:inline-flex;',
      'align-items:center;font-size:12px;line-height:20px;background:var(--dsw-alias-bg-module-platform);',
      'color:var(--dsw-alias-label-secondary)}',
      '[data-dsh-odospace] .odo-empty{color:var(--dsw-alias-label-tertiary);padding:16px 4px;font-size:13px}',
      // Settings form: label + hint above the control, matching the host's
      // settings rows (a bordered field that lifts on hover and focuses with
      // the business colour). Fields use the same 16px radius as the cards.
      '[data-dsh-odospace] .odo-form{display:flex;flex-direction:column;gap:14px;margin:0}',
      '[data-dsh-odospace] .odo-input-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}',
      '[data-dsh-odospace] .odo-input{flex:1;min-width:110px;display:flex;flex-direction:column;gap:4px}',
      '[data-dsh-odospace] .odo-input label{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500}',
      '[data-dsh-odospace] .odo-input input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;',
      'border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base);',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;',
      'font-variant-numeric:tabular-nums;transition:border-color .15s}',
      '[data-dsh-odospace] .odo-input input:hover{border-color:var(--dsw-alias-border-l2)}',
      '[data-dsh-odospace] .odo-input input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      '[data-dsh-odospace] .odo-input input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}',
      '[data-dsh-odospace] .odo-input .odo-hint{margin:0;font-size:12px;line-height:18px}',
      '[data-dsh-odospace] .odo-form-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '[data-dsh-odospace] .odo-form-msg{font-size:13px;line-height:20px;color:var(--dsw-alias-state-success-primary)}',
      '[data-dsh-odospace] .odo-form-msg[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '[data-dsh-odospace] .odo-form-msg[data-tone=muted]{color:var(--dsw-alias-label-tertiary)}',
      '[data-dsh-odospace] .odo-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px;margin:0 0 12px}',
      '[data-dsh-odospace][data-state=stale] .odo-soft{opacity:.55}',
      // Sidebar glyph: inherits the row colour, so the active state comes free.
      '[data-dsh-odospace-icon]{display:block}',
      '@media (max-width:640px){[data-dsh-odospace] .odo-content{padding:0 16px 32px}',
      '[data-dsh-odospace] .odo-row-meta{display:none}}',
      '@media (prefers-reduced-motion:reduce){[data-dsh-odospace] .odo-btn{transition:none}}',
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
          'data-dsh-odospace-icon': '',
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

    /** One definition row: label above value. */
    function Field(props) {
      return h(
        'div',
        { className: 'odo-field' },
        h('dt', null, props.label),
        h('dd', null, props.value),
      );
    }

    /**
     * Poll the host route. Keeps the last good payload on screen (dimmed) when a
     * poll fails, so a reload in the host half never blanks the panel.
     */
    function usePanelState(refreshToken = 0) {
      const [state, setState] = React.useState({ phase: 'loading' });
      // Bumped by a settings save so the effect below re-runs and re-reads
      // immediately, instead of waiting out the poll interval.
      const [nonce, setNonce] = React.useState(0);
      React.useEffect(() => {
        if (refreshToken > 0) setNonce((value) => value + 1);
      }, [refreshToken]);

      React.useEffect(() => {
        let disposed = false;
        let timer;
        let controller;
        // Monotonic token so a superseded poll cannot publish its result or
        // clear the controller of the poll that replaced it.
        let generation = 0;

        const schedule = () => {
          if (timer !== undefined) clearTimeout(timer);
          if (disposed) return;
          timer = setTimeout(() => {
            void run();
          }, POLL_MS);
        };

        const run = async () => {
          if (disposed) return;
          if (document.visibilityState === 'hidden') {
            schedule();
            return;
          }
          const mine = ++generation;
          try {
            controller?.abort();
          } catch {
            /* already settled */
          }
          const local = new AbortController();
          controller = local;
          const abortTimer = setTimeout(() => {
            try {
              local.abort();
            } catch {
              /* already settled */
            }
          }, REQUEST_TIMEOUT_MS);
          try {
            const response = await fetch(API, {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { accept: 'application/json' },
              signal: local.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (disposed || mine !== generation) return;
            if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
              throw new Error('unexpected payload');
            }
            setState({ phase: 'ok', data: payload });
          } catch {
            if (disposed || mine !== generation) return;
            setState((previous) =>
              previous.data === undefined
                ? { phase: 'error' }
                : { phase: 'stale', data: previous.data },
            );
          } finally {
            clearTimeout(abortTimer);
            if (mine === generation) {
              controller = undefined;
              schedule();
            }
          }
        };

        const onVisibility = () => {
          if (document.visibilityState !== 'visible') return;
          if (timer !== undefined) clearTimeout(timer);
          void run();
        };

        document.addEventListener('visibilitychange', onVisibility);
        void run();
        return () => {
          disposed = true;
          if (timer !== undefined) clearTimeout(timer);
          document.removeEventListener('visibilitychange', onVisibility);
          try {
            controller?.abort();
          } catch {
            /* already settled */
          }
        };
      }, [nonce]);

      return state;
    }


    /**
     * Runtime settings: push IP, port, panel page, and list rows.
     *
     * These four are the fields users actually retune day to day, so they get a
     * form that writes through the host route and applies immediately — the
     * Host half persists them to the profile patch layer and hot-swaps the live
     * bridge, so no restart is involved.
     *
     * Inputs are plain controlled fields with the draft kept in local state:
     * typing must not fire a request per keystroke, and a rejected value must
     * leave the last good configuration untouched.
     */
    function SettingsForm(props) {
      const t = props.t;
      const current = props.settings;
      const reject = Number.isNaN;

      const [draft, setDraft] = React.useState(() => ({
        host: String(current?.host ?? ''),
        port: String(current?.port ?? 38000),
        page: String(current?.page ?? 1),
        tasks: String(current?.tasks ?? 4),
      }));
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState(undefined);

      // Re-seed the draft whenever the server reports a different configuration
      // (first load, or another tab saved), so the form never shows stale values.
      React.useEffect(() => {
        if (current === undefined) return;
        setDraft((previous) => {
          const next = {
            host: String(current.host ?? ''),
            port: String(current.port ?? 38000),
            page: String(current.page ?? 1),
            tasks: String(current.tasks ?? 4),
          };
          const same = Object.keys(next).every((key) => previous[key] === next[key]);
          return same ? previous : next;
        });
      }, [current?.host, current?.port, current?.page, current?.tasks]);

      const set = (key) => (event) => {
        setDraft((previous) => ({ ...previous, [key]: event.target.value }));
        setMessage(undefined);
      };

      /** Parse one numeric field; undefined = invalid (also for missing input). */
      const toNumber = (text, min, max) => {
        if (typeof text !== 'string' && typeof text !== 'number') return undefined;
        const raw = String(text);
        const value = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(value)) return undefined;
        const rounded = Math.trunc(value);
        if (rounded < min || rounded > max) return undefined;
        return rounded;
      };

      const port = toNumber(draft.port, 1, 65535);
      const page = toNumber(draft.page, 0, 9);
      const rows = toNumber(draft.tasks, 0, 8);
      const valid = !reject(port) && port !== undefined && page !== undefined && rows !== undefined;

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
            body: JSON.stringify({ host: draft.host.trim(), port, page, tasks: rows }),
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
          props.onSaved?.();
        } catch (error) {
          setMessage({ tone: 'error', text: `${t('settings.failed')}: ${String(error?.message ?? error)}` });
        } finally {
          setSaving(false);
        }
      };

      const reset = () => {
        setDraft({
          host: String(current?.host ?? ''),
          port: String(current?.port ?? 38000),
          page: String(current?.page ?? 1),
          tasks: String(current?.tasks ?? 4),
        });
        setMessage(undefined);
      };

      const field = (key, label, hint, min, max, extra = {}) =>
        h(
          'div',
          { className: 'odo-input' },
          h('label', { htmlFor: `odo-${key}` }, label),
          h('input', {
            id: `odo-${key}`,
            type: extra.type ?? 'text',
            inputMode: extra.type === 'number' ? 'numeric' : undefined,
            value: draft[key],
            onChange: set(key),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void save();
            },
            'aria-invalid': extra.invalid === true ? 'true' : undefined,
            ...(extra.type === 'number' ? { min, max, step: 1 } : {}),
            spellCheck: false,
            autoComplete: 'off',
          }),
          hint === undefined ? null : h('p', { className: 'odo-hint' }, hint),
        );

      return h(
        'div',
        { className: 'odo-card' },
        h('h2', null, t('settings.title')),
        h('p', { className: 'odo-hint' }, t('settings.persistNote')),
        h(
          'div',
          { className: 'odo-form' },
          h(
            'div',
            { className: 'odo-input-row' },
            field('host', t('settings.host'), t('settings.host.hint')),
          ),
          h(
            'div',
            { className: 'odo-input-row' },
            field('port', t('settings.port'), t('settings.port.hint'), 1, 65535, {
              type: 'number',
              invalid: port === undefined,
            }),
            field('page', t('settings.page'), t('settings.page.hint'), 0, 9, {
              type: 'number',
              invalid: page === undefined,
            }),
            field('tasks', t('settings.rows'), t('settings.rows.hint'), 0, 8, {
              type: 'number',
              invalid: rows === undefined,
            }),
          ),
          h(
            'div',
            { className: 'odo-form-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'odo-btn',
                'data-variant': 'primary',
                onClick: () => void save(),
                disabled: saving || !valid,
              },
              saving ? t('settings.saving') : t('settings.save'),
            ),
            h('button', { type: 'button', className: 'odo-btn', onClick: reset, disabled: saving },
              t('settings.reset')),
            message === undefined
              ? null
              : h(
                  'span',
                  { className: 'odo-form-msg', 'data-tone': message.tone === 'ok' ? 'saved' : message.tone },
                  message.text,
                ),
          ),
        ),
      );
    }

    /**
     * The panel page.
     *
     * Layout follows the host's management pages (a centred 960px column with a
     * 20px page heading) so it reads as part of the application rather than a
     * bolt-on. The preview card shows the exact JPEG the receiver gets.
     */
    function OdospacePage(props) {
      const t = props.t;
      const [refreshToken, setRefreshToken] = React.useState(0);
      const state = usePanelState(refreshToken);
      const [frame, setFrame] = React.useState({ loading: true, url: undefined, at: 0 });
      const [pushing, setPushing] = React.useState(false);
      const [pushMessage, setPushMessage] = React.useState('');

      const data = state.data;
      const config = data?.config;
      const stats = data?.stats;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const tally = data?.tally;
      const configured = typeof config?.host === 'string' && config.host !== '';

      // The preview is its own request: the reverse of the JPEG also proves the
      // route and the canvas binding work, which the JSON payload cannot.
      const loadFrame = React.useCallback(async () => {
        if (!configured) {
          setFrame({ loading: false, url: undefined, at: 0 });
          return;
        }
        try {
          const response = await fetch(`${API}/preview`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setFrame((previous) => {
            if (previous.url !== undefined) URL.revokeObjectURL(previous.url);
            return { loading: false, url, at: Date.now() };
          });
        } catch {
          setFrame((previous) => ({ loading: false, url: previous.url, at: previous.at }));
        }
      }, [configured]);

      React.useEffect(() => {
        void loadFrame();
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') void loadFrame();
        }, POLL_MS * 2);
        return () => clearInterval(timer);
      }, [loadFrame]);

      // Release the last object URL when the page unmounts.
      React.useEffect(
        () => () => {
          setFrame((previous) => {
            if (previous.url !== undefined) URL.revokeObjectURL(previous.url);
            return previous;
          });
        },
        [],
      );

      /** Called after the settings form saved: re-read state and re-render the preview. */
      const onSettingsSaved = () => {
        setRefreshToken((value) => value + 1);
        void loadFrame();
      };

      const pushNow = async () => {
        setPushing(true);
        setPushMessage('');
        try {
          const response = await fetch(`${API}/push`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`);
          setPushMessage(`${formatBytes(payload.bytes)}`);
          await loadFrame();
        } catch (error) {
          setPushMessage(String(error?.message ?? error));
        } finally {
          setPushing(false);
        }
      };

      const ledLabel = (led) => {
        const key = `led.${led}`;
        const text = t(key);
        return text === key ? led : text;
      };

      const statusText =
        state.phase === 'loading'
          ? t('status.loading')
          : state.phase === 'error'
            ? t('status.error')
            : config?.dryRun === true
              ? t('status.dryrun')
              : configured
                ? t('status.on')
                : t('status.off');
      const statusLed = state.phase === 'error' ? 'fail' : configured ? 'done' : 'idle';

      const aspect = config?.width > 0 && config?.height > 0
        ? { '--odo-aspect': `${config.width} / ${config.height}` }
        : undefined;

      return h(
        'section',
        {
          'data-dsh-odospace': '',
          'data-state': state.phase,
          'aria-label': t('title'),
        },
        h(
          'div',
          { className: 'odo-pane' },
          h(
            'div',
            { className: 'odo-scroll' },
            h(
              'div',
              { className: 'odo-content' },
              h(
                'div',
                { className: 'odo-heading' },
                h('h1', null, t('title')),
                h(
                  'div',
                  { className: 'odo-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'odo-btn',
                      onClick: () => void loadFrame(),
                      disabled: !configured,
                    },
                    t('actions.preview'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'odo-btn',
                      'data-variant': 'primary',
                      onClick: () => void pushNow(),
                      disabled: !configured || pushing,
                    },
                    pushing ? t('actions.pushing') : t('actions.push'),
                  ),
                ),
              ),

              // Status strip: one line, LED + state + summary counters.
              h(
                'div',
                { className: 'odo-led-bar' },
                h(
                  'span',
                  { className: 'odo-status' },
                  h('span', { className: 'odo-dot', 'data-led': statusLed, 'aria-hidden': 'true' }),
                  statusText,
                ),
                stats === undefined
                  ? null
                  : h('span', { className: 'odo-soft' },
                      `${t('stats.pushed')} ${stats.pushed}`,
                      ` · ${t('stats.rendered')} ${stats.rendered}`,
                      stats.pushErrors > 0 ? ` · ${t('stats.failed')} ${stats.pushErrors}` : '',
                      ` · ${t('stats.uptime')} ${formatUptime(stats.uptimeMs)}`,
                    ),
                config === undefined
                  ? null
                  : h('span', null,
                      `${t('config.receiver')} ${configured ? `${config.host}:${config.port}` : '—'}`,
                      ` · ${t('config.page')} ${config.page}`,
                      ` · ${config.width}×${config.height}`,
                    ),
                pushMessage === '' ? null : h('span', null, pushMessage),
              ),

              state.phase === 'error'
                ? h('p', { className: 'odo-error' }, t('error.route'))
                : null,
              state.phase === 'ok' && !configured
                ? h('p', { className: 'odo-error' }, t('error.config'))
                : null,

              // Live preview of the exact frame the receiver gets.
              h(
                'div',
                { className: 'odo-card' },
                h('h2', null, t('preview.title')),
                h('p', { className: 'odo-hint' }, t('preview.hint')),
                configured && frame.url !== undefined
                  ? h(
                      'div',
                      { className: 'odo-shot', style: aspect },
                      h('img', {
                        src: frame.url,
                        alt: t('preview.title'),
                        draggable: false,
                      }),
                    )
                  : h('div', { className: 'odo-shot', 'data-empty': 'true' }, t('preview.empty')),
              ),

              // Configuration summary: the values that decide what is rendered.
              config === undefined
                ? null
                : h(
                    'div',
                    { className: 'odo-card' },
                    h('h2', null, t('config.receiver')),
                    h(
                      'dl',
                      { className: 'odo-grid', style: { margin: 0 } },
                      h(Field, {
                        label: t('config.view'),
                        value: config.tasks > 0 ? `${t('view.list')} · ${config.tasks}` : t('view.single'),
                      }),
                      h(Field, {
                        label: t('config.mode'),
                        value: config.fps > 0 ? `${t('mode.blink')} · ${config.fps}` : t('mode.static'),
                      }),
                      h(Field, { label: 'JPEG', value: `q${config.quality}` }),
                      h(Field, { label: t('stats.failed'), value: String(stats?.pushErrors ?? 0) }),
                      h(Field, {
                        label: t('meta.updated'),
                        value:
                          stats?.lastPushAt > 0
                            ? new Date(stats.lastPushAt).toLocaleTimeString()
                            : t('meta.never'),
                      }),
                      h(Field, {
                        label: t('stats.lastError'),
                        value: stats?.lastError ?? '—',
                      }),
                    ),
                  ),

              // Runtime settings: push IP / port / page / list rows.
              h(SettingsForm, {
                t,
                settings: config,
                onSaved: onSettingsSaved,
              }),

              // The same task list that is on the panel, with its LED state.
              h(
                'div',
                { className: 'odo-card' },
                h('h2', null, t('tasks.title')),
                tasks.length === 0
                  ? h('div', { className: 'odo-empty' }, t('tasks.empty'))
                  : h(
                      'ul',
                      { className: 'odo-list' },
                      tasks.map((task, index) =>
                        h(
                          'li',
                          { className: 'odo-row', key: `${task.sessionId ?? index}` },
                          h('span', {
                            className: 'odo-dot',
                            'data-led': task.ledState,
                            'aria-hidden': 'true',
                          }),
                          h(
                            'span',
                            { className: 'odo-row-body' },
                            h('span', { className: 'odo-row-title' }, task.title || task.sessionId || '—'),
                            h(
                              'span',
                              { className: 'odo-row-sub' },
                              task.current ?? '',
                            ),
                          ),
                          h(
                            'span',
                            { className: 'odo-row-meta' },
                            Number.isFinite(task.contextPercent)
                              ? h('span', null, `${Math.round(task.contextPercent)}%`)
                              : null,
                            h('span', { className: 'odo-tag' }, ledLabel(task.ledState)),
                          ),
                        ),
                      ),
                    ),
              ),

              tally === undefined
                ? null
                : h(
                    'div',
                    { className: 'odo-led-bar' },
                    h('span', null, `${t('led.fail')} ${tally.fail}`),
                    h('span', null, `${t('led.ask')} ${tally.ask}`),
                    h('span', null, `${t('led.tool')} ${tally.tool}`),
                    h('span', null, `${t('led.run')} ${tally.run}`),
                    h('span', null, `${t('led.done')} ${tally.done}`),
                    h('span', null, `${t('led.idle')} ${tally.idle}`),
                    h('span', null, formatBytes(stats?.lastPushedBytes)),
                  ),
            ),
          ),
        ),
      );
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'dsh-odospace: styles');
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-odospace: locale');

      // Sidebar entry: the icon alone occupies `sidebar.panellist`; the sidebar
      // owns the row, its label, its active state, and panel selection.
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            locale: NS,
            label: () => ctx.locale.bind(NS)('panel'),
          },
          OdospaceIcon,
        ),
      );

      // The page itself, keyed by the same panel id the sidebar entry selects.
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            label: () => ctx.locale.bind(NS)('title'),
          },
          OdospacePage,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.OdospacePage = OdospacePage;
    exports.OdospaceIcon = OdospaceIcon;
    return module.exports;
  },
});
