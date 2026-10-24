window.__ModuleLoader__.load({
  id: "dsh-self-use",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    // #region dsh-self-use: constants
    const PLUGIN_ID = "dsh-self-use";
    const PREFS_KEY = "dsh-self-use:prefs.v1";
    const PREV_PRESET_KEY = "dsh-self-use:prev-preset.v1";
    const PREFS_EVENT = "dsh-self-use:prefs";
    const STYLE_ID = "dsh-self-use";
    const PERMISSION_NS = "permission";
    const FULL_ACCESS_PRESET = "danger-full-access";
    const FALLBACK_PREV_PRESET = "workspace-write";
    const PREFS_FIELDS = ["autoFullAccess", "stickyPrompt", "promptSearch", "autoCleanup", "hideSubagentMentions", "fileManager", "imageRescue"];
    const PREFS_MINUTES_FIELD = "autoCleanupMinutes";
    const PREFS_SKILLS_FIELD = "autoSkills";
    const AUTO_CLEANUP_MINUTES_DEFAULT = 60;
    const FILE_REFRESH_CHOICES = [
      { value: 0, label: "不自动刷新" },
      { value: 2000, label: "每 2 秒" },
      { value: 5000, label: "每 5 秒" },
      { value: 10000, label: "每 10 秒" },
      { value: 30000, label: "每 30 秒" }
    ];
    const AUTO_CLEANUP_MINUTES_MIN = 1;
    const AUTO_CLEANUP_MINUTES_MAX = 10080;
    const API_PREFIX = "/api/dsh-self-use";
    const SEARCH_RESULT_LIMIT = 200;
    const SUBAGENT_FILTER_MARK = "__dshSelfUseSubagentFilter";
    const SUBAGENT_FILTER_ORIGINAL = "__dshSelfUseSubagentOriginal";
    const SKILL_FILTER_MARK = "__dshSelfUseSkillFilter";
    const SKILL_FILTER_ORIGINAL = "__dshSelfUseSkillOriginal";
    const SKILL_NAME_PATTERN = /^[\w-]+$/;
    const AUTO_SKILLS_LIMIT = 50;
    const AUTO_SKILLS_PATH = "/auto-skills";
    // #endregion

    // #region dsh-self-use: logging
    function warn(message, error) {
      console.warn("[dsh-self-use] " + message, error);
    }

    function clampQuestionWaitMinutes(value) {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) return 10;
      const rounded = Math.round(number);
      if (rounded < 1) return 1;
      if (rounded > 1440) return 1440;
      return rounded;
    }

    function clampMinutes(value) {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) return AUTO_CLEANUP_MINUTES_DEFAULT;
      const rounded = Math.floor(number);
      if (rounded < AUTO_CLEANUP_MINUTES_MIN) return AUTO_CLEANUP_MINUTES_MIN;
      if (rounded > AUTO_CLEANUP_MINUTES_MAX) return AUTO_CLEANUP_MINUTES_MAX;
      return rounded;
    }

    function errorText(error) {
      if (typeof error === "string" && error !== "") return error;
      if (error !== null && typeof error === "object" && typeof error.message === "string" && error.message !== "") {
        return error.message;
      }
      return "操作失败";
    }
    // #endregion

    // #region dsh-self-use: preferences (localStorage + CustomEvent)
    function defaultPrefs() {
      return {
        autoFullAccess: false,
        stickyPrompt: false,
        promptSearch: false,
        autoCleanup: false,
        hideSubagentMentions: false,
        autoCleanupMinutes: AUTO_CLEANUP_MINUTES_DEFAULT,
        autoSkills: [],
        fileManager: false,
        fileRefreshMs: 5000,
        imageRescue: true
      };
    }

    // 名单统一规范化：只保留符合 skill 命名的非空字符串，去重并按上限截断。
    function normalizeSkillNames(value) {
      const list = Array.isArray(value) ? value : [];
      const out = [];
      for (let index = 0; index < list.length; index += 1) {
        const name = typeof list[index] === "string" ? list[index] : "";
        if (name === "" || SKILL_NAME_PATTERN.test(name) !== true) continue;
        if (out.indexOf(name) >= 0) continue;
        if (out.length >= AUTO_SKILLS_LIMIT) break;
        out.push(name);
      }
      return out;
    }

    function readPrefs() {
      const prefs = defaultPrefs();
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (typeof raw === "string" && raw !== "") {
          const parsed = JSON.parse(raw);
          if (parsed !== null && typeof parsed === "object") {
            for (let index = 0; index < PREFS_FIELDS.length; index += 1) {
              const field = PREFS_FIELDS[index];
              if (typeof parsed[field] === "boolean") prefs[field] = parsed[field];
            }
            if (typeof parsed[PREFS_MINUTES_FIELD] === "number") {
              prefs[PREFS_MINUTES_FIELD] = clampMinutes(parsed[PREFS_MINUTES_FIELD]);
            }
            if (Array.isArray(parsed[PREFS_SKILLS_FIELD])) {
              prefs[PREFS_SKILLS_FIELD] = normalizeSkillNames(parsed[PREFS_SKILLS_FIELD]);
            }
            if (typeof parsed.fileRefreshMs === "number") {
              prefs.fileRefreshMs = parsed.fileRefreshMs;
            }
          }
        }
      } catch (error) {
        warn("读取偏好失败", error);
      }
      return prefs;
    }

    function writePrefs(patch) {
      const current = readPrefs();
      const next = defaultPrefs();
      const source = patch !== null && typeof patch === "object" ? patch : {};
      for (let index = 0; index < PREFS_FIELDS.length; index += 1) {
        const field = PREFS_FIELDS[index];
        const incoming = typeof source[field] === "boolean" ? source[field] : current[field];
        next[field] = incoming === true;
      }
      next[PREFS_MINUTES_FIELD] = clampMinutes(
        source[PREFS_MINUTES_FIELD] !== undefined ? source[PREFS_MINUTES_FIELD] : current[PREFS_MINUTES_FIELD]
      );
      // 数组字段单独处理，不参与上面的 boolean 循环。
      next[PREFS_SKILLS_FIELD] = normalizeSkillNames(
        source[PREFS_SKILLS_FIELD] !== undefined ? source[PREFS_SKILLS_FIELD] : current[PREFS_SKILLS_FIELD]
      );
      next.fileRefreshMs =
        typeof source.fileRefreshMs === "number" ? source.fileRefreshMs : current.fileRefreshMs;
      next.updatedAt = Date.now();
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch (error) {
        warn("保存偏好失败", error);
      }
      try {
        window.dispatchEvent(new CustomEvent(PREFS_EVENT));
      } catch (error) {
        warn("广播偏好变更失败", error);
      }
      // 同步到 Host，让其它源（局域网地址）读到同一份设置。
      prefsSynced = true;
      pushPrefsToHost(next);
      return next;
    }

    // localStorage 按源隔离：127.0.0.1:3080 与 192.168.x:3090 互不相通，
    // 所以把偏好同时存到 Host 侧，跨源共用同一份设置。
    let prefsSynced = false;

    /** 本地存的 updatedAt；没有则视为 0（旧版本写入的）。 */
    function localPrefsUpdatedAt() {
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (typeof raw !== "string" || raw === "") return 0;
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" && typeof parsed.updatedAt === "number"
          ? parsed.updatedAt
          : 0;
      } catch (_) {
        return 0;
      }
    }

    /**
     * 技能白名单也跨源共享：它存在 Host 的 auto-skills.json，
     * 换源打开时本地 prefs.autoSkills 是空的，必须从 Host 补回来。
     */
    function syncSkillsFromHost() {
      return getJson(AUTO_SKILLS_PATH).then(
        (result) => {
          if (result.ok !== true) return readPrefs();
          const remote =
            result.data.skills !== null && Array.isArray(result.data.skills) ? result.data.skills : null;
          if (remote === null) return readPrefs();
          const current = readPrefs();
          const remoteNames = normalizeSkillNames(remote);
          const currentNames = normalizeSkillNames(current.autoSkills);
          if (currentNames.join(",") === remoteNames.join(",")) return current;
          // Host 有内容、本地为空：从 Host 恢复。本地有内容则不覆盖。
          if (remoteNames.length > 0 && currentNames.length === 0) {
            writePrefs({ autoSkills: remoteNames });
            return readPrefs();
          }
          if (currentNames.length > 0 && remoteNames.length === 0) {
            pushAutoSkills(currentNames);
            return current;
          }
          return current;
        },
        () => readPrefs()
      );
    }

    /** 是否是「从未真正配置过」的全默认值。 */
    function isDefaultPrefs(prefs) {
      if (prefs === null || typeof prefs !== "object") return true;
      for (let index = 0; index < PREFS_FIELDS.length; index += 1) {
        if (prefs[PREFS_FIELDS[index]] === true) return false;
      }
      if (prefs[PREFS_MINUTES_FIELD] !== AUTO_CLEANUP_MINUTES_DEFAULT) return false;
      const skills = Array.isArray(prefs[PREFS_SKILLS_FIELD]) ? prefs[PREFS_SKILLS_FIELD] : [];
      return skills.length === 0;
    }

    function applyRemotePrefs(remote) {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(remote));
      } catch (error) {
        warn("写入同步偏好失败", error);
      }
      try {
        window.dispatchEvent(new CustomEvent(PREFS_EVENT));
      } catch (_) {}
      return readPrefs();
    }

    /**
     * 与 Host 对齐偏好。
     * 合并规则（避免用空默认值覆盖用户已有配置）：
     *   1. Host 是全默认值、本地有真实配置 -> 把本地推上去
     *   2. Host 更新时间更新 -> 拉下来
     *   3. 否则 -> 把本地推上去
     */
    function syncPrefsFromHost() {
      return getJson("/prefs").then(
        (result) => {
          if (result.ok !== true) return readPrefs();
          const remote =
            result.data.prefs !== null && typeof result.data.prefs === "object" ? result.data.prefs : null;
          if (remote === null) return readPrefs();
          const local = readPrefs();
          const localAt = localPrefsUpdatedAt();
          const remoteAt = typeof remote.updatedAt === "number" ? remote.updatedAt : 0;
          const remoteIsDefault = isDefaultPrefs(remote);
          const localIsDefault = isDefaultPrefs(local);

          // 本地有真实配置、Host 还是空默认值：别让默认值把用户配置冲掉。
          if (remoteIsDefault === true && localIsDefault !== true) {
            prefsSynced = true;
            pushPrefsToHost(local);
            return local;
          }
          // Host 更新（或本地从未写过）：以 Host 为准。
          if (remoteAt > localAt || localAt === 0) {
            prefsSynced = true;
            return applyRemotePrefs(remote);
          }
          // 本地更新：推上去。
          prefsSynced = true;
          pushPrefsToHost(local);
          return local;
        },
        () => readPrefs()
      );
    }

    /** 把当前偏好推到 Host，供其它源读取。 */
    function pushPrefsToHost(prefs) {
      return postJson("/prefs", prefs).then(
        () => true,
        () => false
      );
    }

    function subscribePrefs(listener) {
      const onChange = () => {
        try {
          listener(readPrefs());
        } catch (error) {
          warn("偏好监听回调失败", error);
        }
      };
      window.addEventListener(PREFS_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(PREFS_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    }

    // #endregion

    // #region dsh-self-use: draft image rescue

    const IMAGE_RESCUE_MAX_PER_SESSION = 10;
    const IMAGE_RESCUE_MAX_BYTES = 8 * 1024 * 1024;
    const IMAGE_RESCUE_ATTR = "data-dsh-self-use-img-rescue";
    // sessionId -> [{ blob, name, type, at }]
    const imageRescueStore = new Map();

    function rescueSessionIdFromUrl() {
      try {
        const match = window.location.pathname.match(/\/session\/([^/?#]+)/);
        if (match !== null) return decodeURIComponent(match[1]);
      } catch (_) {}
      return "";
    }

    function storeRescuedImage(sessionId, file) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (file === null || typeof file !== "object") return;
      if (file.size > IMAGE_RESCUE_MAX_BYTES) return;
      let bucket = imageRescueStore.get(sessionId);
      if (bucket === undefined) {
        bucket = [];
        imageRescueStore.set(sessionId, bucket);
      }
      bucket.push({ blob: file, name: file.name || "image.png", type: file.type || "image/png", at: Date.now() });
      while (bucket.length > IMAGE_RESCUE_MAX_PER_SESSION) bucket.shift();
    }

    function rescuedImagesFor(sessionId) {
      const bucket = imageRescueStore.get(sessionId);
      return Array.isArray(bucket) ? bucket : [];
    }

    function isImageFile(file) {
      return file !== null && typeof file === "object" && typeof file.type === "string" && file.type.startsWith("image/");
    }

    /** 记录粘贴进输入框的图片，供切回会话时恢复。 */
    function onComposerPaste(event) {
      if (readPrefs().imageRescue !== true) return;
      const data = event !== null && typeof event === "object" ? event.clipboardData : null;
      if (data === null || typeof data !== "object") return;
      const files = data.files;
      if (files === null || typeof files !== "object" || typeof files.length !== "number") return;
      const sessionId = rescueSessionIdFromUrl();
      if (sessionId === "") return;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (isImageFile(file) !== true) continue;
        storeRescuedImage(sessionId, file);
      }
    }

    /** 把缓存的图片重新放回输入框。 */
    function restoreImagesIntoComposer(sessionId) {
      const items = rescuedImagesFor(sessionId);
      if (items.length === 0) return false;
      const input = document.querySelector("[data-composer-input]");
      if (input === null) return false;
      const dt = new DataTransfer();
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        try {
          const file = new File([item.blob], item.name, { type: item.type });
          dt.items.add(file);
        } catch (_) {}
      }
      if (dt.items.length === 0) return false;
      const paste = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      input.dispatchEvent(paste);
      return true;
    }

    function installImageRescue() {
      const onPaste = (event) => {
        try {
          onComposerPaste(event);
        } catch (_) {}
      };
      document.addEventListener("paste", onPaste, true);
      let lastSession = rescueSessionIdFromUrl();
      const timer = setInterval(() => {
        const now = rescueSessionIdFromUrl();
        if (now === lastSession) return;
        lastSession = now;
        if (readPrefs().imageRescue !== true) return;
        if (now === "") return;
        // 切回一个有缓存图的会话时补回去。
        setTimeout(() => {
          try {
            restoreImagesIntoComposer(now);
          } catch (_) {}
        }, 300);
      }, 400);
      return () => {
        document.removeEventListener("paste", onPaste, true);
        clearInterval(timer);
      };
    }

    // #endregion


    // #region dsh-self-use: file manager enhancement

    /** 跨平台路径工具：Windows 用 \\ 和盘符，POSIX 用 /。 */
    const PATH_SEP_RE = /[\\/]/;

    /** 取路径最后一段。 */
    function pathBaseName(value) {
      const text = String(value === null || value === undefined ? "" : value);
      const parts = text.split(PATH_SEP_RE).filter((part) => part !== "");
      return parts.length === 0 ? text : parts[parts.length - 1];
    }

    /** 取父目录；已是根时返回自身。 */
    function pathDirName(value) {
      let text = String(value === null || value === undefined ? "" : value);
      if (text === "") return "/";
      if (text.length > 1 && PATH_SEP_RE.test(text.slice(-1))) {
        const trimmed = text.replace(/[\\/]+$/, "");
        text = trimmed === "" ? "/" : /^[A-Za-z]:$/.test(trimmed) ? trimmed + "\\" : trimmed;
      }
      if (pathIsRoot(text)) return text;
      const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
      if (index < 0) return text;
      const head = text.slice(0, index);
      if (head === "") return "/";
      if (/^[A-Za-z]:$/.test(head)) return head + "\\";
      return head;
    }

    /** 是否是某个平台的根目录。 */
    function pathIsRoot(value) {
      const text = String(value === null || value === undefined ? "" : value);
      if (text === "/") return true;
      if (/^[A-Za-z]:[\\/]?$/.test(text)) return true;
      return /^\\\\[^\\/]+[\\/][^\\/]+[\\/]?$/.test(text);
    }

    const FILES_TAB_ATTR = "data-files-state";
    const FILES_ROOT_ATTR = "data-files-root";
    const FILES_BODY_ATTR = "data-files-body";
    const FILE_ROW_ATTR = "data-files-path";
    const FILE_ENTRY_ATTR = "data-files-entry";
    const FM_ACTION_ATTR = "data-dsh-self-use-fm";
    const FM_INSTALLED_ATTR = "data-dsh-self-use-fm-ready";
    const FM_NAV_ATTR = "data-dsh-self-use-fm-nav";

    function fileManagerEnabled() {
      return readPrefs().fileManager === true;
    }

    function fileRefreshMs() {
      const value = readPrefs().fileRefreshMs;
      return typeof value === "number" ? value : 5000;
    }

    function filesRootElement() {
      const nodes = document.querySelectorAll("[" + FILES_TAB_ATTR + '="tree"]');
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.isConnected === true) return node;
      }
      return null;
    }

    /** 官方 sidebar-files 的 CSS Module 类名（含哈希），复用它保证视觉与原生行一致。 */
    const FM_CLASS = {
      item: "k-1LKG_item",
      row: "k-1LKG_row",
      name: "k-1LKG_name",
      icon: "k-1LKG_icon",
      fileIcon: "k-1LKG_fileIcon",
      level: "k-1LKG_level",
      body: "k-1LKG_body"
    };

    const FM_ICON_PATH = {
      folder: "M3 7a1 1 0 0 1 1-1h4l1.5 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z",
      file: "M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 0v5h5",
      trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7m3 4v6m4-6v6",
      copy: "M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1",
      download: "M12 4v10m0 0l-4-4m4 4l4-4M5 18h14",
      up: "M12 19V5m0 0l-6 6m6-6l6 6"
    };

    function makeSvg(d, size, stroke) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", stroke || "1.6");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
      return svg;
    }

    function makeFmIcon(kind) {
      if (kind === "folder" || kind === "file") return makeSvg(FM_ICON_PATH[kind], 16, "1.5");
      return makeSvg(FM_ICON_PATH[kind], 14, "1.7");
    }

    function makeFmButton(kind, label, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dsh-self-use-fm-btn";
      button.setAttribute(FM_ACTION_ATTR, kind);
      button.setAttribute("aria-label", label);
      button.title = label;
      button.appendChild(makeFmIcon(kind));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      });
      return button;
    }

    function copyText(text) {
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(text);
          return true;
        }
      } catch (_) {}
      try {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        return true;
      } catch (_) {
        return false;
      }
    }

    async function deleteEntry(entryPath, root) {
      const name = pathBaseName(entryPath);
      const agreed = window.confirm("永久删除「" + name + "」？此操作不可撤销。");
      if (agreed !== true) return;
      const result = await postJson("/files/delete", { path: entryPath });
      if (result.ok !== true) {
        window.alert("删除失败：" + result.error);
        return;
      }
      const payloadError = result.data !== null && typeof result.data === "object" && result.data.ok === false;
      if (payloadError === true) {
        window.alert("删除失败：" + String(result.data.error || "未知错误"));
        return;
      }
      if (root !== null && root !== undefined) requestReload(root);
    }

    function downloadEntry(entryPath) {
      const href = API_PREFIX + "/files/download?path=" + encodeURIComponent(entryPath);
      const link = document.createElement("a");
      link.href = href;
      link.rel = "noopener";
      link.download = "";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    const FILE_ADDRESS_PREFIX = "dsh-resource://file/";

    /** 与官方 fileAddressFor 等价：把绝对路径转成 dsh-resource 地址。 */
    function fileAddressFor(sessionId, cwd, targetPath) {
      const normalized = String(targetPath).replace(/\\/g, "/");
      const root = typeof cwd === "string" ? cwd.replace(/\\/g, "/").replace(/\/+$/, "") : "";
      const encodeSegment = (value) => encodeURIComponent(value);
      const encodePath = (value) => value.split("/").map(encodeSegment).join("/");
      let relative = normalized;
      if (root !== "" && normalized === root) relative = "";
      else if (root !== "" && normalized.startsWith(root + "/")) relative = normalized.slice(root.length + 1);
      return FILE_ADDRESS_PREFIX + "session/" + encodeSegment(sessionId) + "/" + encodePath(relative);
    }

    /** 取当前会话 id：URL 优先，其次 DOM 上的 data-conversation-session。 */
    function previewSessionId() {
      const fromUrl = rescueSessionIdFromUrl();
      if (fromUrl !== "") return fromUrl;
      try {
        return currentSessionId();
      } catch (_) {
        return "";
      }
    }

    /** 用官方的 sidebarRight.openResource 打开预览，行为与未开启增强时一致。 */
    function openFilePreview(root, entryPath) {
      // 首选：点官方行自带的按钮。它绑定的 tabActions 按会话解析，最可靠，
      // 且不依赖 sidebarRight 服务是否已就绪。
      const official = root.querySelector("[data-dsh-self-use-fm-official]");
      if (official !== null) {
        const rows = official.querySelectorAll("li[" + FILE_ROW_ATTR + "]");
        for (let i = 0; i < rows.length; i += 1) {
          if (rows[i].getAttribute(FILE_ROW_ATTR) !== entryPath) continue;
          const button = rows[i].querySelector("button");
          if (button !== null && typeof button.click === "function") {
            button.click();
            return true;
          }
        }
      }
      // 兜底：直接调服务。服务可能晚于 apply 就绪，点击时再取一次。
      let target = fmSidebarRight;
      if (target === null || target === undefined || typeof target.openResource !== "function") {
        target = fmContext === null ? null : serviceOf(fmContext, "sidebarRight");
        fmSidebarRight = target;
      }
      if (target === null || target === undefined || typeof target.openResource !== "function") {
        warn("预览不可用：官方行未找到，且 sidebarRight 服务未就绪");
        return false;
      }
      const address = fileAddressFor(previewSessionId(), root.getAttribute(FILES_ROOT_ATTR) || "", entryPath);
      try {
        target.openResource(address, {});
        return true;
      } catch (error) {
        warn("打开预览失败", error);
        return false;
      }
    }

    /** 由 apply 注入的 ctx 与 sidebarRight 服务，用于调用官方预览。 */
    let fmContext = null;
    let fmSidebarRight = null;

    /** 当前浏览目录。空字符串表示尚未初始化。 */
    let fmPath = "";
    let fmTimer = null;
    let fmLoading = false;

    function formatSize(bytes) {
      if (typeof bytes !== "number" || bytes <= 0) return "";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value = value / 1024;
        unit += 1;
      }
      return (unit === 0 ? String(value) : value.toFixed(1)) + " " + units[unit];
    }

    /** 面包屑：从根到当前目录，每一段可点击跳转。 */
    function renderBreadcrumb(root, currentPath) {
      const label = root.querySelector("[data-files-path]");
      if (label === null) return;
      label.className = "dsh-self-use-crumb";
      label.replaceChildren();

      const up = document.createElement("button");
      up.type = "button";
      up.className = "dsh-self-use-crumb-up";
      up.title = "上级目录";
      up.setAttribute("aria-label", "上级目录");
      up.appendChild(makeSvg(FM_ICON_PATH.up, 13, "1.8"));
      up.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        navigateTo(root, pathDirName(currentPath));
      });
      label.appendChild(up);

      const normalized = String(currentPath).replace(/\\/g, "/");
      const parts = normalized.split("/").filter((part) => part !== "");
      const isWindows = /^[A-Za-z]:/.test(normalized);
      let accumulated = isWindows ? parts[0] + "/" : "";

      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (index > 0) {
          const sep = document.createElement("span");
          sep.className = "dsh-self-use-crumb-sep";
          sep.textContent = "/";
          label.appendChild(sep);
        }
        const target = index === 0 && isWindows ? accumulated : accumulated + "/" + part;
        if (index > 0 || !isWindows) accumulated = target;
        const targetPath = index === 0 && isWindows ? parts[0] + "/" : accumulated;
        const link = document.createElement("button");
        link.type = "button";
        link.className = "dsh-self-use-crumb-item";
        link.textContent = part;
        link.title = targetPath;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          navigateTo(root, targetPath);
        });
        label.appendChild(link);
      }
    }

    function requestReload(root) {
      const button = root.querySelector("[data-files-reload]");
      if (button !== null && typeof button.click === "function") {
        button.click();
        return true;
      }
      return false;
    }

    /** 切换目录并重绘。 */
    function navigateTo(root, target) {
      if (typeof target !== "string" || target === "") return;
      fmPath = target;
      renderList(root);
    }

    /** 渲染当前目录：上级、目录、文件，文件大小与操作按钮靠右。 */
    async function renderList(root) {
      if (fmLoading === true) return;
      const body = root.querySelector("[" + FILES_BODY_ATTR + "]");
      if (body === null) return;
      // 首次调用没有目录时，用 session cwd 初始化。
      if (fmPath === "") {
        const sessionRoot = root.getAttribute(FILES_ROOT_ATTR);
        if (typeof sessionRoot !== "string" || sessionRoot === "") return;
        fmPath = sessionRoot;
      }
      fmLoading = true;
      try {
        const result = await getJson("/files?path=" + encodeURIComponent(fmPath));
        if (result.ok !== true || result.data === null || result.data.listing === null) return;
        const listing = result.data.listing;
        fmPath = listing.path;
        renderBreadcrumb(root, listing.path);

        const list = document.createElement("ul");
        list.className = FM_CLASS.level;

        const makeRow = (kind, label, fullPath, onActivate) => {
          const li = document.createElement("li");
          li.className = FM_CLASS.item + " dsh-self-use-fm-row";
          li.setAttribute(FILE_ROW_ATTR, fullPath);
          li.setAttribute(FILE_ENTRY_ATTR, kind);
          const button = document.createElement("button");
          button.type = "button";
          button.className = FM_CLASS.row;
          button.title = fullPath;
          const icon = document.createElement("span");
          icon.className = kind === "file" ? FM_CLASS.fileIcon : FM_CLASS.icon;
          icon.appendChild(makeFmIcon(kind === "file" ? "file" : "folder"));
          button.appendChild(icon);
          const name = document.createElement("span");
          name.className = FM_CLASS.name;
          name.textContent = label;
          button.appendChild(name);
          if (typeof onActivate === "function") button.addEventListener("click", onActivate);
          li.appendChild(button);
          return li;
        };

        if (listing.parent !== null) {
          list.appendChild(makeRow("directory", "../", listing.parent, (event) => {
            event.preventDefault();
            navigateTo(root, listing.parent);
          }));
        }

        for (let index = 0; index < listing.entries.length; index += 1) {
          const entry = listing.entries[index];
          if (entry.type !== "file" && entry.type !== "directory") continue;
          const row = makeRow(entry.type, entry.name, entry.path, (event) => {
            event.preventDefault();
            if (entry.type === "directory") navigateTo(root, entry.path);
            else openFilePreview(root, entry.path);
          });

          const meta = document.createElement("span");
          meta.className = "dsh-self-use-fm-meta";
          meta.textContent = entry.type === "file" ? formatSize(entry.size) : "";
          row.appendChild(meta);

          const bar = document.createElement("span");
          bar.className = "dsh-self-use-fm-actions";
          bar.appendChild(makeFmButton("copy", "复制路径", () => copyText(entry.path)));
          if (entry.type === "file") bar.appendChild(makeFmButton("download", "下载", () => downloadEntry(entry.path)));
          bar.appendChild(makeFmButton("trash", "删除", () => deleteEntry(entry.path, root)));
          row.appendChild(bar);

          list.appendChild(row);
        }

        // 官方列表保留在 DOM 里（隐藏），用于借用它的点击处理器打开预览。
        let official = body.querySelector("[data-dsh-self-use-fm-official]");
        if (official === null) {
          official = document.createElement("div");
          official.setAttribute("data-dsh-self-use-fm-official", "1");
          official.className = "dsh-self-use-fm-official";
          const preserved = [];
          while (body.firstChild !== null && body.firstChild !== undefined) {
            preserved.push(body.removeChild(body.firstChild));
          }
          for (let i = 0; i < preserved.length; i += 1) official.appendChild(preserved[i]);
          body.appendChild(official);
        }
        let mine = body.querySelector("[data-dsh-self-use-fm-mine]");
        if (mine === null) {
          mine = document.createElement("div");
          mine.setAttribute("data-dsh-self-use-fm-mine", "1");
          mine.className = "dsh-self-use-fm-mine";
          body.appendChild(mine);
        }
        mine.replaceChildren(list);
      } finally {
        fmLoading = false;
      }
    }

    function startFmAutoRefresh(root) {
      if (fmTimer !== null) {
        clearInterval(fmTimer);
        fmTimer = null;
      }
      const interval = fileRefreshMs();
      if (interval <= 0) return;
      fmTimer = setInterval(() => {
        if (fmPath === "") return;
        renderList(root);
      }, interval);
    }

    function enhanceFilesPanel() {
      if (fileManagerEnabled() !== true) return;
      const root = filesRootElement();
      if (root === null) return;
      if (root.getAttribute("data-dsh-self-use-fm") === "1") return;
      const sessionRoot = root.getAttribute(FILES_ROOT_ATTR);
      if (typeof sessionRoot !== "string" || sessionRoot === "") return;
      root.setAttribute("data-dsh-self-use-fm", "1");
      fmPath = sessionRoot;
      renderList(root);
      startFmAutoRefresh(root);
    }

    // #region dsh-self-use: document preview toolbar actions
    /** 预览工具栏槽位：刷新图标右边补复制 / 下载 / 删除。 */
    function createPreviewToolbar(props) {
      const api = props === null || typeof props !== "object" ? {} : props;
      const absolutePath = typeof api.absolutePath === "string" ? api.absolutePath : "";
      const ref = React.useRef(null);

      React.useEffect(() => {
        const host = ref.current;
        if (host === null || absolutePath === "") return undefined;
        host.replaceChildren();
        if (fileManagerEnabled() !== true) return undefined;
        host.appendChild(makeFmButton("copy", "复制路径", () => copyText(absolutePath)));
        host.appendChild(makeFmButton("download", "下载", () => downloadEntry(absolutePath)));
        host.appendChild(makeFmButton("trash", "删除", () => deleteEntry(absolutePath, null)));
        return () => {
          if (host !== null) host.replaceChildren();
        };
      }, [absolutePath]);

      if (absolutePath === "") return null;
      return React.createElement("span", {
        ref: ref,
        className: "dsh-self-use-preview-actions",
        "data-dsh-self-use-preview-actions": "1"
      });
    }

    function registerPreviewToolbar(ctx) {
      const slots = serviceOf(ctx, "slots");
      if (slots === null || slots === undefined) return;
      if (typeof slots.inject !== "function" || typeof slots.register !== "function") return;
      try {
        slots.inject("sidebar.right.tab.document.actions", () =>
          slots.register(
            { name: "sidebar.right.tab.document.actions", id: PLUGIN_ID + ".preview-toolbar", order: 10 },
            createPreviewToolbar
          )
        );
      } catch (error) {
        warn("注册预览工具栏按钮失败", error);
      }
    }
    // #endregion

    function mountFileManager() {
      let scheduled = false;
      const run = () => {
        scheduled = false;
        try {
          enhanceFilesPanel();
        } catch (_) {}
      };
      const schedule = () => {
        if (scheduled === true) return;
        scheduled = true;
        window.setTimeout(run, 120);
      };
      const observer = new MutationObserver(schedule);
      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (_) {}
      schedule();
      return () => {
        observer.disconnect();
        if (fmTimer !== null) {
          clearInterval(fmTimer);
          fmTimer = null;
        }
        fmPath = "";
      };
    }

    // #endregion

    // #region dsh-self-use: remote settings bridge
    function serviceOf(ctx, name) {
      try {
        if (ctx !== null && typeof ctx.get === "function") {
          const viaGet = ctx.get(name);
          if (viaGet !== undefined && viaGet !== null) return viaGet;
        }
      } catch (error) {
        warn("服务获取失败: " + name, error);
      }
      return ctx === null || ctx === undefined ? undefined : ctx[name];
    }

    function unwrapResult(response) {
      if (response === null || typeof response !== "object") return { ok: false, error: "设置服务无响应" };
      if (response.ok === false) return { ok: false, error: errorText(response.error) };
      const value = response.value !== undefined ? response.value : response;
      if (value === null || typeof value !== "object") return { ok: false, error: "设置服务返回了空结果" };
      return { ok: true, value };
    }

    function settingsOf(ctx) {
      // remote.settings 是点号命名空间：未在 inject 声明时访问会抛错，必须 try/catch，
      // 否则 readPermissionState 整体失败 -> 开关被误判为「只读」而禁用。
      try {
        const remote = serviceOf(ctx, "remote");
        if (remote === null || remote === undefined) return undefined;
        const settings = remote.settings;
        return settings === null || settings === undefined ? undefined : settings;
      } catch (error) {
        warn("设置服务不可用", error);
        return undefined;
      }
    }

    async function readPermissionState(ctx) {
      const settings = settingsOf(ctx);
      if (settings === undefined || typeof settings.describe !== "function") {
        return { ok: false, error: "当前环境不支持设置读写" };
      }
      let response;
      try {
        response = await settings.describe();
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
      const unwrapped = unwrapResult(response);
      if (!unwrapped.ok) return { ok: false, error: unwrapped.error };
      const view = unwrapped.value;
      const namespaces = Array.isArray(view.namespaces) ? view.namespaces : [];
      let entry;
      for (let index = 0; index < namespaces.length; index += 1) {
        const row = namespaces[index];
        if (row !== null && typeof row === "object" && row.ns === PERMISSION_NS) {
          entry = row;
          break;
        }
      }
      if (entry === undefined) {
        return {
          ok: false,
          missing: true,
          error: "未找到权限设置（permission），请确认 permission 插件已启用"
        };
      }
      const value = entry.value !== null && typeof entry.value === "object" ? entry.value : {};
      return {
        ok: true,
        writable: view.writable !== false,
        revision: entry.revision,
        preset: typeof value.defaultPreset === "string" ? value.defaultPreset : ""
      };
    }

    async function mutateDefaultPreset(ctx, preset, revision) {
      const settings = settingsOf(ctx);
      if (settings === undefined || typeof settings.mutate !== "function") {
        return { ok: false, error: "当前环境不支持设置读写" };
      }
      let response;
      try {
        response = await settings.mutate(
          PERMISSION_NS,
          [{ op: "set", path: ["defaultPreset"], value: preset }],
          revision
        );
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
      const unwrapped = unwrapResult(response);
      if (!unwrapped.ok) return { ok: false, error: unwrapped.error };
      return { ok: true };
    }

    async function applyAutoFullAccess(ctx, enabled) {
      const before = await readPermissionState(ctx);
      if (!before.ok) return before;
      if (before.writable === false) return { ok: false, error: "当前配置为只读，无法修改默认权限" };
      if (enabled === true) {
        if (before.preset === FULL_ACCESS_PRESET) return { ok: true };
        if (before.preset !== "") writePrevPreset(before.preset);
        return mutateDefaultPreset(ctx, FULL_ACCESS_PRESET, before.revision);
      }
      const target = readPrevPreset();
      if (before.preset === target) return { ok: true };
      return mutateDefaultPreset(ctx, target, before.revision);
    }
    // #endregion

    // #region dsh-self-use feature-4: hide subagent sessions from the @ menu
    // 官方 ui-reference 的 @ source 只把「当前会话派生的子代理」放进「子智能体」分组
    // (dsh-client-ui-reference/lib/client.js:317)，其他子代理混在「对话」里，section 不可靠。
    // 可靠判据：候选 value 里的 mention 是 @[label](dsh-session:<base64url(sessionId)>)
    // (dsh-session-reference/lib/index.js:311)，可无损解出 sessionId，再查
    // sessions.list.getSnapshot().byId[sessionId].origin === "subagent"。
    const MENTION_URI_PREFIX = "dsh-session:";
    const SUBAGENT_SECTION_LABELS = ["子智能体", "子代理", "Subagents"];

    function decodeMentionSessionId(mention) {
      if (typeof mention !== "string" || mention === "") return "";
      const open = mention.indexOf("](");
      const close = mention.lastIndexOf(")");
      if (open < 0 || close <= open + 2) return "";
      const uri = mention.slice(open + 2, close);
      if (uri.slice(0, MENTION_URI_PREFIX.length) !== MENTION_URI_PREFIX) return "";
      const payload = uri.slice(MENTION_URI_PREFIX.length);
      if (!/^[A-Za-z0-9_-]+$/.test(payload)) return "";
      try {
        const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
        const text = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
        const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0))));
        return typeof decoded === "string" ? decoded : "";
      } catch (error) {
        return "";
      }
    }

    // 判据为「任一命中即视为子代理」，且所有异常路径一律返回 false（保留候选）。
    function isSubagentCandidate(item, isSubagentMention) {
      if (item === null || typeof item !== "object") return false;
      if (typeof item.value !== "string") return false;
      let parsed;
      try {
        parsed = JSON.parse(item.value);
      } catch (error) {
        return false;
      }
      if (parsed === null || typeof parsed !== "object" || parsed.kind !== "session") return false;
      if (typeof item.section === "string" && SUBAGENT_SECTION_LABELS.indexOf(item.section) >= 0) return true;
      if (typeof isSubagentMention !== "function") return false;
      const mention = typeof parsed.mention === "string" ? parsed.mention : "";
      const label = typeof parsed.label === "string" ? parsed.label : "";
      try {
        return isSubagentMention(mention, label) === true;
      } catch (error) {
        return false;
      }
    }

    // 纯函数：enabled 为 false 时原样返回同一个数组（内容与顺序完全一致）。
    function filterSubagentCandidates(items, enabled, isSubagentMention) {
      if (enabled !== true) return items;
      if (!Array.isArray(items)) return items;
      const kept = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (isSubagentCandidate(item, isSubagentMention)) continue;
        kept.push(item);
      }
      return kept;
    }

    function subagentMentionLookup(ctx) {
      return (mention, label) => {
        const sessionId = decodeMentionSessionId(mention);
        let sessions;
        try {
          sessions = serviceOf(ctx, "sessions");
        } catch (error) {
          return false;
        }
        if (sessions === null || sessions === undefined) return false;
        let byId;
        try {
          const store = sessions.list;
          if (store === null || store === undefined || typeof store.getSnapshot !== "function") return false;
          const snapshot = store.getSnapshot();
          byId = snapshot === null || snapshot === undefined ? undefined : snapshot.byId;
        } catch (error) {
          return false;
        }
        if (byId === null || byId === undefined || typeof byId !== "object") return false;
        if (sessionId !== "") {
          const summary = byId[sessionId];
          return summary !== null && typeof summary === "object" && summary.origin === "subagent";
        }
        // mention 解不出 sessionId 时退化为按标题反查（仅作兜底，命中才算子代理）。
        if (label === "") return false;
        const ids = Object.keys(byId);
        for (let index = 0; index < ids.length; index += 1) {
          const summary = byId[ids[index]];
          if (summary === null || typeof summary !== "object" || summary.origin !== "subagent") continue;
          if (summary.title === label || summary.displayTitle === label) return true;
        }
        return false;
      };
    }

    function findReferenceSource(ctx) {
      let service;
      try {
        service = serviceOf(ctx, "inputTriggers");
      } catch (error) {
        return null;
      }
      if (service === null || service === undefined) return null;
      const live = service.live;
      if (live === null || live === undefined) return null;
      const sources = live.sources;
      if (!Array.isArray(sources)) return null;
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (source === null || typeof source !== "object") continue;
        if (source.trigger === "@" && source.name === "reference") return source;
      }
      return null;
    }

    // 给一个 @ reference source 装上/卸下包装。幂等标记挂在函数自身上，重复调用不叠加层级。
    function attachSourceFilter(ctx, source, state) {
      if (source === null || typeof source !== "object") return;
      const current = source.candidates;
      if (typeof current !== "function") return;
      if (current[SUBAGENT_FILTER_MARK] === true) {
        state.wrapper = current;
        state.original = current[SUBAGENT_FILTER_ORIGINAL];
        state.source = source;
        return;
      }
      const isSubagentMention = subagentMentionLookup(ctx);
      const base = current;
      const wrapper = async function (session, request) {
        const items = await base.apply(source, [session, request]);
        if (readPrefs().hideSubagentMentions !== true) return items;
        return filterSubagentCandidates(items, true, isSubagentMention);
      };
      wrapper[SUBAGENT_FILTER_MARK] = true;
      wrapper[SUBAGENT_FILTER_ORIGINAL] = base;
      state.wrapper = wrapper;
      state.original = base;
      state.source = source;
      if (readPrefs().hideSubagentMentions === true) {
        if (source.candidates !== wrapper) source.candidates = wrapper;
      } else if (source.candidates !== base) {
        source.candidates = base;
      }
    }

    function applySourceState(state) {
      const source = state.source;
      if (source === null || typeof source !== "object") return;
      if (readPrefs().hideSubagentMentions === true) {
        if (source.candidates !== state.wrapper) source.candidates = state.wrapper;
      } else if (source.candidates !== state.original) {
        source.candidates = state.original;
      }
    }

    function installSubagentFilter(ctx) {
      const state = { source: null, wrapper: null, original: null };
      const attach = () => {
        attachSourceFilter(ctx, findReferenceSource(ctx), state);
      };
      attach();

      // ui-reference 可能晚于本插件注册 @ source（加载顺序不保证），
      // 因此挂钩 registerSource：source 后到时立刻补装包装。
      let service;
      try {
        service = serviceOf(ctx, "inputTriggers");
      } catch (error) {
        service = undefined;
      }
      let restoreRegister = null;
      if (service !== null && service !== undefined && typeof service.registerSource === "function") {
        const baseRegister = service.registerSource;
        // 记录原方法是实例自有属性还是原型方法：两者还原方式相反，弄错会永久删掉服务方法。
        const hadOwn = Object.prototype.hasOwnProperty.call(service, "registerSource");
        try {
          const hooked = function (source) {
            const disposer = baseRegister.apply(this, arguments);
            try {
              attach();
            } catch (error) {
              warn("安装 @ 菜单子代理过滤失败", error);
            }
            return disposer;
          };
          service.registerSource = hooked;
          restoreRegister = () => {
            try {
              if (hadOwn) service.registerSource = baseRegister;
              else delete service.registerSource;
            } catch (error) {
              warn("还原 inputTriggers.registerSource 失败", error);
            }
          };
        } catch (error) {
          restoreRegister = null;
        }
      }

      const unsubscribe = subscribePrefs(() => {
        try {
          applySourceState(state);
        } catch (error) {
          warn("切换 @ 菜单子代理过滤失败", error);
        }
      });

      return () => {
        if (unsubscribe !== null) unsubscribe();
        if (restoreRegister !== null) restoreRegister();
        const source = state.source;
        if (source !== null && typeof source === "object" && source.candidates === state.wrapper) {
          source.candidates = state.original;
        }
        state.source = null;
        state.wrapper = null;
        state.original = null;
      };
    }
    // #endregion

    // #region dsh-self-use feature-6: hide selected skills from the "/" menu
    // 官方 ui-skill 的 / source 是普通对象属性 candidates
    // (dsh-client-ui-skill/lib/client.js:419-421)，包装它即可过滤，与 feature-4 的 @ source 同理。
    // 任何异常路径一律「保留候选」，绝不清空菜单。
    function isHiddenSkillCandidate(item, hidden) {
      if (item === null || typeof item !== "object") return false;
      if (typeof item.name !== "string" || item.name === "") return false;
      if (!Array.isArray(hidden) || hidden.length === 0) return false;
      return hidden.indexOf(item.name) >= 0;
    }

    // 纯函数：enabled 为 false 时原样返回同一个数组（引用相等）。
    function filterSkillCandidates(items, hidden) {
      if (!Array.isArray(items)) return items;
      if (!Array.isArray(hidden) || hidden.length === 0) return items;
      const kept = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (isHiddenSkillCandidate(item, hidden)) continue;
        kept.push(item);
      }
      return kept;
    }

    function findSkillSource(ctx) {
      let service;
      try {
        service = serviceOf(ctx, "inputTriggers");
      } catch (error) {
        return null;
      }
      if (service === null || service === undefined) return null;
      const live = service.live;
      if (live === null || live === undefined) return null;
      const sources = live.sources;
      if (!Array.isArray(sources)) return null;
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (source === null || typeof source !== "object") continue;
        if (source.trigger === "/" && source.name === "skill") return source;
      }
      return null;
    }

    function attachSkillFilter(source, state) {
      if (source === null || typeof source !== "object") return;
      const current = source.candidates;
      if (typeof current !== "function") return;
      if (current[SKILL_FILTER_MARK] === true) {
        state.wrapper = current;
        state.original = current[SKILL_FILTER_ORIGINAL];
        state.source = source;
        return;
      }
      const base = current;
      const wrapper = async function (session, request) {
        const items = await base.apply(source, [session, request]);
        try {
          return filterSkillCandidates(items, readPrefs().autoSkills);
        } catch (error) {
          // 过滤失败一律保留候选，绝不让菜单变空。
          return items;
        }
      };
      wrapper[SKILL_FILTER_MARK] = true;
      wrapper[SKILL_FILTER_ORIGINAL] = base;
      state.wrapper = wrapper;
      state.original = base;
      state.source = source;
      if (source.candidates !== wrapper) source.candidates = wrapper;
    }

    function applySkillFilterState(state) {
      const source = state.source;
      if (source === null || typeof source !== "object") return;
      if (source.candidates === state.wrapper) return;
      if (source.candidates !== state.original) return;
      source.candidates = state.wrapper;
    }

    function restoreSkillFilter(state) {
      const source = state.source;
      if (source === null || typeof source !== "object") return;
      if (state.original !== null && source.candidates === state.wrapper) {
        source.candidates = state.original;
      }
    }

    function installSkillFilter(ctx) {
      const state = { source: null, wrapper: null, original: null };
      const attach = () => {
        attachSkillFilter(findSkillSource(ctx), state);
      };
      try {
        attach();
      } catch (error) {
        warn("安装 / 菜单 skill 过滤失败", error);
      }

      let service;
      try {
        service = serviceOf(ctx, "inputTriggers");
      } catch (error) {
        service = undefined;
      }
      let restoreRegister = null;
      if (service !== null && service !== undefined && typeof service.registerSource === "function") {
        const baseRegister = service.registerSource;
        // 自有属性与原型方法还原方式相反，弄错会永久删掉服务方法。
        const hadOwn = Object.prototype.hasOwnProperty.call(service, "registerSource");
        try {
          const hooked = function (source) {
            const disposer = baseRegister.apply(this, arguments);
            try {
              attach();
            } catch (error) {
              warn("安装 / 菜单 skill 过滤失败", error);
            }
            return disposer;
          };
          service.registerSource = hooked;
          restoreRegister = () => {
            try {
              if (hadOwn) service.registerSource = baseRegister;
              else delete service.registerSource;
            } catch (error) {
              warn("还原 inputTriggers.registerSource 失败", error);
            }
          };
        } catch (error) {
          restoreRegister = null;
        }
      }

      const unsubscribe = subscribePrefs(() => {
        try {
          if (readPrefs().autoSkills.length === 0) restoreSkillFilter(state);
          else applySkillFilterState(state);
        } catch (error) {
          warn("切换 / 菜单 skill 过滤失败", error);
        }
      });

      return () => {
        if (unsubscribe !== null) unsubscribe();
        if (restoreRegister !== null) restoreRegister();
        restoreSkillFilter(state);
        state.source = null;
        state.wrapper = null;
        state.original = null;
      };
    }
    // #endregion

    // #region dsh-self-use: styles
    const CSS_LINES = [
      ".dsh-self-use-section { display: flex; flex-direction: column; color: var(--dsw-alias-label-primary, #18181b); }",
      ".dsh-self-use-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }",
      ".dsh-self-use-subtitle { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #71717a); }",
      ".dsh-self-use-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); }",
      ".dsh-self-use-row:last-child { border-bottom: none; }",
      ".dsh-self-use-row-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }",
      ".dsh-self-use-row-title { font-size: 14px; line-height: 20px; }",
      ".dsh-self-use-row-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #52525b); }",
      ".dsh-self-use-row-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #71717a); }",
      ".dsh-self-use-row-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #dc2626); }",
      ".dsh-self-use-switch { position: relative; flex: none; box-sizing: border-box; width: 40px; height: 22px; margin-top: 2px; padding: 0; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: 999px; background: var(--dsw-alias-interactive-bg-subtle, rgba(127, 127, 127, 0.16)); cursor: pointer; transition: background-color 0.15s ease, border-color 0.15s ease; }",
      ".dsh-self-use-switch:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-switch.is-on { background: var(--dsw-alias-state-business-primary, #3b82f6); border-color: transparent; }",
      ".dsh-self-use-switch.is-disabled, .dsh-self-use-switch:disabled { cursor: not-allowed; opacity: 0.45; }",
      ".dsh-self-use-switch-knob { position: absolute; top: 50%; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1, #ffffff); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); transform: translate(0, -50%); transition: transform 0.15s ease; }",
      ".dsh-self-use-switch.is-on .dsh-self-use-switch-knob { transform: translate(18px, -50%); }",
      ".dsh-self-use-sticky { position: absolute; top: 10px; left: 0; right: 0; z-index: 8; display: flex; justify-content: center; box-sizing: border-box; padding: 0 calc(var(--dsh-composer-side-clearance, 16px) + 16px); pointer-events: auto; }",
      ".dsh-self-use-sticky[hidden] { display: none; }",
      ".dsh-self-use-sticky-row { display: flex; align-items: flex-start; gap: 6px; width: 100%; max-width: var(--dsh-chat-content-width, 720px); margin: 0 auto; }",
      ".dsh-self-use-sticky-chip { box-sizing: border-box; display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1, #ffffff); box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0, 0, 0, 0.12)); color: var(--dsw-alias-label-secondary, #52525b); font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer; pointer-events: auto; overflow: hidden; }",
      ".dsh-self-use-sticky-chip:hover { color: var(--dsw-alias-label-primary, #18181b); }",
      ".dsh-self-use-sticky-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-sticky-tag { flex: none; display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-subtle, rgba(127, 127, 127, 0.16)); color: var(--dsw-alias-label-tertiary, #71717a); font-size: 11px; line-height: 18px; }",
      ".dsh-self-use-sticky-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      // 展开态：正文从第二行起完整折行，最多 10 行，超出仍省略，避免遮住整个聊天区。
      ".dsh-self-use-sticky.is-expanded .dsh-self-use-sticky-chip { align-items: flex-start; }",
      ".dsh-self-use-sticky.is-expanded .dsh-self-use-sticky-text { white-space: normal; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 10; line-clamp: 10; overflow: hidden; }",
      ".dsh-self-use-sticky-expand { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 36px; padding: 0; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1, #ffffff); box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0, 0, 0, 0.12)); color: var(--dsw-alias-label-tertiary, #71717a); font: inherit; font-size: 13px; line-height: 1; cursor: pointer; pointer-events: auto; }",
      ".dsh-self-use-sticky-expand:hover { color: var(--dsw-alias-label-primary, #18181b); }",
      ".dsh-self-use-sticky-expand[aria-expanded='true'] { color: var(--dsw-alias-state-business-primary, #3b82f6); border-color: var(--dsw-alias-state-business-primary, #3b82f6); }",
      ".dsh-self-use-sticky-expand:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-flash { border-radius: var(--dsw-radius-lg, 12px); animation: dsh-self-use-flash 1.2s ease-out 1; }",
      "@keyframes dsh-self-use-flash { 0% { background-color: rgba(59, 130, 246, 0.18); box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.18); } 100% { background-color: transparent; box-shadow: 0 0 0 6px transparent; } }",
      ".dsh-self-use-search-layer { display: contents; }",
      ".dsh-self-use-search-host { display: contents; }",
      ".dsh-self-use-search-backdrop { position: fixed; inset: 0; z-index: 2147482000; display: flex; align-items: flex-start; justify-content: center; box-sizing: border-box; padding: 12vh 16px 16px; background: rgba(0, 0, 0, 0.32); }",
      ".dsh-self-use-search-panel { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; max-width: 680px; max-height: 70vh; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1, #ffffff); box-shadow: var(--dsw-elevation-panel, 0 12px 40px rgba(0, 0, 0, 0.24)); color: var(--dsw-alias-label-primary, #18181b); }",
      ".dsh-self-use-search-head { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); }",
      ".dsh-self-use-search-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1, #ffffff); color: inherit; font: inherit; font-size: 14px; line-height: 20px; }",
      ".dsh-self-use-search-input:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-search-button { flex: none; box-sizing: border-box; padding: 7px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-interactive-bg-subtle, rgba(127, 127, 127, 0.12)); color: inherit; font: inherit; font-size: 13px; line-height: 18px; cursor: pointer; }",
      ".dsh-self-use-search-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.2)); }",
      ".dsh-self-use-search-button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-search-status { padding: 8px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #71717a); }",
      ".dsh-self-use-search-status.is-error { color: var(--dsw-alias-state-error-primary, #dc2626); }",
      ".dsh-self-use-search-list { flex: 1 1 auto; min-height: 0; margin: 0; padding: 0; overflow-y: auto; list-style: none; }",
      ".dsh-self-use-search-item { display: block; width: 100%; box-sizing: border-box; padding: 8px 12px; border: none; border-left: 2px solid transparent; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }",
      ".dsh-self-use-search-item:hover { background: var(--dsw-alias-interactive-bg-subtle, rgba(127, 127, 127, 0.1)); }",
      ".dsh-self-use-search-item.is-active { border-left-color: var(--dsw-alias-state-business-primary, #3b82f6); background: var(--dsw-alias-interactive-bg-subtle, rgba(127, 127, 127, 0.14)); }",
      ".dsh-self-use-search-item:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-search-turn { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #71717a); }",
      ".dsh-self-use-search-text { font-size: 13px; line-height: 19px; white-space: pre-wrap; word-break: break-word; }",
      ".dsh-self-use-search-text mark { border-radius: 3px; background: rgba(59, 130, 246, 0.28); color: inherit; }",
      ".dsh-self-use-search-miss { margin: 4px 12px 8px; padding: 6px 8px; border-radius: var(--dsw-radius-md, 8px); background: rgba(220, 38, 38, 0.1); color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; line-height: 18px; }",
      ".dsh-self-use-subsection { margin-top: 24px; padding-top: 16px; border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); }",
      ".dsh-self-use-subsection-title { font-size: 14px; line-height: 20px; font-weight: 600; }",
      ".dsh-self-use-subsection-desc { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #52525b); }",
      ".dsh-self-use-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }",
      ".dsh-self-use-preview-actions { display: inline-flex; align-items: center; gap: 0; flex: none; margin-left: 2px; }",
      ".dsh-self-use-preview-actions .dsh-self-use-fm-btn { width: 22px; height: 22px; opacity: 0.7; }",
      ".dsh-self-use-preview-actions .dsh-self-use-fm-btn:hover { opacity: 1; }",
      ".dsh-self-use-fm-official { display: none !important; }",
      ".dsh-self-use-fm-mine { display: block; }",
      ".dsh-self-use-fm-actions { display: inline-flex; align-items: center; gap: 0; margin-left: 8px; flex: 0 0 auto; }",
      ".dsh-self-use-fm-btn { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-tertiary, #71717a); cursor: pointer; flex: none; line-height: 0; opacity: 0.65; }",
      ".dsh-self-use-fm-btn:hover { opacity: 1; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14)); color: var(--dsw-alias-label-primary, #18181b); }",
      ".dsh-self-use-fm-btn[data-dsh-self-use-fm='trash']:hover { color: var(--dsw-alias-state-error-primary, #dc2626); }",
      ".dsh-self-use-fm-btn svg { display: block; }",
      ".dsh-self-use-fm-meta { flex: 0 0 auto; margin-left: auto; padding-left: 10px; color: var(--dsw-alias-label-caption, #a1a1aa); font-size: 11px; line-height: 16px; white-space: nowrap; word-break: keep-all; overflow-wrap: normal; }",
      ".dsh-self-use-fm-list { margin: 0; padding: 0; list-style: none; }",
      ".dsh-self-use-fm-row { display: flex !important; align-items: center; width: 100%; min-width: 0; gap: 0; }",
      ".dsh-self-use-fm-row > button { flex: 1 1 auto; min-width: 0; }",
      ".dsh-self-use-crumb { display: inline-flex; align-items: center; gap: 0; flex-wrap: nowrap; min-width: 0; background: transparent; border: none; padding: 0; overflow: hidden; }",
      ".dsh-self-use-crumb-item { border: none; background: transparent; color: var(--dsw-alias-label-tertiary, #71717a); font-size: 12px; line-height: 18px; cursor: pointer; padding: 0 1px; border-radius: 3px; white-space: nowrap; }",
      ".dsh-self-use-crumb-item:hover { color: var(--dsw-alias-label-primary, #18181b); background: transparent; text-decoration: underline; }",
      ".dsh-self-use-crumb-sep { color: var(--dsw-alias-label-caption, #a1a1aa); font-size: 11px; flex: none; background: transparent; margin: 0 1px; }",
      ".dsh-self-use-crumb-up { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-right: 1px; padding: 0; border: none; border-radius: 3px; background: transparent; color: var(--dsw-alias-label-tertiary, #71717a); cursor: pointer; flex: none; line-height: 0; }",
      ".dsh-self-use-crumb-up:hover { color: var(--dsw-alias-label-primary, #18181b); background: transparent; }",
      ".dsh-self-use-crumb, .k-1LKG_path { background: transparent !important; background-color: transparent !important; border: none !important; box-shadow: none !important; padding-left: 0 !important; flex: 1 1 auto !important; min-width: 0 !important; }",
      ".dsh-self-use-crumb:hover, .k-1LKG_path:hover { background: transparent !important; background-color: transparent !important; }",
      ".dsh-self-use-crumb * { background: transparent !important; background-color: transparent !important; }",
      ".k-1LKG_header { gap: 2px !important; }",
      ".k-1LKG_header > :last-child { margin-left: auto !important; }",
      ".k-1LKG_header [data-files-reload], .k-1LKG_header [data-files-auto-refresh] { flex: none; }",
      ".k-1LKG_header > * { flex: none; }",
      ".k-1LKG_header > * + * { margin-left: 0; }",
      ".k-1LKG_header > [data-files-path], .k-1LKG_header > .dsh-self-use-crumb { flex: 1 1 auto !important; min-width: 0 !important; }",
      ".k-1LKG_header > :nth-last-child(2), .k-1LKG_header > :last-child { flex: 0 0 auto !important; margin-left: 0 !important; }",
      ".k-1LKG_header > :nth-last-child(3) { margin-left: auto !important; }",
      ".dsh-self-use-row-inline { align-items: center; flex-wrap: wrap; }",
      ".dsh-self-use-row-inline .dsh-self-use-row-main { flex: 1 1 260px; min-width: 0; }",
      ".dsh-self-use-eye { box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-tertiary, #71717a); font: inherit; cursor: pointer; }",
      ".dsh-self-use-eye:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); color: var(--dsw-alias-label-primary, #18181b); }",
      ".dsh-self-use-eye.is-hidden { color: var(--dsw-alias-label-dimmed, #a1a1aa); border-style: dashed; }",
      ".dsh-self-use-eye:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-input { box-sizing: border-box; min-width: 140px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; font-size: 13px; line-height: 18px; }",
      ".dsh-self-use-input:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-input:disabled { cursor: not-allowed; opacity: 0.45; }",
      ".dsh-self-use-button { box-sizing: border-box; padding: 6px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-interactive-bg-subtle, rgba(127, 127, 127, 0.12)); color: inherit; font: inherit; font-size: 13px; line-height: 18px; cursor: pointer; }",
      ".dsh-self-use-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.2)); }",
      ".dsh-self-use-button:disabled { cursor: not-allowed; opacity: 0.45; }",
      ".dsh-self-use-button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #3b82f6)); }",
      ".dsh-self-use-button.is-danger { border-color: transparent; background: var(--dsw-alias-state-error-primary, #dc2626); color: #ffffff; }",
      ".dsh-self-use-button.is-danger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary, #dc2626); filter: brightness(0.92); }",
      ".dsh-self-use-button.is-quiet { background: transparent; }",
      ".dsh-self-use-danger-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #dc2626); }",
      ".dsh-self-use-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary, #dc2626); border-radius: var(--dsw-radius-md, 8px); background: rgba(220, 38, 38, 0.08); }",
      ".dsh-self-use-confirm-text { flex: 1 1 240px; min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #dc2626); }",
      ".dsh-self-use-list { margin: 8px 0 0; padding: 0; max-height: 320px; overflow-y: auto; border: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-md, 8px); list-style: none; }",
      ".dsh-self-use-list-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); }",
      ".dsh-self-use-list-item:last-child { border-bottom: none; }",
      ".dsh-self-use-list-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }",
      ".dsh-self-use-list-id { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      ".dsh-self-use-list-meta { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #71717a); word-break: break-all; }",
      ".dsh-self-use-list-check { flex: none; margin-top: 3px; }",
      ".dsh-self-use-details { margin-top: 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #71717a); }",
      ".dsh-self-use-details summary { cursor: pointer; }",
      ".dsh-self-use-minutes { width: 88px; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1, #ffffff); color: inherit; font: inherit; font-size: 13px; line-height: 18px; }",
      ".dsh-self-use-minutes:disabled { cursor: not-allowed; opacity: 0.45; }"
    ];
    const CSS_TEXT = CSS_LINES.join("\n");
    // #endregion

    // #region dsh-self-use: http helpers
    async function requestJson(url, options) {
      const init = options === undefined || options === null ? {} : options;
      let response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        return { ok: false, status: 0, code: "", error: "网络请求失败：" + errorText(error), data: null };
      }
      const status =
        response !== null && typeof response === "object" && typeof response.status === "number" ? response.status : 0;
      let data = null;
      let parseError = "";
      try {
        const raw = typeof response.text === "function" ? await response.text() : "";
        if (typeof raw === "string" && raw.trim() !== "") data = JSON.parse(raw);
      } catch (error) {
        parseError = errorText(error);
      }
      const succeeded = status > 0 ? status >= 200 && status < 300 : response.ok === true;
      const payload = data !== null && typeof data === "object" ? data : null;
      const code = payload !== null && typeof payload.code === "string" ? payload.code : "";
      if (!succeeded) {
        let message = payload !== null && typeof payload.error === "string" ? payload.error : "";
        if (message === "") {
          message = parseError !== "" ? "响应解析失败：" + parseError : "请求失败（HTTP " + status + "）";
        }
        return { ok: false, status: status, code: code, error: message, data: payload };
      }
      if (payload === null) {
        return {
          ok: false,
          status: status,
          code: "",
          error: parseError !== "" ? "响应解析失败：" + parseError : "响应不是合法 JSON",
          data: null
        };
      }
      return { ok: true, status: status, code: "", error: "", data: payload };
    }

    function payloadError(result, fallback) {
      const data = result !== null && typeof result === "object" ? result.data : null;
      if (data !== null && typeof data === "object" && data.ok === false) {
        const message = typeof data.error === "string" && data.error !== "" ? data.error : "";
        return message === "" ? fallback : message;
      }
      return "";
    }

    function getJson(path) {
      return requestJson(API_PREFIX + path, { method: "GET", headers: { accept: "application/json" } });
    }

    function postJson(path, body) {
      return requestJson(API_PREFIX + path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body)
      });
    }
    // #endregion

    // #region dsh-self-use: fuzzy matcher
    function matchSubsequence(text, query) {
      const haystack = text.toLowerCase();
      const needle = query.toLowerCase();
      const positions = [];
      let cursor = 0;
      for (let index = 0; index < needle.length; index += 1) {
        const found = haystack.indexOf(needle.charAt(index), cursor);
        if (found < 0) return null;
        positions.push(found);
        cursor = found + 1;
      }
      const span = positions.length === 0 ? 0 : positions[positions.length - 1] - positions[0] + 1;
      return { positions: positions, span: span };
    }

    function scorePromptMatch(text, query) {
      const raw = typeof text === "string" ? text : "";
      const needle = typeof query === "string" ? query.toLowerCase() : "";
      if (needle === "") return { substring: false, span: 0, positions: [] };
      const index = raw.toLowerCase().indexOf(needle);
      if (index >= 0) {
        const positions = [];
        for (let offset = 0; offset < needle.length; offset += 1) positions.push(index + offset);
        return { substring: true, span: needle.length, positions: positions };
      }
      const fuzzy = matchSubsequence(raw, needle);
      if (fuzzy === null) return null;
      return { substring: false, span: fuzzy.span, positions: fuzzy.positions };
    }

    function turnOfPrompt(prompt) {
      return prompt !== null && typeof prompt === "object" && typeof prompt.turn === "number" ? prompt.turn : 0;
    }

    function compareScoredMatches(left, right) {
      if (left.substring !== right.substring) return left.substring ? -1 : 1;
      if (left.span !== right.span) return left.span - right.span;
      return turnOfPrompt(left.prompt) - turnOfPrompt(right.prompt);
    }

    function filterPrompts(prompts, query) {
      const list = Array.isArray(prompts) ? prompts : [];
      const needle = typeof query === "string" ? query.trim() : "";
      const scored = [];
      for (let index = 0; index < list.length; index += 1) {
        const prompt = list[index];
        if (prompt === null || typeof prompt !== "object") continue;
        const text = typeof prompt.text === "string" ? prompt.text : "";
        const match = scorePromptMatch(text, needle);
        if (match === null) continue;
        scored.push({
          prompt: prompt,
          text: text,
          substring: match.substring,
          span: match.span,
          positions: match.positions
        });
      }
      scored.sort(compareScoredMatches);
      return scored;
    }

    function snippetOf(text, positions) {
      const raw = typeof text === "string" ? text : "";
      const list = Array.isArray(positions) ? positions : [];
      const limit = 160;
      let start = 0;
      if (list.length > 0 && list[0] > 40) start = list[0] - 24;
      let end = start + limit;
      if (list.length > 0) {
        const last = list[list.length - 1] + 1;
        if (last > end) end = last + 24;
      }
      if (end > raw.length) end = raw.length;
      const head = start > 0 ? "…" : "";
      const tail = end < raw.length ? "…" : "";
      const offset = start - head.length;
      const shifted = [];
      for (let index = 0; index < list.length; index += 1) shifted.push(list[index] - offset);
      return { text: head + raw.slice(start, end) + tail, positions: shifted };
    }

    function highlightSegments(text, positions) {
      const raw = typeof text === "string" ? text : "";
      const flags = [];
      for (let index = 0; index < raw.length; index += 1) flags.push(false);
      const list = Array.isArray(positions) ? positions : [];
      for (let index = 0; index < list.length; index += 1) {
        const position = list[index];
        if (typeof position === "number" && position >= 0 && position < flags.length) flags[position] = true;
      }
      const segments = [];
      let cursor = 0;
      while (cursor < raw.length) {
        const hot = flags[cursor];
        let end = cursor;
        while (end < raw.length && flags[end] === hot) end += 1;
        segments.push({ text: raw.slice(cursor, end), mark: hot });
        cursor = end;
      }
      return segments;
    }
    // #endregion

    // #region dsh-self-use: settings section component
    function createSettingsSection() {
      function Row(props) {
        const checked = props.checked === true;
        const disabled = props.disabled === true;
        const busy = props.busy === true;
        let switchClass = "dsh-self-use-switch";
        if (checked) switchClass += " is-on";
        if (disabled) switchClass += " is-disabled";
        const switchNode = React.createElement(
          "button",
          {
            type: "button",
            role: "switch",
            "aria-checked": checked ? "true" : "false",
            "aria-label": props.title,
            className: switchClass,
            disabled: disabled || busy,
            onClick: () => {
              if (disabled || busy) return;
              props.onToggle(checked !== true);
            }
          },
          React.createElement("span", { className: "dsh-self-use-switch-knob", "aria-hidden": "true" })
        );
        return React.createElement(
          "div",
          { className: "dsh-self-use-row" },
          React.createElement(
            "div",
            { className: "dsh-self-use-row-main" },
            React.createElement("div", { className: "dsh-self-use-row-title" }, props.title),
            React.createElement("div", { className: "dsh-self-use-row-desc" }, props.description),
            props.note ? React.createElement("div", { className: "dsh-self-use-row-note" }, props.note) : null,
            props.error ? React.createElement("div", { className: "dsh-self-use-row-error", role: "alert" }, props.error) : null
          ),
          switchNode
        );
      }

      const CleanupSection = createCleanupSection(Row);
      const FileManagerSection = createFileManagerSection(Row);
      const SkillsSection = createSkillsSection();
      const QuestionWaitSection = createQuestionWaitSection(Row);
      const ModelCustomSection = createModelCustomSection(Row);

      function SettingsSection(props) {
        const api = props === null || typeof props !== "object" ? {} : props;
        const [prefs, setPrefs] = React.useState(() =>
          typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()
        );
        const [permission, setPermission] = React.useState({
          status: "loading",
          available: true,
          preset: "",
          writable: true,
          error: ""
        });
        const [permissionError, setPermissionError] = React.useState("");
        const [busy, setBusy] = React.useState(false);

        const persist = (patch) => {
          if (typeof api.writePrefs === "function") api.writePrefs(patch);
          else writePrefs(patch);
        };

        const refreshPermission = async () => {
          let state;
          try {
            state =
              typeof api.readPermissionState === "function"
                ? await api.readPermissionState()
                : { ok: false, error: "设置服务不可用" };
          } catch (error) {
            state = { ok: false, error: errorText(error) };
          }
          if (state !== null && typeof state === "object" && state.ok === true) {
            setPermission({
              status: "ready",
              available: true,
              preset: typeof state.preset === "string" ? state.preset : "",
              writable: state.writable !== false,
              error: ""
            });
          } else {
            setPermission({
              status: "error",
              available: !(state !== null && typeof state === "object" && state.missing === true),
              preset: "",
              writable: false,
              error: state !== null && typeof state === "object" && state.error ? state.error : "读取权限设置失败"
            });
          }
        };

        React.useEffect(() => {
          refreshPermission();
        }, []);

        React.useEffect(() => {
          return subscribePrefs((next) => {
            setPrefs(next);
          });
        }, []);

        const toggleAutoFullAccess = async (next) => {
          if (busy) return;
          setBusy(true);
          setPermissionError("");
          const previous = prefs.autoFullAccess === true;
          persist({ autoFullAccess: next });
          let result;
          try {
            result =
              typeof api.applyAutoFullAccess === "function"
                ? await api.applyAutoFullAccess(next)
                : { ok: false, error: "设置服务不可用" };
          } catch (error) {
            result = { ok: false, error: errorText(error) };
          }
          if (result !== null && typeof result === "object" && result.ok === true) {
            await refreshPermission();
          } else {
            const message = result !== null && typeof result === "object" && result.error ? result.error : "写入默认权限失败";
            persist({ autoFullAccess: previous });
            setPermissionError(message);
            warn("修改默认权限失败", message);
            await refreshPermission();
          }
          setBusy(false);
        };

        const blocked = permission.status !== "ready" || permission.available === false || permission.writable === false;
        let note = "";
        if (permission.status === "loading") note = "正在读取当前默认权限…";
        else if (permission.available === false) note = permission.error;
        else if (permission.writable === false) note = "当前配置为只读，无法修改默认权限";
        else note = "当前默认权限：" + (permission.preset === "" ? "未知" : permission.preset);

        return React.createElement(
          "div",
          { className: "dsh-self-use-section" },
          React.createElement("div", { className: "dsh-self-use-title" }, "自用插件"),
          React.createElement(
            "div",
            { className: "dsh-self-use-subtitle" },
            "以下开关只影响本机浏览器，保存在 localStorage。"
          ),
          React.createElement(Row, {
            title: "新会话默认完全权限",
            description:
              "开启后新建会话默认使用完全权限（danger-full-access，不再弹审批）；关闭时写回开启前的原值。它改的是 DSH 官方「默认权限」设置。",
            checked: prefs.autoFullAccess === true,
            disabled: blocked,
            busy: busy,
            note: note,
            error: permissionError,
            onToggle: toggleAutoFullAccess
          }),
          React.createElement(Row, {
            title: "提示词置顶",
            description: "开启后当前轮提问会吸附在聊天区顶部，滚出视口时出现，点击跳回该条消息。",
            checked: prefs.stickyPrompt === true,
            onToggle: (next) => persist({ stickyPrompt: next })
          }),
          React.createElement(Row, {
            title: "提示词查询（Ctrl/Cmd+F）",
            description: "开启后按 Ctrl/Cmd+F 呼出提示词搜索浮层，按轮次号定位历史提问；关闭时保留浏览器原生查找。",
            checked: prefs.promptSearch === true,
            onToggle: (next) => persist({ promptSearch: next })
          }),
          React.createElement(Row, {
            title: "@ 菜单不显示子代理会话",
            description: "开启后，输入 @ 时不会列出子代理会话，只显示普通会话与文件。子代理会话仍可在侧栏打开。",
            checked: prefs.hideSubagentMentions === true,
            onToggle: (next) => persist({ hideSubagentMentions: next })
          }),
          React.createElement(SkillsSection, {
            readPrefs: () => (typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()),
            persist: persist,
            ctx: api.ctx
          }),
          React.createElement(CleanupSection, {
            readPrefs: () => (typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()),
            persist: persist
          }),
          React.createElement(QuestionWaitSection, {}),
          React.createElement(ModelCustomSection, {}),
          React.createElement(FileManagerSection, {
            readPrefs: () => (typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()),
            persist: persist
          })
        );
      }

      return SettingsSection;
    }
    // #endregion

    // #region dsh-self-use: empty session cleanup helpers
    function formatLocalTime(value) {
      const ms = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(ms) || ms <= 0) return "未知时间";
      const date = new Date(ms);
      if (Number.isNaN(date.getTime())) return "未知时间";
      const pad = (part) => (part < 10 ? "0" + part : String(part));
      return (
        date.getFullYear() +
        "-" +
        pad(date.getMonth() + 1) +
        "-" +
        pad(date.getDate()) +
        " " +
        pad(date.getHours()) +
        ":" +
        pad(date.getMinutes()) +
        ":" +
        pad(date.getSeconds())
      );
    }

    function shortId(value) {
      const raw = typeof value === "string" ? value : "";
      if (raw.length <= 14) return raw;
      return raw.slice(0, 8) + "…" + raw.slice(-4);
    }

    function summaryTextOf(summary) {
      const source = summary !== null && typeof summary === "object" ? summary : {};
      const total = typeof source.total === "number" ? source.total : 0;
      const success = typeof source.success === "number" ? source.success : 0;
      const failed = typeof source.failed === "number" ? source.failed : 0;
      const skipped = typeof source.skipped === "number" ? source.skipped : 0;
      return "共 " + total + " 个：成功 " + success + "，失败 " + failed + "，跳过 " + skipped;
    }

    function failureTextOf(item) {
      const source = item !== null && typeof item === "object" ? item : {};
      const id = typeof source.sessionId === "string" ? source.sessionId : "（未知会话）";
      const parts = [];
      if (typeof source.code === "string" && source.code !== "") parts.push(source.code);
      if (typeof source.error === "string" && source.error !== "") parts.push(source.error);
      if (typeof source.reason === "string" && source.reason !== "") parts.push(source.reason);
      if (typeof source.status === "string" && source.status !== "") parts.push(source.status);
      return id + " — " + (parts.length === 0 ? "删除失败" : parts.join(" / "));
    }

    const AUTO_CLEANUP_UNAVAILABLE_TEXT = "自动清理需要更新 Host 端，请重启 dsh web 后重试";
    // #endregion

    // #region dsh-self-use feature-6: skill catalog bridge
    // 官方 ui-skill 的目录来源同为 ctx.remote.skills.list({ sessionId })
    // (dsh-client-ui-skill/lib/client.js:389)。
    async function fetchSkillCatalog(ctx) {
      const sessionId = currentSessionId();
      if (sessionId === "") return { ok: false, error: "请先打开一个会话", skills: [] };
      let remote;
      try {
        remote = serviceOf(ctx, "remote");
      } catch (error) {
        return { ok: false, error: "skills 服务不可用：" + errorText(error), skills: [] };
      }
      const skills = remote === null || remote === undefined ? undefined : remote.skills;
      if (skills === null || skills === undefined || typeof skills.list !== "function") {
        return { ok: false, error: "skills 服务不可用，请确认 skill 插件已启用", skills: [] };
      }
      let result;
      try {
        result = await skills.list({ sessionId: sessionId });
      } catch (error) {
        return { ok: false, error: "读取 skill 列表失败：" + errorText(error), skills: [] };
      }
      if (result === null || typeof result !== "object") {
        return { ok: false, error: "读取 skill 列表失败：服务无响应", skills: [] };
      }
      if (result.ok !== true) {
        const error = result.error;
        const message =
          error !== null && typeof error === "object" && typeof error.message === "string" && error.message !== ""
            ? error.message
            : errorText(error);
        return { ok: false, error: "读取 skill 列表失败：" + message, skills: [] };
      }
      const value = result.value !== null && typeof result.value === "object" ? result.value : {};
      const list = Array.isArray(value.skills) ? value.skills : [];
      const out = [];
      for (let index = 0; index < list.length; index += 1) {
        const skill = list[index];
        if (skill === null || typeof skill !== "object") continue;
        const name = typeof skill.name === "string" ? skill.name : "";
        if (name === "" || SKILL_NAME_PATTERN.test(name) !== true) continue;
        out.push({
          name: name,
          description: typeof skill.description === "string" ? skill.description : ""
        });
      }
      out.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      return { ok: true, error: "", skills: out };
    }

    // Host 侧 pre-step 钩子读的是同一个路由，因此名单必须同步过去；
    // localStorage 仍是权威来源，同步失败只提示、不回滚选择。
    async function pushAutoSkills(names) {
      const skills = normalizeSkillNames(names);
      return postJson(AUTO_SKILLS_PATH, { skills: skills });
    }

    async function pullAutoSkills() {
      return getJson(AUTO_SKILLS_PATH);
    }
    // #endregion

    // #region dsh-self-use feature-6: auto skills section
    function createSkillsSection() {
      function SkillsSection(props) {
        const api = props === null || typeof props !== "object" ? {} : props;
        const persist = typeof api.persist === "function" ? api.persist : () => {};
        const [prefs, setPrefs] = React.useState(() =>
          typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()
        );
        const [catalog, setCatalog] = React.useState({ status: "idle", error: "", skills: [] });
        const [query, setQuery] = React.useState("");
        const [syncError, setSyncError] = React.useState("");

        const alive = React.useRef(true);
        React.useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        React.useEffect(() => {
          return subscribePrefs((next) => {
            setPrefs(next);
          });
        }, []);

        const load = async () => {
          setCatalog({ status: "loading", error: "", skills: [] });
          let result;
          try {
            result = await fetchSkillCatalog(api.ctx);
          } catch (error) {
            result = { ok: false, error: "读取 skill 列表失败：" + errorText(error), skills: [] };
          }
          if (alive.current !== true) return;
          if (result.ok !== true) {
            setCatalog({ status: "error", error: result.error, skills: [] });
            return;
          }
          setCatalog({ status: "ready", error: "", skills: result.skills });
        };

        React.useEffect(() => {
          load();
        }, []);

        const selected = prefs.autoSkills;
        const toggle = (name, next) => {
          const list = [];
          for (let index = 0; index < selected.length; index += 1) {
            if (selected[index] === name) continue;
            list.push(selected[index]);
          }
          if (next === true) list.push(name);
          const names = normalizeSkillNames(list);
          persist({ autoSkills: names });
          // 同步到 Host，失败只在区块内提示，不回滚本地选择。
          pushAutoSkills(names).then(
            (result) => {
              if (alive.current !== true) return;
              const failed = result.ok !== true || payloadError(result, "") !== "";
              setSyncError(failed ? "同步到 Host 失败：" + (result.ok !== true ? result.error : payloadError(result, "")) : "");
            },
            (error) => {
              if (alive.current !== true) return;
              setSyncError("同步到 Host 失败：" + errorText(error));
            }
          );
        };

        const needle = query.trim().toLowerCase();
        const visible = [];
        for (let index = 0; index < catalog.skills.length; index += 1) {
          const skill = catalog.skills[index];
          if (needle !== "") {
            const haystack = (skill.name + " " + skill.description).toLowerCase();
            if (haystack.indexOf(needle) < 0) continue;
          }
          visible.push(skill);
        }

        const items = [];
        for (let index = 0; index < visible.length; index += 1) {
          const skill = visible[index];
          const checked = selected.indexOf(skill.name) >= 0;
          const description = skill.description.length > 100 ? skill.description.slice(0, 100) + "…" : skill.description;
          items.push(
            React.createElement(
              "li",
              { className: "dsh-self-use-list-item", key: "auto-skill-" + skill.name },
              React.createElement("input", {
                type: "checkbox",
                className: "dsh-self-use-list-check",
                checked: checked,
                "aria-label": "自动调用 " + skill.name,
                onChange: () => toggle(skill.name, checked !== true)
              }),
              React.createElement(
                "div",
                { className: "dsh-self-use-list-main" },
                React.createElement("div", { className: "dsh-self-use-list-id" }, skill.name),
                description === ""
                  ? null
                  : React.createElement("div", { className: "dsh-self-use-list-meta" }, description)
              )
            )
          );
        }

        let statusText = "";
        if (catalog.status === "loading") statusText = "正在读取 skill 列表…";
        else if (catalog.status === "ready") {
          statusText =
            "共 " +
            catalog.skills.length +
            " 个 skill，已选 " +
            selected.length +
            " 个" +
            (needle === "" ? "" : "，匹配 " + visible.length + " 个");
        }

        return React.createElement(
          "div",
          { className: "dsh-self-use-subsection" },
          React.createElement("div", { className: "dsh-self-use-subsection-title" }, "自动调用的 Skill"),
          React.createElement(
            "div",
            { className: "dsh-self-use-subsection-desc" },
            "选中的 skill 会在每次发送消息时自动注入正文（由 Host 的 agent/pre-step 钩子完成），并从 / 菜单里隐藏。"
          ),
          React.createElement(
            "div",
            { className: "dsh-self-use-actions" },
            React.createElement("input", {
              type: "text",
              className: "dsh-self-use-search-input",
              style: { flex: "1 1 200px", padding: "5px 8px", fontSize: "13px" },
              value: query,
              "aria-label": "搜索 skill",
              placeholder: "按名称或描述过滤",
              onChange: (event) => setQuery(typeof event.target.value === "string" ? event.target.value : "")
            }),
            React.createElement(
              "button",
              {
                type: "button",
                className: "dsh-self-use-button",
                disabled: catalog.status === "loading",
                onClick: load
              },
              catalog.status === "loading" ? "刷新中…" : "刷新列表"
            )
          ),
          statusText === ""
            ? null
            : React.createElement("div", { className: "dsh-self-use-row-note", role: "status" }, statusText),
          catalog.status === "error"
            ? React.createElement("div", { className: "dsh-self-use-row-error", role: "alert" }, catalog.error)
            : null,
          syncError === ""
            ? null
            : React.createElement("div", { className: "dsh-self-use-row-error", role: "alert" }, syncError),
          items.length === 0
            ? null
            : React.createElement("ul", { className: "dsh-self-use-list" }, items)
        );
      }

      return SkillsSection;
    }
    // #endregion

    // #region dsh-self-use: empty session cleanup section

    // #region dsh-self-use: model customisation client
    const MODEL_CUSTOM_CACHE_KEY = "dsh-self-use:model-custom.v1";
    const MODEL_EYE_ATTR = "data-dsh-self-use-eye";
    const MODEL_GROUP_EYE_ATTR = "data-dsh-self-use-group-eye";

    function readModelCustomCache() {
      try {
        const raw = window.localStorage.getItem(MODEL_CUSTOM_CACHE_KEY);
        if (raw === null || raw === "") return { efforts: {}, hidden: [], hiddenGroups: [] };
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return { efforts: {}, hidden: [], hiddenGroups: [] };
        return {
          efforts: parsed.efforts !== null && typeof parsed.efforts === "object" ? parsed.efforts : {},
          hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
          hiddenGroups: Array.isArray(parsed.hiddenGroups) ? parsed.hiddenGroups : []
        };
      } catch (_) {
        return { efforts: {}, hidden: [], hiddenGroups: [] };
      }
    }

    function writeModelCustomCache(config) {
      try {
        window.localStorage.setItem(MODEL_CUSTOM_CACHE_KEY, JSON.stringify(config));
      } catch (_) {}
    }

    let modelCustomState = readModelCustomCache();
    // 最近一次见到的完整模型目录（未过滤），供设置页列出可配置强度的模型。
    let knownModelGroups = [];
    // ctx.remote.session 尚未就绪时保留的重试入口。
    let pendingCatalogWrap = null;

    function rememberModelGroups(groups) {
      if (!Array.isArray(groups) || groups.length === 0) return;
      knownModelGroups = groups;
      try {
        window.dispatchEvent(new CustomEvent("dsh:self-use:model-catalog"));
      } catch (_) {}
    }

    function setModelCustomState(next) {
      modelCustomState = {
        efforts: next.efforts !== null && typeof next.efforts === "object" ? next.efforts : {},
        hidden: Array.isArray(next.hidden) ? next.hidden : [],
        hiddenGroups: Array.isArray(next.hiddenGroups) ? next.hiddenGroups : []
      };
      writeModelCustomCache(modelCustomState);
      try {
        window.dispatchEvent(new CustomEvent("dsh:self-use:model-custom"));
      } catch (_) {}
    }

    function modelCustomKey(provider, model) {
      const p = typeof provider === "string" ? provider : "";
      const m = typeof model === "string" ? model : "";
      return p === "" || m === "" ? "" : p + "/" + m;
    }

    function customEffortFor(provider, model) {
      const key = modelCustomKey(provider, model);
      if (key === "") return undefined;
      const value = modelCustomState.efforts[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    }

    function isModelHiddenLocal(provider, model) {
      const key = modelCustomKey(provider, model);
      return key !== "" && modelCustomState.hidden.indexOf(key) >= 0;
    }

    function isGroupHiddenLocal(provider) {
      return typeof provider === "string" && provider !== "" && modelCustomState.hiddenGroups.indexOf(provider) >= 0;
    }

    /**
     * 目录可能在 Host 配置到达之前就被请求，所以包装器每次调用前
     * 先从 localStorage 同步一次，保证读到的是最新保存值。
     */
    function refreshModelCustomState() {
      modelCustomState = readModelCustomCache();
      return modelCustomState;
    }

    /** 过滤模型目录并按自定义强度改写，纯函数便于测试。 */
    function filterCatalogByCustom(catalog, config) {
      if (catalog === null || typeof catalog !== "object" || !Array.isArray(catalog.groups)) return catalog;
      const cfg = config !== null && typeof config === "object" ? config : { efforts: {}, hidden: [], hiddenGroups: [] };
      const cfgEfforts = cfg.efforts !== null && typeof cfg.efforts === "object" ? cfg.efforts : {};
      const cfgHidden = Array.isArray(cfg.hidden) ? cfg.hidden : [];
      const cfgGroups = Array.isArray(cfg.hiddenGroups) ? cfg.hiddenGroups : [];
      const groups = [];
      for (const group of catalog.groups) {
        if (group === null || typeof group !== "object") continue;
        if (cfgGroups.indexOf(group.id) >= 0) continue;
        const models = Array.isArray(group.models) ? group.models : [];
        const kept = [];
        for (const model of models) {
          if (model === null || typeof model !== "object") continue;
          const modelKeyValue = modelCustomKey(group.id, model.id);
          if (modelKeyValue === "" || cfgHidden.indexOf(modelKeyValue) >= 0) continue;
          const rawEffort = cfgEfforts[modelKeyValue];
          const effort = typeof rawEffort === "string" && rawEffort !== "" ? rawEffort : undefined;
          if (effort === undefined) {
            kept.push(model);
            continue;
          }
          const reasoning = model.reasoning !== null && typeof model.reasoning === "object" ? model.reasoning : undefined;
          kept.push(
            Object.assign({}, model, {
              reasoning: Object.assign({}, reasoning === undefined ? {} : reasoning, { defaultEffort: effort })
            })
          );
        }
        if (kept.length === 0) continue;
        groups.push(Object.assign({}, group, { models: kept }));
      }
      return Object.assign({}, catalog, { groups: groups });
    }

    /** 隐藏模型/组后，如果默认选中项被隐藏，改选第一个可用模型。 */
    function retargetDefault(catalog) {
      if (catalog === null || typeof catalog !== "object") return catalog;
      const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
      const current = catalog.default;
      if (current !== null && typeof current === "object") {
        for (const group of groups) {
          const models = Array.isArray(group.models) ? group.models : [];
          for (const model of models) {
            if (group.id === current.provider && model.id === current.model) return catalog;
          }
        }
      }
      if (groups.length === 0) return Object.assign({}, catalog, { default: undefined });
      const first = groups[0];
      const firstModel = Array.isArray(first.models) ? first.models[0] : undefined;
      if (firstModel === undefined) return Object.assign({}, catalog, { default: undefined });
      const effort = customEffortFor(first.id, firstModel.id);
      const reasoningDefault =
        firstModel.reasoning !== null && typeof firstModel.reasoning === "object" ? firstModel.reasoning.defaultEffort : undefined;
      const nextEffort = effort === undefined ? reasoningDefault : effort;
      return Object.assign({}, catalog, {
        default: Object.assign(
          { provider: first.id, model: firstModel.id },
          nextEffort === undefined ? {} : { reasoningEffort: nextEffort }
        )
      });
    }

    /**
     * 包装 remote.session.modelCatalog：记住完整目录，再按隐藏/强度改写返回值。
     * 叠加在 model-manager 的包装之上，两者互不影响。
     */
    function wrapModelCatalogForCustom(ctx) {
      try {
        const sessionRemote = ctx && ctx.remote ? ctx.remote.session : undefined;
        if (!sessionRemote || typeof sessionRemote.modelCatalog !== "function") {
          // ctx.remote.session 在 apply 早期可能还没就绪，挂到下一次目录请求前再包。
          pendingCatalogWrap = () => wrapModelCatalogForCustom(ctx);
          return;
        }
        if (sessionRemote.modelCatalog.__dshSelfUseCustom === true) return;
        const original = sessionRemote.modelCatalog;
        const wrapped = async function patchedCatalog() {
          const result = await original.apply(this, arguments);
          if (result && result.ok && result.value && Array.isArray(result.value.groups)) {
            rememberModelGroups(result.value.groups);
            refreshModelCustomState();
            const filtered = retargetDefault(filterCatalogByCustom(result.value, modelCustomState));
            return Object.assign({}, result, { value: filtered });
          }
          return result;
        };
        wrapped.__dshSelfUseCustom = true;
        wrapped.__original = original;
        sessionRemote.modelCatalog = wrapped;
      } catch (error) {
        warn("模型目录包装失败", error);
      }
    }

    /** 包装 selectModel：选中模型时套用自定义默认强度。 */
    function wrapSelectModelForCustom(ctx) {
      try {
        const sessions = ctx && ctx.sessions ? ctx.sessions : undefined;
        if (!sessions || typeof sessions.selectModel !== "function") return;
        if (sessions.selectModel.__dshSelfUseCustom === true) return;
        const original = sessions.selectModel;
        const wrapped = function patchedSelectModel(selection) {
          let next = selection;
          try {
            const effort = customEffortFor(selection && selection.provider, selection && selection.model);
            if (effort !== undefined) next = Object.assign({}, selection, { reasoningEffort: effort });
          } catch (_) {}
          return original.call(this, next);
        };
        wrapped.__dshSelfUseCustom = true;
        wrapped.__original = original;
        sessions.selectModel = wrapped;
      } catch (error) {
        warn("模型选择包装失败", error);
      }
    }

    function syncModelCustomFromHost() {
      return getJson("/model-custom").then((result) => {
        if (result.ok !== true) return modelCustomState;
        const config = result.data.config !== null && typeof result.data.config === "object" ? result.data.config : {};
        setModelCustomState(config);
        return modelCustomState;
      });
    }

    function saveModelCustom(patch) {
      return postJson("/model-custom", patch).then((result) => {
        if (result.ok !== true) return { ok: false, error: result.error };
        const config = result.data.config !== null && typeof result.data.config === "object" ? result.data.config : null;
        // 只把 Host 真正返回的字段合并回来；缺字段时保留本地值，
        // 否则响应里少一个字段就会把刚切换的状态冲掉，表现为「点一次没反应」。
        if (config !== null) {
          const merged = {
            efforts: config.efforts !== null && typeof config.efforts === "object" ? config.efforts : modelCustomState.efforts,
            hidden: Array.isArray(config.hidden) ? config.hidden : modelCustomState.hidden,
            hiddenGroups: Array.isArray(config.hiddenGroups) ? config.hiddenGroups : modelCustomState.hiddenGroups
          };
          setModelCustomState(merged);
        }
        return { ok: true, config: modelCustomState };
      });
    }
    // #endregion
    // #region dsh-self-use: model default effort settings section
    function createModelCustomSection(Row) {
      function ModelCustomSection(props) {
        const api = props === null || typeof props !== "object" ? {} : props;
        const [state, setState] = React.useState({
          status: "loading",
          groups: [],
          efforts: {},
          error: "",
          note: ""
        });
        const [busy, setBusy] = React.useState(false);
        const alive = React.useRef(true);
        React.useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        const load = async () => {
          await syncModelCustomFromHost();
          if (alive.current !== true) return;
          setState((prev) =>
            Object.assign({}, prev, {
              status: knownModelGroups.length === 0 ? "empty" : "ready",
              groups: knownModelGroups,
              efforts: modelCustomState.efforts,
              error: ""
            })
          );
        };

        React.useEffect(() => {
          load();
          const onCatalog = () => load();
          window.addEventListener("dsh:self-use:model-catalog", onCatalog);
          return () => window.removeEventListener("dsh:self-use:model-catalog", onCatalog);
        }, []);

        const setEffort = (key, value) => {
          const efforts = Object.assign({}, modelCustomState.efforts);
          if (value === "") delete efforts[key];
          else efforts[key] = value;
          setModelCustomState(Object.assign({}, modelCustomState, { efforts: efforts }));
          setState((prev) => Object.assign({}, prev, { efforts: efforts }));
          if (busy) return;
          setBusy(true);
          saveModelCustom({ efforts: efforts }).then((result) => {
            if (alive.current !== true) return;
            setBusy(false);
            setState((prev) =>
              Object.assign({}, prev, {
                note: result.ok === true ? "已保存" : result.error || "保存失败",
                error: result.ok === true ? "" : result.error || ""
              })
            );
          });
        };

        const rows = [];
        for (const group of state.groups) {
          if (group === null || typeof group !== "object") continue;
          const models = Array.isArray(group.models) ? group.models : [];
          for (const model of models) {
            if (model === null || typeof model !== "object") continue;
            const key = modelCustomKey(group.id, model.id);
            if (key === "") continue;
            const reasoning = model.reasoning !== null && typeof model.reasoning === "object" ? model.reasoning : undefined;
            const levels = reasoning !== undefined && Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
            if (levels.length === 0) continue;
            const current = typeof state.efforts[key] === "string" ? state.efforts[key] : "";
            const options = [React.createElement("option", { value: "", key: "auto" }, "跟随默认")];
            for (const level of levels) {
              const id = typeof level.id === "string" ? level.id : "";
              if (id === "") continue;
              options.push(
                React.createElement(
                  "option",
                  { value: id, key: id },
                  (typeof level.name === "string" && level.name !== "" ? level.name : id) + " (" + id + ")"
                )
              );
            }
            rows.push(
              React.createElement(
                "div",
                { className: "dsh-self-use-row", key: "mc-" + key },
                React.createElement(
                  "div",
                  { className: "dsh-self-use-row-main" },
                  React.createElement("div", { className: "dsh-self-use-row-title" }, model.name || model.id),
                  React.createElement(
                    "div",
                    { className: "dsh-self-use-row-desc" },
                    (group.name || group.id) + " · 默认 " + (reasoning.defaultEffort || "未声明")
                  )
                ),
                React.createElement(
                  "select",
                  {
                    className: "dsh-self-use-input",
                    value: current,
                    "aria-label": (model.name || model.id) + " 默认强度",
                    onChange: (event) => setEffort(key, event && event.target ? event.target.value : "")
                  },
                  options
                )
              )
            );
          }
        }

        const body =
          state.status === "loading"
            ? React.createElement("div", { className: "dsh-self-use-row-note" }, "正在读取模型目录…")
            : rows.length === 0
              ? React.createElement(
                  "div",
                  { className: "dsh-self-use-row-note" },
                  "还没有可配置强度的模型。打开一次输入框的模型下拉框（或在会话里切换一次模型）后回到这里，列表会自动填充。"
                )
              : rows;

        return React.createElement(
          "div",
          { className: "dsh-self-use-subsection" },
          React.createElement("div", { className: "dsh-self-use-subtitle" }, "模型默认强度"),
          React.createElement(
            "div",
            { className: "dsh-self-use-row-note" },
            "给每个模型设一个默认强度。在输入框选中该模型时会自动套用这里的值；你之后手动改强度仍然生效。"
          ),
          state.note !== "" ? React.createElement("div", { className: "dsh-self-use-row-note" }, state.note) : null,
          state.status === "unavailable" && state.error !== ""
            ? React.createElement("div", { className: "dsh-self-use-row-error" }, state.error)
            : null,
          body
        );
      }
      return ModelCustomSection;
    }
    // #endregion
    // #region dsh-self-use: model eye buttons (hide model / hide group)
    const EYE_OPEN_SVG =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.9" stroke="currentColor" stroke-width="1.2"/></svg>';
    const EYE_CLOSED_SVG =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

    function createEyeButton(options) {
      const opts = options === null || typeof options !== "object" ? {} : options;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dsh-self-use-eye";
      btn.setAttribute(opts.attr, opts.key);
      // 不在这里绑 click：事件走 document 级委托，按钮被 React 重建后依然有效。
      const sync = () => {
        const hidden = opts.isHidden() === true;
        btn.classList.toggle("is-hidden", hidden);
        btn.innerHTML = hidden ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
        btn.title = hidden ? opts.hideTitle : opts.showTitle;
        btn.setAttribute("aria-label", hidden ? opts.hideTitle : opts.showTitle);
        btn.setAttribute("aria-pressed", hidden ? "true" : "false");
      };
      btn._syncEye = sync;
      btn._eyeToggle = () => {
        if (typeof opts.onClick === "function") opts.onClick();
      };
      sync();
      return btn;
    }

    /** 隐藏/显示单个模型。 */
    function toggleModelHidden(provider, model) {
      const key = modelCustomKey(provider, model);
      if (key === "") return;
      const hidden = modelCustomState.hidden.slice();
      const index = hidden.indexOf(key);
      if (index >= 0) hidden.splice(index, 1);
      else hidden.push(key);
      const next = Object.assign({}, modelCustomState, { hidden: hidden });
      setModelCustomState(next);
      saveModelCustom({ hidden: hidden });
      filterModelMenus();
      syncEyeButtons();
    }

    /** 隐藏/显示整个模型组。 */
    function toggleGroupHidden(provider) {
      if (typeof provider !== "string" || provider === "") return;
      const groups = modelCustomState.hiddenGroups.slice();
      const index = groups.indexOf(provider);
      if (index >= 0) groups.splice(index, 1);
      else groups.push(provider);
      const next = Object.assign({}, modelCustomState, { hiddenGroups: groups });
      setModelCustomState(next);
      saveModelCustom({ hiddenGroups: groups });
      filterModelMenus();
      syncEyeButtons();
    }

    function syncEyeButtons() {
      document.querySelectorAll("." + "dsh-self-use-eye").forEach((btn) => {
        if (typeof btn._syncEye === "function") btn._syncEye();
      });
    }

    /**
     * 在模型下拉框里隐藏被隐藏的模型行与整组。
     * 行结构：section[data-menu-group] > button[role="menuitemradio"][title=模型名]
     */
    function filterModelMenus() {
      const sections = document.querySelectorAll("section[data-menu-group]");
      sections.forEach((section) => {
        const heading = section.querySelector("[data-menu-group-heading]");
        const headingText = heading === null ? "" : String(heading.textContent || "").trim();
        const sectionHiddenByGroup =
          headingText !== "" && modelCustomState.hiddenGroups.indexOf(headingText) >= 0;
        const items = section.querySelectorAll('button[role="menuitemradio"]');
        let visibleCount = 0;
        items.forEach((item) => {
          const modelName = String(item.getAttribute("title") || "").trim();
          const hidden =
            sectionHiddenByGroup ||
            (modelName !== "" && isModelHiddenByLabel(headingText, modelName));
          if (hidden) {
            item.style.setProperty("display", "none", "important");
            item.setAttribute("data-dsh-self-use-hidden", "true");
          } else {
            if (item.hasAttribute("data-dsh-self-use-hidden")) {
              item.style.removeProperty("display");
              item.removeAttribute("data-dsh-self-use-hidden");
            }
            visibleCount += 1;
          }
        });
        if (items.length > 0 && visibleCount === 0) {
          section.style.setProperty("display", "none", "important");
          section.setAttribute("data-dsh-self-use-hidden", "true");
        } else {
          if (section.hasAttribute("data-dsh-self-use-hidden")) {
            section.style.removeProperty("display");
            section.removeAttribute("data-dsh-self-use-hidden");
          }
        }
      });
    }

    /**
     * DOM 里只有显示名，存储的是 model id，所以先用已知目录把显示名映射回 id，
     * 映射不到时再退回按显示名直接比较。
     */
    function resolveModelIdByLabel(groupLabel, modelName) {
      if (modelName === "") return "";
      for (const group of knownModelGroups) {
        if (group === null || typeof group !== "object") continue;
        if (groupLabel !== "" && group.id !== groupLabel && group.name !== groupLabel) continue;
        const models = Array.isArray(group.models) ? group.models : [];
        for (const model of models) {
          if (model === null || typeof model !== "object") continue;
          if (model.id === modelName || model.name === modelName) return model.id;
        }
      }
      return "";
    }

    /** 用「组标题 + 模型显示名」判断该行是否被隐藏。 */
    function isModelHiddenByLabel(groupLabel, modelName) {
      if (modelName === "") return false;
      const modelId = resolveModelIdByLabel(groupLabel, modelName);
      if (modelId !== "") {
        for (const group of knownModelGroups) {
          if (group === null || typeof group !== "object") continue;
          if (groupLabel !== "" && group.id !== groupLabel && group.name !== groupLabel) continue;
          if (isModelHiddenLocal(group.id, modelId)) return true;
        }
      }
      for (const key of modelCustomState.hidden) {
        const slash = key.indexOf("/");
        if (slash <= 0) continue;
        const provider = key.slice(0, slash);
        const model = key.slice(slash + 1);
        if (model === modelName && (provider === groupLabel || groupLabel === "")) return true;
      }
      return false;
    }

    /**
     * 扫描设置页与下拉框，插入眼睛按钮。
     * 设置页模型行：li[class*=rowCard] > rowHead > rowActions（模型组级）
     * 设置页模型条目：modelRow（单个模型级）
     */
    function runModelEyePass() {
      // A. 设置页：模型组卡片右侧加「隐藏模型组」眼睛
      document.querySelectorAll('li[class*="rowCard"]').forEach((card) => {
        const rowHead = card.querySelector('[class*="rowHead"]');
        if (rowHead === null) return;
        const rowActions = rowHead.querySelector('[class*="rowActions"]');
        if (rowActions === null) return;
        const nameEl = rowHead.querySelector('[class*="rowName"]');
        const displayName = nameEl === null ? "" : String(nameEl.textContent || "").trim();
        if (displayName === "") return;
        const existing = rowActions.querySelector("[" + MODEL_GROUP_EYE_ATTR + "]");
        if (existing !== null) {
          existing._syncEye();
          return;
        }
        const btn = createEyeButton({
          attr: MODEL_GROUP_EYE_ATTR,
          key: displayName,
          isHidden: () => isGroupHiddenLocal(displayName),
          hideTitle: "隐藏此模型组（下拉框中不显示）",
          showTitle: "显示此模型组",
          onClick: () => toggleGroupHidden(displayName)
        });
        rowActions.insertBefore(btn, rowActions.firstChild);
      });

      // B. 设置页：单个模型行加眼睛
      document.querySelectorAll('[class*="modelRow"]').forEach((row) => {
        const inputs = row.querySelectorAll("input, select");
        let modelName = "";
        for (const input of inputs) {
          const value = typeof input.value === "string" ? input.value.trim() : "";
          if (value !== "" && input.getAttribute("type") !== "number") {
            modelName = value;
            break;
          }
        }
        if (modelName === "") return;
        const providerId = providerOfRow(row);
        if (providerId === "") return;
        const existing = row.querySelector("[" + MODEL_EYE_ATTR + "]");
        if (existing !== null) {
          existing._syncEye();
          return;
        }
        const btn = createEyeButton({
          attr: MODEL_EYE_ATTR,
          key: modelCustomKey(providerId, modelName),
          isHidden: () => isModelHiddenLocal(providerId, modelName),
          hideTitle: "隐藏此模型（下拉框中不显示）",
          showTitle: "显示此模型",
          onClick: () => toggleModelHidden(providerId, modelName)
        });
        row.appendChild(btn);
      });

      filterModelMenus();
    }

    /** 从模型条目向上找所属模型组卡片的名称。 */
    function providerOfRow(row) {
      let node = row;
      while (node !== null && node !== undefined) {
        if (node.matches && node.matches('li[class*="rowCard"]')) {
          const nameEl = node.querySelector('[class*="rowName"]');
          return nameEl === null ? "" : String(nameEl.textContent || "").trim();
        }
        node = node.parentElement;
      }
      return "";
    }

    function installModelEyeButtons() {
      let timer = null;
      let lastSignature = "";
      const run = () => {
        try {
          runModelEyePass();
          lastSignature = eyeSignature();
        } catch (error) {
          warn("模型眼睛按钮注入失败", error);
        }
      };

      // 事件委托：按钮被 React 重建后依然能响应，点击一次就生效。
      const onClick = (event) => {
        const target = event.target;
        if (target === null || target === undefined || typeof target.closest !== "function") return;
        const btn = target.closest("." + "dsh-self-use-eye");
        if (btn === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof btn._eyeToggle === "function") {
          btn._eyeToggle();
          // 状态已变，立刻同步一次视觉，不等下一轮 DOM 扫描。
          syncEyeButtons();
        }
      };
      document.addEventListener("click", onClick, true);

      // 只在「按钮数量变化」时重扫，避免每次点击引发的重渲染又重建按钮。
      const observer = new MutationObserver(() => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          try {
            if (eyeSignature() === lastSignature) {
              syncEyeButtons();
              return;
            }
          } catch (_) {}
          run();
        }, 40);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const onCustom = () => {
        syncEyeButtons();
        run();
      };
      window.addEventListener("dsh:self-use:model-custom", onCustom);
      // 先等 Host 配置回来再注入，避免按钮初始状态与实际保存值不一致。
      syncModelCustomFromHost().then(
        () => run(),
        () => run()
      );
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        observer.disconnect();
        document.removeEventListener("click", onClick, true);
        window.removeEventListener("dsh:self-use:model-custom", onCustom);
        document.querySelectorAll(".dsh-self-use-eye").forEach((btn) => btn.remove());
      };
    }

    /** 当前页面上眼睛按钮的数量与归属，用来判断是否需要重扫 DOM。 */
    function eyeSignature() {
      const parts = [];
      document.querySelectorAll(".dsh-self-use-eye").forEach((btn) => {
        const group = btn.getAttribute(MODEL_GROUP_EYE_ATTR);
        const model = btn.getAttribute(MODEL_EYE_ATTR);
        parts.push(group !== null ? "g:" + group : "m:" + String(model));
      });
      parts.sort();
      return parts.join("|");
    }
    // #endregion
    // #region dsh-self-use: question wait settings section
    function createQuestionWaitSection(Row) {
      function QuestionWaitSection(props) {
        const api = props === null || typeof props !== "object" ? {} : props;
        const [state, setState] = React.useState({ status: "loading", minutes: 10, error: "", note: "" });
        const [busy, setBusy] = React.useState(false);
        const alive = React.useRef(true);
        React.useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        React.useEffect(() => {
          (async () => {
            const result = await getJson("/question-wait");
            if (alive.current !== true) return;
            if (result.ok !== true || payloadError(result, "") !== "") {
              setState((prev) => Object.assign({}, prev, { status: "unavailable", error: result.error }));
              return;
            }
            const config = result.data.config !== null && typeof result.data.config === "object" ? result.data.config : {};
            setState((prev) =>
              Object.assign({}, prev, {
                status: "ready",
                minutes: clampQuestionWaitMinutes(config.minutes),
                error: ""
              })
            );
          })();
        }, []);

        const save = async (minutes) => {
          if (busy) return;
          setBusy(true);
          const result = await postJson("/question-wait", { minutes: minutes });
          if (alive.current !== true) return;
          setBusy(false);
          if (result.ok !== true || payloadError(result, "") !== "") {
            setState((prev) => Object.assign({}, prev, { error: result.error, note: "" }));
            return;
          }
          const config = result.data.config !== null && typeof result.data.config === "object" ? result.data.config : {};
          setState((prev) =>
            Object.assign({}, prev, {
              status: "ready",
              minutes: clampQuestionWaitMinutes(config.minutes),
              error: "",
              note: "已保存：" + clampQuestionWaitMinutes(config.minutes) + " 分钟"
            })
          );
        };

        const ready = state.status === "ready";
        const note =
          state.status === "loading"
            ? "正在读取…"
            : state.note !== ""
              ? state.note
              : "提问时每 " +
                state.minutes +
                " 分钟没有修改输入框内容，才会判定为超时；期间任何输入变化都会重新计时。";

        return React.createElement(
          "div",
          { className: "dsh-self-use-subsection" },
          React.createElement("div", { className: "dsh-self-use-subtitle" }, "提问等待"),
          React.createElement(
            "div",
            { className: "dsh-self-use-row dsh-self-use-row-inline" },
            React.createElement(
              "div",
              { className: "dsh-self-use-row-main" },
              React.createElement("div", { className: "dsh-self-use-row-title" }, "最大等待时长（分钟）"),
              React.createElement(
                "div",
                { className: "dsh-self-use-row-desc" },
                "提问后等待你作答的上限。只统计「连续没有输入」的时间：你每次修改输入框内容都会重新开始计时，所以输入慢不会被打断。"
              ),
              React.createElement("div", { className: "dsh-self-use-row-note" }, note)
            ),
            React.createElement("input", {
              type: "number",
              className: "dsh-self-use-minutes",
              min: 1,
              max: 1440,
              step: 1,
              value: String(state.minutes),
              "aria-label": "提问最大等待分钟数",
              disabled: !ready || busy,
              onChange: (event) => {
                const next = clampQuestionWaitMinutes(event.target.value);
                setState((prev) => Object.assign({}, prev, { minutes: next, note: "" }));
              },
              onBlur: (event) => {
                const next = clampQuestionWaitMinutes(event.target.value);
                if (next !== state.minutes) return;
                save(next);
              }
            }),
            React.createElement(
              "button",
              {
                type: "button",
                className: "dsh-self-use-button",
                disabled: !ready || busy,
                onClick: () => save(state.minutes)
              },
              "保存"
            )
          ),
          state.status === "unavailable" && state.error !== ""
            ? React.createElement("div", { className: "dsh-self-use-row-error" }, state.error)
            : null
        );
      }
      return QuestionWaitSection;
    }
    // #endregion

    // #region dsh-self-use: question wait activity watcher
    /**
     * 监听输入框内容变化并通知 Host 重置提问倒计时。
     * 覆盖两处输入：会话输入框（Lexical contenteditable）与提问卡里的 textarea。
     */
    function installQuestionActivityWatch() {
      if (typeof document === "undefined") return () => {};
      let lastText = "";
      let lastSent = 0;
      let pending = false;
      let disposed = false;

      const readComposerText = () => {
        const nodes = document.querySelectorAll("[data-composer-input], textarea");
        let text = "";
        for (const node of nodes) {
          const value = node.value !== undefined ? node.value : node.textContent;
          if (typeof value === "string" && value !== "") text += value;
        }
        return text;
      };

      const report = () => {
        if (disposed) return;
        const now = Date.now();
        // 至少间隔 500ms，避免每次按键都打一次请求。
        if (now - lastSent < 500) {
          pending = true;
          return;
        }
        pending = false;
        lastSent = now;
        postJson("/question-wait", { activity: true }).catch(() => {});
      };

      const check = () => {
        if (disposed) return;
        const text = readComposerText();
        if (text === lastText) return;
        lastText = text;
        report();
      };

      // 捕获阶段监听，Lexical 的输入不会冒泡到 document 的普通监听。
      const onInput = () => {
        check();
      };
      document.addEventListener("input", onInput, true);
      document.addEventListener("keyup", onInput, true);
      document.addEventListener("compositionend", onInput, true);
      document.addEventListener("paste", onInput, true);
      document.addEventListener("change", onInput, true);

      // 兜底轮询：某些编辑路径不触发 input 事件。
      const timer = window.setInterval(() => {
        if (pending) report();
        check();
      }, 1000);

      return () => {
        disposed = true;
        document.removeEventListener("input", onInput, true);
        document.removeEventListener("keyup", onInput, true);
        document.removeEventListener("compositionend", onInput, true);
        document.removeEventListener("paste", onInput, true);
        document.removeEventListener("change", onInput, true);
        window.clearInterval(timer);
      };
    }
    // #endregion

    function createFileManagerSection(Row) {
      function FileManagerSection(props) {
        const api = props === null || typeof props !== "object" ? {} : props;
        const persist = typeof api.persist === "function" ? api.persist : () => {};
        const [prefs, setPrefs] = React.useState(() =>
          typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()
        );

        React.useEffect(() => {
          return subscribePrefs((next) => {
            setPrefs(next);
          });
        }, []);

        const enabled = prefs.fileManager === true;
        const current = typeof prefs.fileRefreshMs === "number" ? prefs.fileRefreshMs : 5000;

        return React.createElement(
          "div",
          { className: "dsh-self-use-subsection" },
          React.createElement("div", { className: "dsh-self-use-subsection-title" }, "文件管理增强"),
          React.createElement(
            "div",
            { className: "dsh-self-use-subsection-desc" },
            "在右侧「文件」面板的每个条目后加上：复制路径、下载、删除。顶部路径可逐级点击，也可用 ./ 进入上级目录。"
          ),
          React.createElement(Row, {
            title: "切会话保留已粘贴图片",
            description: "开启后，粘贴进输入框的图片会在切换会话再切回时自动补回。只在本浏览器标签页内有效，关闭页面后不保留；每会话最多 10 张、单张不超过 8MB。",
            checked: prefs.imageRescue === true,
            onToggle: (next) => persist({ imageRescue: next })
          }),
          React.createElement(Row, {
            title: "启用文件管理增强",
            description: "开启后右侧文件面板出现操作图标。删除为永久删除，会先弹确认框。",
            checked: enabled,
            onToggle: (next) => persist({ fileManager: next })
          }),
          React.createElement(
            "div",
            { className: "dsh-self-use-row dsh-self-use-row-inline" },
            React.createElement(
              "div",
              { className: "dsh-self-use-row-main" },
              React.createElement("div", { className: "dsh-self-use-row-title" }, "自动刷新间隔"),
              React.createElement(
                "div",
                { className: "dsh-self-use-row-desc" },
                "文件列表自动重新读取的间隔。选「不自动刷新」时只在手动点刷新时更新。"
              )
            ),
            React.createElement(
              "select",
              {
                className: "dsh-self-use-input",
                value: String(current),
                disabled: enabled !== true,
                onChange: (event) => {
                  const next = Number(event.target.value);
                  persist({ fileRefreshMs: next });
                }
              },
              FILE_REFRESH_CHOICES.map((choice) =>
                React.createElement(
                  "option",
                  { key: String(choice.value), value: String(choice.value) },
                  choice.label
                )
              )
            )
          )
        );
      }
      return FileManagerSection;
    }

    function createCleanupSection(Row) {
      function CleanupSection(props) {
        const api = props === null || typeof props !== "object" ? {} : props;
        const persist = typeof api.persist === "function" ? api.persist : () => {};
        const [prefs, setPrefs] = React.useState(() =>
          typeof api.readPrefs === "function" ? api.readPrefs() : readPrefs()
        );

        const [scan, setScan] = React.useState({ status: "idle", error: "", sessions: [], skipped: [], partial: false });
        const [selected, setSelected] = React.useState({});
        const [confirming, setConfirming] = React.useState(false);
        const [deleting, setDeleting] = React.useState(false);
        const [deleteReport, setDeleteReport] = React.useState({ tone: "", text: "", failures: [] });

        const [auto, setAuto] = React.useState({ status: "loading", enabled: false, minutes: 60, lastRun: null, error: "" });
        const [autoBusy, setAutoBusy] = React.useState(false);
        const [autoError, setAutoError] = React.useState("");

        const alive = React.useRef(true);
        React.useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        React.useEffect(() => {
          return subscribePrefs((next) => {
            setPrefs(next);
          });
        }, []);

        const loadAuto = async () => {
          const result = await getJson("/auto-cleanup");
          if (alive.current !== true) return;
          if (result.ok !== true || payloadError(result, "") !== "") {
            setAuto({
              status: "unavailable",
              enabled: prefs.autoCleanup === true,
              minutes: clampMinutes(prefs.autoCleanupMinutes),
              lastRun: null,
              error: result.error
            });
            return;
          }
          const config = result.data.config !== null && typeof result.data.config === "object" ? result.data.config : {};
          const lastRun =
            result.data.lastRun !== null && typeof result.data.lastRun === "object" ? result.data.lastRun : null;
          setAuto({
            status: "ready",
            enabled: config.enabled === true,
            minutes: clampMinutes(config.minutes),
            lastRun: lastRun,
            error: ""
          });
        };

        React.useEffect(() => {
          loadAuto();
        }, []);

        const toggleAll = (sessions, next) => {
          const map = {};
          for (let index = 0; index < sessions.length; index += 1) {
            const session = sessions[index];
            if (session !== null && typeof session === "object" && typeof session.sessionId === "string") {
              map[session.sessionId] = next;
            }
          }
          return map;
        };

        const runScan = async () => {
          setScan({ status: "loading", error: "", sessions: [], skipped: [], partial: false });
          setConfirming(false);
          const result = await getJson("/empty-sessions");
          if (alive.current !== true) return;
          if (result.ok !== true) {
            setScan({ status: "error", error: result.error, sessions: [], skipped: [], partial: false });
            return;
          }
          const payloadFailure = payloadError(result, "Host 返回了失败结果");
          if (payloadFailure !== "") {
            setScan({ status: "error", error: payloadFailure, sessions: [], skipped: [], partial: false });
            return;
          }
          const sessions = Array.isArray(result.data.sessions) ? result.data.sessions : [];
          const skipped = Array.isArray(result.data.skipped) ? result.data.skipped : [];
          setScan({
            status: "ready",
            error: "",
            sessions: sessions,
            skipped: skipped,
            partial: result.data.partial === true
          });
          setSelected(toggleAll(sessions, true));
        };

        const selectedIds = () => {
          const ids = [];
          for (let index = 0; index < scan.sessions.length; index += 1) {
            const session = scan.sessions[index];
            if (session === null || typeof session !== "object") continue;
            const id = session.sessionId;
            if (typeof id === "string" && selected[id] === true) ids.push(id);
          }
          return ids;
        };

        const selectedCount = selectedIds().length;

        const runDelete = async () => {
          const ids = selectedIds();
          if (ids.length === 0) return;
          setDeleting(true);
          setConfirming(false);
          setDeleteReport({ tone: "", text: "", failures: [] });
          let result;
          try {
            result = await postJson("/empty-sessions/delete", { sessionIds: ids });
          } catch (error) {
            if (alive.current !== true) return;
            setDeleting(false);
            setDeleteReport({ tone: "error", text: "删除失败：" + errorText(error), failures: [] });
            return;
          }
          if (alive.current !== true) return;
          setDeleting(false);
          if (result.ok !== true) {
            setDeleteReport({ tone: "error", text: "删除失败：" + result.error, failures: [] });
            return;
          }
          const payloadFailure = payloadError(result, "Host 返回了失败结果");
          if (payloadFailure !== "") {
            setDeleteReport({ tone: "error", text: "删除失败：" + payloadFailure, failures: [] });
            return;
          }
          const payload = result.data.result !== null && typeof result.data.result === "object" ? result.data.result : {};
          const summary = payload.summary !== null && typeof payload.summary === "object" ? payload.summary : {};
          const items = Array.isArray(payload.items) ? payload.items : [];
          const failures = [];
          for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (item !== null && typeof item === "object" && item.status !== "success" && item.status !== "ok") {
              failures.push(failureTextOf(item));
            }
          }
          const success = typeof summary.success === "number" ? summary.success : 0;
          setDeleteReport({
            tone: success > 0 ? "ok" : "error",
            text: "删除完成：" + summaryTextOf(summary),
            failures: failures
          });
          await runScan();
        };

        const saveAuto = async (enabled, minutes) => {
          if (autoBusy) return;
          setAutoBusy(true);
          setAutoError("");
          const previousEnabled = prefs.autoCleanup === true;
          const previousMinutes = clampMinutes(prefs.autoCleanupMinutes);
          persist({ autoCleanup: enabled, autoCleanupMinutes: minutes });
          const result = await postJson("/auto-cleanup", { enabled: enabled, minutes: minutes });
          if (alive.current !== true) return;
          setAutoBusy(false);
          const payloadFailure = payloadError(result, "");
          if (result.ok !== true || payloadFailure !== "") {
            persist({ autoCleanup: previousEnabled, autoCleanupMinutes: previousMinutes });
            setAutoError("保存自动清理设置失败：" + (result.ok !== true ? result.error : payloadFailure));
            return;
          }
          const config = result.data.config !== null && typeof result.data.config === "object" ? result.data.config : {};
          setAuto((current) => ({
            status: "ready",
            enabled: config.enabled === true,
            minutes: clampMinutes(config.minutes),
            lastRun: current.lastRun,
            error: ""
          }));
          persist({ autoCleanup: config.enabled === true, autoCleanupMinutes: clampMinutes(config.minutes) });
        };

        const autoReady = auto.status === "ready";
        const autoUnavailable = auto.status === "unavailable";

        let autoNote = "";
        if (auto.status === "loading") autoNote = "正在读取自动清理设置…";
        else if (autoUnavailable) autoNote = AUTO_CLEANUP_UNAVAILABLE_TEXT;
        else if (autoError !== "") autoNote = autoError;
        else if (auto.lastRun !== null && typeof auto.lastRun === "object") {
          const deleted = typeof auto.lastRun.deleted === "number" ? auto.lastRun.deleted : 0;
          autoNote = "上次运行：" + formatLocalTime(auto.lastRun.at) + "，删除 " + deleted + " 个会话";
        } else autoNote = "尚未运行过自动清理";

        let scanStatus = "";
        if (scan.status === "loading") scanStatus = "正在扫描空会话…";
        else if (scan.status === "ready" && scan.sessions.length === 0) scanStatus = "没有空会话，很干净";
        else if (scan.status === "ready") {
          scanStatus = "共 " + scan.sessions.length + " 个空会话，已选 " + selectedCount + " 个";
        }

        const minutesInput = React.createElement("input", {
          type: "number",
          className: "dsh-self-use-minutes",
          min: AUTO_CLEANUP_MINUTES_MIN,
          max: AUTO_CLEANUP_MINUTES_MAX,
          step: 1,
          value: String(clampMinutes(auto.minutes)),
          "aria-label": "自动清理超过多少分钟的空会话",
          disabled: !autoReady || autoBusy,
          onChange: (event) => {
            const next = clampMinutes(event.target.value);
            setAuto((current) => ({ ...current, minutes: next }));
          },
          onBlur: (event) => {
            const next = clampMinutes(event.target.value);
            setAuto((current) => ({ ...current, minutes: next }));
            if (auto.enabled === true && next !== clampMinutes(auto.minutes)) saveAuto(true, next);
          }
        });

        const listItems = [];
        for (let index = 0; index < scan.sessions.length; index += 1) {
          const session = scan.sessions[index];
          if (session === null || typeof session !== "object") continue;
          const id = typeof session.sessionId === "string" ? session.sessionId : "";
          const cwd = typeof session.cwd === "string" && session.cwd !== "" ? session.cwd : "未知目录";
          const events = typeof session.eventCount === "number" ? session.eventCount : 0;
          listItems.push(
            React.createElement(
              "li",
              { className: "dsh-self-use-list-item", key: "empty-session-" + id + "-" + index },
              React.createElement("input", {
                type: "checkbox",
                className: "dsh-self-use-list-check",
                checked: selected[id] === true,
                "aria-label": "选择会话 " + id,
                onChange: () => {
                  setSelected((current) => {
                    const next = { ...current };
                    next[id] = current[id] !== true;
                    return next;
                  });
                  setConfirming(false);
                }
              }),
              React.createElement(
                "div",
                { className: "dsh-self-use-list-main" },
                React.createElement(
                  "div",
                  { className: "dsh-self-use-list-id", title: id },
                  shortId(id) === "" ? "（无 ID）" : shortId(id)
                ),
                React.createElement("div", { className: "dsh-self-use-list-meta", title: cwd }, cwd),
                React.createElement(
                  "div",
                  { className: "dsh-self-use-list-meta" },
                  "创建于 " + formatLocalTime(session.createdAt) + " · 事件数 " + events
                )
              )
            )
          );
        }

        const skippedNode =
          scan.skipped.length === 0
            ? null
            : React.createElement(
                "details",
                { className: "dsh-self-use-details" },
                React.createElement("summary", null, "有 " + scan.skipped.length + " 个会话被跳过，查看原因"),
                React.createElement(
                  "ul",
                  { className: "dsh-self-use-list", style: { padding: "6px 10px", listStyle: "disc inside" } },
                  scan.skipped.map((item, index) => {
                    const row = item !== null && typeof item === "object" ? item : {};
                    const id = typeof row.sessionId === "string" ? row.sessionId : "（未知会话）";
                    const reason = typeof row.reason === "string" && row.reason !== "" ? row.reason : "未提供原因";
                    return React.createElement("li", { key: "skip-" + index, className: "dsh-self-use-list-meta" }, id + " — " + reason);
                  })
                )
              );

        const confirmNode =
          confirming !== true
            ? null
            : React.createElement(
                "div",
                { className: "dsh-self-use-confirm", role: "alertdialog" },
                React.createElement(
                  "div",
                  { className: "dsh-self-use-confirm-text" },
                  "确认删除这 " + selectedCount + " 个空会话？删除不可恢复。"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-self-use-button is-danger",
                    disabled: deleting,
                    onClick: runDelete
                  },
                  deleting ? "正在删除…" : "确认删除"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-self-use-button is-quiet",
                    disabled: deleting,
                    onClick: () => setConfirming(false)
                  },
                  "取消"
                )
              );

        const reportNode =
          deleteReport.text === "" && deleteReport.failures.length === 0
            ? null
            : React.createElement(
                "div",
                { className: "dsh-self-use-actions", style: { flexDirection: "column", alignItems: "flex-start" } },
                deleteReport.text === ""
                  ? null
                  : React.createElement(
                      "div",
                      {
                        className: deleteReport.tone === "error" ? "dsh-self-use-row-error" : "dsh-self-use-row-note",
                        role: "status"
                      },
                      deleteReport.text
                    ),
                deleteReport.failures.length === 0
                  ? null
                  : React.createElement(
                      "div",
                      { className: "dsh-self-use-row-error" },
                      "失败项：" + deleteReport.failures.join("；")
                    )
              );

        return React.createElement(
          "div",
          { className: "dsh-self-use-subsection" },
          React.createElement("div", { className: "dsh-self-use-subsection-title" }, "空会话清理"),
          React.createElement(
            "div",
            { className: "dsh-self-use-subsection-desc" },
            "空会话是指创建后从未收到任何用户提问的会话，删除后不可恢复。"
          ),
          React.createElement(
            "div",
            { className: "dsh-self-use-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "dsh-self-use-button",
                disabled: scan.status === "loading",
                onClick: runScan
              },
              scan.status === "loading" ? "扫描中…" : "扫描空会话"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "dsh-self-use-button",
                disabled: scan.status !== "ready" || scan.sessions.length === 0 || deleting,
                onClick: () =>
                  setSelected((current) => {
                    const allSelected = selectedCount === scan.sessions.length && scan.sessions.length > 0;
                    return toggleAll(scan.sessions, allSelected !== true);
                  })
              },
              "全选 / 全不选"
            )
          ),
          scanStatus === ""
            ? null
            : React.createElement(
                "div",
                { className: "dsh-self-use-row-note", role: "status" },
                scanStatus
              ),
          scan.status === "error"
            ? React.createElement("div", { className: "dsh-self-use-row-error", role: "alert" }, "扫描失败：" + scan.error)
            : null,
          scan.partial === true
            ? React.createElement("div", { className: "dsh-self-use-row-error" }, "扫描超时，结果可能不完整")
            : null,
          listItems.length === 0 ? null : React.createElement("ul", { className: "dsh-self-use-list" }, listItems),
          skippedNode,
          scan.status === "ready" && scan.sessions.length > 0
            ? React.createElement(
                "div",
                { className: "dsh-self-use-actions" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-self-use-button is-danger",
                    disabled: selectedCount === 0 || deleting,
                    onClick: () => setConfirming(true)
                  },
                  "删除选中 (" + selectedCount + ")"
                ),
                React.createElement("span", { className: "dsh-self-use-danger-note" }, "删除不可恢复")
              )
            : null,
          confirmNode,
          reportNode,
          React.createElement(Row, {
            title: "自动清理空会话",
            description:
              "开启后，插件会在后台自动删除超过 " +
              clampMinutes(auto.minutes) +
              " 分钟仍没有任何用户提问的会话。删除不可恢复。",
            checked: auto.enabled === true,
            disabled: !autoReady,
            busy: autoBusy,
            note: autoNote,
            onToggle: (next) => saveAuto(next, clampMinutes(auto.minutes))
          }),
          React.createElement(
            "div",
            { className: "dsh-self-use-actions" },
            React.createElement("span", { className: "dsh-self-use-row-desc" }, "超过"),
            minutesInput,
            React.createElement("span", { className: "dsh-self-use-row-desc" }, "分钟（1-10080）"),
            React.createElement(
              "button",
              {
                type: "button",
                className: "dsh-self-use-button",
                disabled: !autoReady || autoBusy,
                onClick: () => saveAuto(auto.enabled === true, clampMinutes(auto.minutes))
              },
              "保存"
            )
          ),
        );
      }

      return CleanupSection;
    }
    // #endregion

    // #region dsh-self-use: sticky prompt bar
    function plainTextOf(node) {
      const raw = node !== null && typeof node.textContent === "string" ? node.textContent : "";
      let out = "";
      let pendingSpace = false;
      for (let index = 0; index < raw.length; index += 1) {
        const code = raw.charCodeAt(index);
        const isSpace = code === 32 || code === 9 || code === 10 || code === 13 || code === 12288;
        if (isSpace) {
          if (out.length > 0) pendingSpace = true;
          continue;
        }
        if (pendingSpace) {
          out += " ";
          pendingSpace = false;
        }
        out += raw[index];
      }
      return out;
    }

    // 收集「用户提问行」，兼容官方 chat 视图与第三方阅读视图两种 DOM。
    // 两套属性都基于同一份会话数据渲染，顺序一致，取最后一条即可。
    function collectPromptRows(scrollEl) {
      const official = scrollEl.querySelectorAll("[data-chat-flow-kind='user'][data-chat-anchor-key]");
      if (official.length > 0) return official;
      // 阅读视图：用户消息是 .userCluster（data-reader-anchor + data-reader-key）。
      // 用 class 精确匹配，避免把 reasoning/answer 等其它锚点当成提问。
      const clusters = scrollEl.querySelectorAll("[data-reader-anchor][data-reader-key]");
      const picked = [];
      for (let index = 0; index < clusters.length; index += 1) {
        const node = clusters[index];
        const cls = typeof node.className === "string" ? node.className : "";
        if (cls.indexOf("userCluster") >= 0) picked.push(node);
      }
      return picked;
    }

    function mountStickyPrompt() {
      let host = null;
      let hostPrevPosition = null;
      let scrollEl = null;
      let bar = null;
      let chip = null;
      let textEl = null;
      let rowEl = null;
      let expandButton = null;
      let expanded = false;
      let activeRow = null;
      let signature = "";
      let scrollTimer = null;
      let mutationTimer = null;
      let flashTimer = null;
      let observer = null;
      let unsubscribe = null;
      let stopped = false;

      const buildBar = () => {
        bar = document.createElement("div");
        bar.className = "dsh-self-use-sticky";
        bar.hidden = true;
        bar.setAttribute("data-dsh-self-use-sticky", "");
        // 外层负责定位，内层负责 [正文, 展开按钮] 的横向排布与最大宽度。
        rowEl = document.createElement("div");
        rowEl.className = "dsh-self-use-sticky-row";
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "dsh-self-use-sticky-chip";
        const tag = document.createElement("span");
        tag.className = "dsh-self-use-sticky-tag";
        tag.textContent = "置顶";
        textEl = document.createElement("span");
        textEl.className = "dsh-self-use-sticky-text";
        chip.appendChild(tag);
        chip.appendChild(textEl);
        chip.addEventListener("click", onClick);
        // 展开按钮：默认灰色，点击变蓝并让正文从第二行起完整折行显示。
        expandButton = document.createElement("button");
        expandButton.type = "button";
        expandButton.className = "dsh-self-use-sticky-expand";
        expandButton.setAttribute("data-dsh-self-use-expand", "");
        expandButton.setAttribute("aria-label", "展开完整提问");
        expandButton.setAttribute("aria-expanded", "false");
        expandButton.setAttribute("title", "展开完整提问");
        expandButton.textContent = "⌄";
        expandButton.addEventListener("click", onToggleExpand);
        rowEl.appendChild(chip);
        rowEl.appendChild(expandButton);
        bar.appendChild(rowEl);
      };

      const onClick = (event) => {
        if (event !== null && typeof event.preventDefault === "function") event.preventDefault();
        const row = activeRow;
        if (row === null || row.isConnected !== true) return;
        try {
          row.scrollIntoView({ block: "start", behavior: "smooth" });
        } catch (error) {
          row.scrollIntoView();
        }
        row.classList.add("dsh-self-use-flash");
        if (flashTimer !== null) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          flashTimer = null;
          row.classList.remove("dsh-self-use-flash");
        }, 1200);
      };

      // 展开/收起：只切换 class，正文折行交给 CSS，避免重排抖动。
      const applyExpanded = (next) => {
        expanded = next === true;
        if (bar !== null) {
          if (expanded) bar.classList.add("is-expanded");
          else bar.classList.remove("is-expanded");
        }
        if (expandButton !== null) {
          expandButton.setAttribute("aria-expanded", expanded ? "true" : "false");
          expandButton.setAttribute("aria-label", expanded ? "收起提问" : "展开完整提问");
          expandButton.setAttribute("title", expanded ? "收起提问" : "展开完整提问");
          expandButton.textContent = expanded ? "⌃" : "⌄";
        }
      };

      const onToggleExpand = (event) => {
        if (event !== null && typeof event.preventDefault === "function") event.preventDefault();
        if (event !== null && typeof event.stopPropagation === "function") event.stopPropagation();
        applyExpanded(!expanded);
      };

      const setBarHidden = (next) => {
        if (bar === null) return;
        if (bar.hidden === next) return;
        bar.hidden = next;
      };

      const hideBar = () => {
        activeRow = null;
        signature = "";
        applyExpanded(false);
        setBarHidden(true);
      };

      const attachHost = () => {
        try {
          const style = window.getComputedStyle(host);
          if (style.position === "static") {
            hostPrevPosition = host.style.position;
            host.style.position = "relative";
          }
        } catch (error) {
          warn("设置会话容器定位失败", error);
        }
        if (bar === null) buildBar();
        if (bar.parentNode !== host) host.appendChild(bar);
      };

      const detachHost = () => {
        if (scrollEl !== null) {
          scrollEl.removeEventListener("scroll", onScroll);
          scrollEl = null;
        }
        if (bar !== null && bar.parentNode !== null) bar.parentNode.removeChild(bar);
        if (host !== null && hostPrevPosition !== null) {
          host.style.position = hostPrevPosition;
        }
        hostPrevPosition = null;
        host = null;
        activeRow = null;
        signature = "";
        if (bar !== null) bar.hidden = true;
      };

      const ensureHost = () => {
        const candidates = document.querySelectorAll("[data-conversation-content]");
        let nextHost = null;
        for (let index = 0; index < candidates.length; index += 1) {
          const node = candidates[index];
          if (node.querySelector("[data-conversation-scroll]") !== null) {
            nextHost = node;
            break;
          }
        }
        if (nextHost === null && candidates.length > 0) nextHost = candidates[0];
        if (nextHost !== host) {
          detachHost();
          host = nextHost;
          if (host !== null) attachHost();
        }
        if (host === null) return false;
        if (host.isConnected !== true) {
          detachHost();
          return false;
        }
        if (bar !== null && bar.parentNode !== host) host.appendChild(bar);
        const nextScroll = host.querySelector("[data-conversation-scroll]");
        if (nextScroll !== scrollEl) {
          if (scrollEl !== null) scrollEl.removeEventListener("scroll", onScroll);
          scrollEl = nextScroll;
          if (scrollEl !== null) scrollEl.addEventListener("scroll", onScroll, { passive: true });
        }
        return scrollEl !== null;
      };

      const update = () => {
        if (stopped || host === null || scrollEl === null || bar === null) return;
        if (readPrefs().stickyPrompt !== true) {
          hideBar();
          return;
        }
        const sessionId = host.getAttribute("data-conversation-session");
        if (sessionId === null || sessionId === "") {
          hideBar();
          return;
        }
        // 提问行的锚点有两套来源，必须都试：
        //   1. 官方 chat 视图：data-chat-flow-kind="user" + data-chat-anchor-key
        //   2. 第三方阅读视图（如 dsh-better-display 以 order:-5 抢占 conversation.view）：
        //      data-reader-anchor + data-reader-key，用户消息是 .userCluster
        // 只认官方属性时，阅读视图下 rows 恒为 0，置顶栏永远不出现。
        const rows = collectPromptRows(scrollEl);
        const viewportRect = scrollEl.getBoundingClientRect();
        const viewportTop = viewportRect.top;
        let latest = null;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          if (row.hasAttribute("hidden")) continue;
          const rect = row.getBoundingClientRect();
          if (rect.height <= 0) continue;
          // 只有整条提问完全滚出视口顶部（气泡底部也越过顶部）才算「已离开」。
          // 气泡还有任何部分可见时不出置顶条，避免遮住顶部按钮、也不重复展示同一段内容。
          if (rect.bottom < viewportTop) latest = row;
        }
        if (latest === null) {
          // 当前提问仍完整可见：不需要置顶，收起即可。
          hideBar();
          return;
        }
        const anchor =
          latest.getAttribute("data-chat-anchor-key") !== null
            ? latest.getAttribute("data-chat-anchor-key")
            : latest.getAttribute("data-reader-key");
        const text = plainTextOf(latest);
        const nextSignature = String(anchor) + "|" + text;
        if (nextSignature === signature && bar.hidden === false) {
          activeRow = latest;
          return;
        }
        signature = nextSignature;
        activeRow = latest;
        // 切换到另一条提问时收起，避免旧提问的展开态沿用到新提问。
        applyExpanded(false);
        textEl.textContent = text === "" ? "（空提问）" : text;
        chip.setAttribute("title", text === "" ? "回到该条提问" : text);
        chip.setAttribute("aria-label", "回到这条提问：" + text);
        setBarHidden(false);
      };

      const onScroll = () => {
        if (scrollTimer !== null) return;
        scrollTimer = window.setTimeout(() => {
          scrollTimer = null;
          if (stopped) return;
          update();
        }, 20);
      };

      const onResize = () => {
        if (mutationTimer !== null) return;
        mutationTimer = window.setTimeout(() => {
          mutationTimer = null;
          sync();
        }, 20);
      };

      const sync = () => {
        if (stopped) return;
        if (!ensureHost()) {
          hideBar();
          return;
        }
        update();
      };

      const onMutation = () => {
        if (mutationTimer !== null) return;
        mutationTimer = window.setTimeout(() => {
          mutationTimer = null;
          sync();
        }, 20);
      };

      observer = new MutationObserver(onMutation);
      const observeRoot = document.body !== null ? document.body : document.documentElement;
      if (observeRoot !== null) {
        observer.observe(observeRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-conversation-session"]
        });
      }
      window.addEventListener("resize", onResize);
      unsubscribe = subscribePrefs(() => {
        sync();
      });
      sync();

      return () => {
        stopped = true;
        if (scrollTimer !== null) {
          window.clearTimeout(scrollTimer);
          scrollTimer = null;
        }
        if (mutationTimer !== null) {
          window.clearTimeout(mutationTimer);
          mutationTimer = null;
        }
        if (flashTimer !== null) {
          window.clearTimeout(flashTimer);
          flashTimer = null;
        }
        if (observer !== null) {
          observer.disconnect();
          observer = null;
        }
        window.removeEventListener("resize", onResize);
        if (unsubscribe !== null) {
          unsubscribe();
          unsubscribe = null;
        }
        detachHost();
        if (bar !== null) {
          chip.removeEventListener("click", onClick);
          if (bar.parentNode !== null) bar.parentNode.removeChild(bar);
        }
        bar = null;
        chip = null;
        textEl = null;
      };
    }
    // #endregion

    // #region dsh-self-use: plugin body
    // cordis 的 inject 是点号路径精确声明：只写 "remote" 无法访问 remote.settings / remote.skills，
    // 访问会抛 cannot get property "remote.skills" without inject。官方 ui-skill / ui-reference
    // 同样显式声明 remote.skills、remote.fileReferences 等子命名空间。
    const inject = ["slots", "sessions", "remote", "remote.settings", "remote.skills", "inputTriggers"];

    function apply(ctx) {
      ctx.effect(() => {
        let tag = document.querySelector("style[data-plugin-css='" + STYLE_ID + "']");
        if (tag === null) {
          tag = document.createElement("style");
          tag.dataset.plugin = PLUGIN_ID;
          tag.dataset.pluginCss = STYLE_ID;
          tag.textContent = CSS_TEXT;
          document.head.appendChild(tag);
        }
        return () => {
          if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag);
        };
      }, "dsh-self-use: styles");

      const sectionInjected = () => ({
        readPrefs,
        writePrefs,
        ctx: ctx,
        readPermissionState: () => readPermissionState(ctx),
        applyAutoFullAccess: (enabled) => applyAutoFullAccess(ctx, enabled)
      });

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: PLUGIN_ID,
            order: 60,
            label: () => "自用插件",
            inject: sectionInjected
          },
          createSettingsSection()
        )
      );

      // 启动时先与 Host 对齐偏好：localStorage 按源隔离，同一份设置要在
      // 127.0.0.1 与局域网地址之间共享，必须以 Host 为准。
      syncPrefsFromHost();
      syncSkillsFromHost();
      fmContext = ctx;
      try {
        fmSidebarRight = serviceOf(ctx, "sidebarRight") || null;
      } catch (_) {
        fmSidebarRight = null;
      }
      registerPreviewToolbar(ctx);
      ctx.effect(() => mountFileManager(), "dsh-self-use: file manager");
      ctx.effect(() => installImageRescue(), "dsh-self-use: image rescue");

      ctx.effect(() => mountStickyPrompt(), "dsh-self-use: sticky prompt");
      ctx.effect(() => installQuestionActivityWatch(), "dsh-self-use: question activity watch");
      ctx.effect(() => installModelEyeButtons(), "dsh-self-use: model eye buttons");
      wrapModelCatalogForCustom(ctx);
      wrapSelectModelForCustom(ctx);
      // remote.session 可能晚于 apply 就绪：周期性重试包装，直到成功为止。
      const wrapRetry = window.setInterval(() => {
        if (pendingCatalogWrap === null) {
          window.clearInterval(wrapRetry);
          return;
        }
        const retry = pendingCatalogWrap;
        pendingCatalogWrap = null;
        retry();
        if (pendingCatalogWrap === null) window.clearInterval(wrapRetry);
      }, 1000);
      ctx.effect(() => () => window.clearInterval(wrapRetry), "dsh-self-use: model wrap retry");
      ctx.effect(() => mountPromptSearch(ctx), "dsh-self-use: prompt search");
      ctx.effect(() => installSubagentFilter(ctx), "dsh-self-use: hide subagent mentions");
      ctx.effect(() => installSkillFilter(ctx), "dsh-self-use: hide auto skills from slash menu");
    }
    // #endregion

    // #region dsh-self-use feature-3: prompt search (Ctrl/Cmd+F)
    function isFindShortcut(event) {
      if (event === null || typeof event !== "object") return false;
      if (event.ctrlKey !== true && event.metaKey !== true) return false;
      if (event.altKey === true || event.shiftKey === true) return false;
      const key = typeof event.key === "string" ? event.key : "";
      if (key === "f" || key === "F") return true;
      return event.code === "KeyF";
    }

    // 会话切换瞬间可能同时存在新旧两个节点，因此不能盲取第一个：
    // 先收集去重后的候选，唯一则直接返回；多个时优先取可见（offsetParent !== null）的；
    // 仍无法唯一确定时返回空串，绝不猜。
    function currentSessionId() {
      let nodes;
      try {
        nodes = document.querySelectorAll("[data-conversation-session]");
      } catch (error) {
        return "";
      }
      if (nodes === null || nodes === undefined) return "";
      const all = [];
      const visible = [];
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node === null || node === undefined || typeof node.getAttribute !== "function") continue;
        const id = node.getAttribute("data-conversation-session");
        if (typeof id !== "string" || id === "") continue;
        if (all.indexOf(id) < 0) all.push(id);
        if (node.offsetParent === null) continue;
        if (visible.indexOf(id) < 0) visible.push(id);
      }
      if (all.length === 1) return all[0];
      if (all.length === 0) return "";
      if (visible.length === 1) return visible[0];
      return "";
    }

    // 纯函数：按 sessionId 取缓存。空 sessionId 一律视为未命中。
    function lookupPromptCache(cacheBySession, sessionId) {
      const miss = { hit: false, prompts: [] };
      if (typeof sessionId !== "string" || sessionId === "") return miss;
      if (cacheBySession === null || typeof cacheBySession !== "object") return miss;
      if (Object.prototype.hasOwnProperty.call(cacheBySession, sessionId) !== true) return miss;
      const prompts = cacheBySession[sessionId];
      if (!Array.isArray(prompts)) return miss;
      return { hit: true, prompts: prompts };
    }

    // 纯函数：决定一次 loadPrompts 的动作。
    // 顺序固定为「先取 sessionId，再判断缓存」，因此永远不会把 A 的缓存给 B。
    function resolvePromptLoad(cacheBySession, sessionId, force) {
      if (typeof sessionId !== "string" || sessionId === "") {
        return { action: "error", sessionId: "", prompts: [], error: "没有找到当前会话，无法查询提问" };
      }
      if (force !== true) {
        const cached = lookupPromptCache(cacheBySession, sessionId);
        if (cached.hit === true) return { action: "cache", sessionId: sessionId, prompts: cached.prompts };
      }
      return { action: "fetch", sessionId: sessionId, prompts: [] };
    }

    function findTurnRow(turn) {
      const scroller = document.querySelector("[data-conversation-scroll]");
      if (scroller === null || scroller === undefined || typeof scroller.querySelector !== "function") return null;
      return scroller.querySelector("[data-chat-flow-kind='user'][data-chat-turn='" + String(turn) + "']");
    }

    function appendSegments(host, text, positions) {
      const segments = highlightSegments(text, positions);
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment.mark === true) {
          const mark = document.createElement("mark");
          mark.textContent = segment.text;
          host.appendChild(mark);
        } else {
          host.appendChild(document.createTextNode(segment.text));
        }
      }
    }

    // 提示词查询浮层的唯一实现：直接操作 DOM，slot 与 body 两条挂载路径共用。
    function createPromptSearchView(handlers) {
      const api = handlers !== null && typeof handlers === "object" ? handlers : {};
      // prompts 由 mount 侧按 sessionId 分键的缓存喂入，view 自身不再持有跨会话缓存。
      const state = { query: "", prompts: [], loaded: false, loading: false, error: "", activeIndex: 0, miss: "" };
      let destroyed = false;

      const backdrop = document.createElement("div");
      backdrop.className = "dsh-self-use-search-backdrop";
      backdrop.setAttribute("data-dsh-self-use-search", "");

      const panel = document.createElement("div");
      panel.className = "dsh-self-use-search-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "提示词查询");

      const head = document.createElement("div");
      head.className = "dsh-self-use-search-head";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "dsh-self-use-search-input";
      input.setAttribute("aria-label", "搜索历史提问");
      input.setAttribute("placeholder", "搜索历史提问（支持模糊匹配）");

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.className = "dsh-self-use-search-button";
      refreshButton.textContent = "刷新";

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "dsh-self-use-search-button";
      closeButton.textContent = "关闭";

      const status = document.createElement("div");
      status.className = "dsh-self-use-search-status";
      status.hidden = true;

      const list = document.createElement("ul");
      list.className = "dsh-self-use-search-list";

      head.appendChild(input);
      head.appendChild(refreshButton);
      head.appendChild(closeButton);
      panel.appendChild(head);
      panel.appendChild(status);
      panel.appendChild(list);
      backdrop.appendChild(panel);

      const matches = () => filterPrompts(state.prompts, state.query);
      const limited = () => {
        const all = matches();
        return all.length > SEARCH_RESULT_LIMIT ? all.slice(0, SEARCH_RESULT_LIMIT) : all;
      };
      const activeIndexOf = (items) => (items.length === 0 ? -1 : Math.min(Math.max(state.activeIndex, 0), items.length - 1));

      const setStatus = (text, isError) => {
        if (text === "") {
          status.hidden = true;
          status.textContent = "";
          status.className = "dsh-self-use-search-status";
          return;
        }
        status.hidden = false;
        status.textContent = text;
        status.className = isError ? "dsh-self-use-search-status is-error" : "dsh-self-use-search-status";
        status.setAttribute("role", isError ? "alert" : "status");
      };

      const render = () => {
        if (destroyed) return;
        while (list.firstChild !== null && list.firstChild !== undefined) list.removeChild(list.firstChild);
        const items = limited();
        const activeIndex = activeIndexOf(items);
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const turn = turnOfPrompt(item.prompt);
          const row = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "dsh-self-use-search-item" + (index === activeIndex ? " is-active" : "");
          button.setAttribute("aria-current", index === activeIndex ? "true" : "false");
          const turnLabel = document.createElement("div");
          turnLabel.className = "dsh-self-use-search-turn";
          turnLabel.textContent = "第 " + turn + " 轮";
          const snippet = snippetOf(item.text, item.positions);
          const textEl = document.createElement("div");
          textEl.className = "dsh-self-use-search-text";
          appendSegments(textEl, snippet.text, snippet.positions);
          button.appendChild(turnLabel);
          button.appendChild(textEl);
          button.addEventListener("click", () => activate(index));
          row.appendChild(button);
          if (state.miss !== "" && state.miss === String(turn)) {
            const miss = document.createElement("div");
            miss.className = "dsh-self-use-search-miss";
            miss.setAttribute("role", "alert");
            miss.textContent = "该提问尚未加载到页面，请向上滚动加载历史后重试";
            row.appendChild(miss);
          }
          list.appendChild(row);
        }
        if (state.loading) setStatus("正在读取提问…", false);
        else if (state.error !== "") setStatus(state.error, true);
        else if (state.loaded === true && items.length === 0) {
          setStatus(state.query.trim() === "" ? "本会话还没有已记录的提问" : "没有匹配的提问", false);
        } else if (matches().length > SEARCH_RESULT_LIMIT) {
          setStatus("共 " + matches().length + " 条匹配，仅显示前 " + SEARCH_RESULT_LIMIT + " 条，请细化关键词", false);
        } else setStatus("", false);
        refreshButton.textContent = state.loading ? "刷新中…" : "刷新";
        refreshButton.disabled = state.loading;
      };

      const close = () => {
        if (typeof api.onClose === "function") api.onClose();
      };

      const activate = (index) => {
        const items = limited();
        const item = items[index];
        if (item === undefined) return;
        const result = typeof api.jumpToTurn === "function" ? api.jumpToTurn(item.prompt) : { ok: false };
        if (result !== null && typeof result === "object" && result.ok === true) {
          state.miss = "";
          close();
          return;
        }
        state.miss = String(turnOfPrompt(item.prompt));
        render();
      };

      const load = async (force) => {
        if (typeof api.loadPrompts !== "function") {
          state.error = "读取提问的通道不可用";
          render();
          return;
        }
        state.loading = true;
        state.error = "";
        render();
        let result;
        try {
          result = await api.loadPrompts(force === true);
        } catch (error) {
          if (destroyed) return;
          state.loading = false;
          state.prompts = [];
          state.loaded = false;
          state.error = "读取提问失败：" + errorText(error);
          render();
          return;
        }
        if (destroyed) return;
        state.loading = false;
        if (result !== null && typeof result === "object" && result.ok === true) {
          state.prompts = Array.isArray(result.prompts) ? result.prompts : [];
          state.loaded = true;
          state.error = "";
          state.activeIndex = 0;
        } else {
          state.prompts = [];
          state.loaded = false;
          state.error =
            result !== null && typeof result === "object" && typeof result.error === "string"
              ? result.error
              : "读取提问失败";
        }
        render();
      };

      const onBackdropMouseDown = (event) => {
        if (event !== null && typeof event === "object" && event.target === backdrop) close();
      };

      const onInputChange = () => {
        state.query = typeof input.value === "string" ? input.value : "";
        state.activeIndex = 0;
        state.miss = "";
        render();
      };

      const onKeyDown = (event) => {
        if (event === null || typeof event !== "object") return;
        if (isFindShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = limited();
          if (items.length === 0) return;
          const activeIndex = activeIndexOf(items);
          const step = event.key === "ArrowDown" ? 1 : -1;
          state.activeIndex = (activeIndex + step + items.length) % items.length;
          state.miss = "";
          render();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          activate(activeIndexOf(limited()));
        }
      };

      input.addEventListener("input", onInputChange);
      refreshButton.addEventListener("click", () => load(true));
      closeButton.addEventListener("click", close);
      panel.addEventListener("keydown", onKeyDown);
      backdrop.addEventListener("mousedown", onBackdropMouseDown);

      const node = backdrop;
      const focus = () => {
        if (typeof input.focus === "function") input.focus();
        if (typeof input.select === "function") input.select();
      };
      const refresh = () => {
        if (state.loaded !== true) load(false);
        render();
      };
      // 会话切换时清空已显示的结果，避免旧会话的提问继续留在面板上。
      const reset = () => {
        if (destroyed) return;
        state.prompts = [];
        state.loaded = false;
        state.error = "";
        state.activeIndex = 0;
        state.miss = "";
        render();
      };
      const currentSession = () => (typeof api.sessionId === "function" ? api.sessionId() : "");
      const destroy = () => {
        destroyed = true;
        input.removeEventListener("input", onInputChange);
        panel.removeEventListener("keydown", onKeyDown);
        backdrop.removeEventListener("mousedown", onBackdropMouseDown);
        if (node.parentNode !== null && node.parentNode !== undefined) node.parentNode.removeChild(node);
      };

      render();
      return { node: node, focus: focus, refresh: refresh, reset: reset, currentSession: currentSession, destroy: destroy, load: load };
    }

    // 供 exports.openSearchPanel 使用的当前实例打开函数（mount 时登记、卸载时注销）。
    let activeSearchOpener = null;

    function openSearchPanel() {
      if (typeof activeSearchOpener !== "function") return false;
      activeSearchOpener();
      return true;
    }

    function mountPromptSearch(ctx) {
      // cacheBySession 按 sessionId 分键；view 不持有缓存，避免跨会话串数据。
      // openSessionId 记录面板打开时的会话，用于打开期间/再次打开时的一致性校验。
      const state = { open: false, view: null, stopped: false, cacheBySession: {}, openSessionId: "" };
      // slotHost 由 shell.overlay 的挂载点提供；bodyHost 是 slot 不可用时的自绘退化层。
      let slotHost = null;
      let bodyHost = null;
      let sessionObserver = null;
      let observedSessionId = "";

      const flashRow = (row) => {
        try {
          row.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (error) {
          try {
            row.scrollIntoView();
          } catch (inner) {
            warn("滚动到提问失败", inner);
          }
        }
        if (row.classList !== null && row.classList !== undefined) row.classList.add("dsh-self-use-flash");
        window.setTimeout(() => {
          if (row.classList !== null && row.classList !== undefined) row.classList.remove("dsh-self-use-flash");
        }, 1200);
      };

      const jumpToTurn = (prompt) => {
        const row = findTurnRow(turnOfPrompt(prompt));
        if (row === null || row === undefined) return { ok: false, missing: true };
        flashRow(row);
        return { ok: true };
      };

      const loadPrompts = async (force) => {
        // 顺序固定：先取 sessionId，再判断缓存（反过来就会把 A 的缓存给 B）。
        const sessionId = currentSessionId();
        const plan = resolvePromptLoad(state.cacheBySession, sessionId, force);
        if (plan.action === "error") return { ok: false, error: plan.error };
        if (plan.action === "cache") return { ok: true, prompts: plan.prompts };
        const result = await getJson("/prompts?sessionId=" + encodeURIComponent(sessionId));
        // 请求期间会话可能又切走了，此时结果属于旧会话，直接丢弃且不写缓存。
        if (currentSessionId() !== sessionId) {
          return { ok: false, error: "会话已切换，请重试" };
        }
        if (result.ok !== true) {
          return { ok: false, error: "读取提问失败：" + result.error };
        }
        if (result.data.ok === false) {
          const message =
            typeof result.data.error === "string" && result.data.error !== "" ? result.data.error : "读取提问失败";
          return { ok: false, error: message };
        }
        const prompts = Array.isArray(result.data.prompts) ? result.data.prompts : [];
        state.cacheBySession[sessionId] = prompts;
        return { ok: true, prompts: prompts };
      };

      const detachView = () => {
        if (state.view !== null) {
          state.view.destroy();
          state.view = null;
        }
      };

      const close = () => {
        if (state.open !== true) return;
        state.open = false;
        detachView();
      };

      const open = () => {
        if (state.stopped) return;
        const sessionId = currentSessionId();
        if (state.open === true) {
          // 面板已打开但会话换了：清空旧结果并强制重载，不把 A 的提问留在 B 上。
          if (state.view !== null) {
            if (sessionId !== state.openSessionId) {
              state.openSessionId = sessionId;
              state.view.reset();
              state.view.load(true);
            }
            state.view.focus();
          }
          return;
        }
        state.open = true;
        // 与上次打开时的会话比较：不同则强制重拉（旧结果已随 close 销毁，但缓存键必须重新校验）。
        const sessionChanged = sessionId !== state.openSessionId;
        state.openSessionId = sessionId;
        observedSessionId = sessionId;
        const view = createPromptSearchView({
          onClose: close,
          loadPrompts: loadPrompts,
          jumpToTurn: jumpToTurn,
          sessionId: currentSessionId
        });
        state.view = view;
        // 优先 slot 挂载点；slot 未就绪时退化为 body 自绘层，保证快捷键立刻可用。
        let host = slotHost !== null && slotHost.isConnected !== false && slotHost !== undefined ? slotHost : null;
        if (host === null) {
          if (bodyHost === null) {
            bodyHost = createHostLayer();
            if (document.body !== null) document.body.appendChild(bodyHost);
          }
          host = bodyHost;
        }
        if (view.node.parentNode !== host) host.appendChild(view.node);
        view.focus();
        // 会话变了就强制重拉；同一会话才允许命中缓存。
        view.load(sessionChanged === true);
      };

      const onDocumentKeyDown = (event) => {
        if (state.stopped) return;
        if (state.open === true && event !== null && typeof event === "object" && event.key === "Escape") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          close();
          return;
        }
        if (!isFindShortcut(event)) return;
        if (readPrefs().promptSearch !== true) return;
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        open();
      };

      const createHostLayer = () => {
        const layer = document.createElement("div");
        layer.className = "dsh-self-use-search-layer";
        layer.setAttribute("data-dsh-self-use-search-host", "");
        return layer;
      };

      // 面板打开期间若会话切换：立即清空结果并重载。
      // 复用已有的 data-conversation-session 属性，不额外轮询。
      const onSessionMutation = () => {
        if (state.stopped || state.open !== true) return;
        const sessionId = currentSessionId();
        if (sessionId === "" || sessionId === observedSessionId) return;
        observedSessionId = sessionId;
        state.openSessionId = sessionId;
        if (state.view === null) return;
        state.view.reset();
        state.view.load(true);
      };

      const sessionRoot = document.body !== null ? document.body : document.documentElement;
      if (sessionRoot !== null && typeof MutationObserver === "function") {
        try {
          sessionObserver = new MutationObserver(onSessionMutation);
          sessionObserver.observe(sessionRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-conversation-session"]
          });
        } catch (error) {
          sessionObserver = null;
          warn("监听会话切换失败，搜索面板将退化为打开时校验", error);
        }
      }

      document.addEventListener("keydown", onDocumentKeyDown, true);
      activeSearchOpener = open;

      const slots = serviceOf(ctx, "slots");
      if (slots !== null && slots !== undefined && typeof slots.inject === "function" && typeof slots.register === "function") {
        try {
          slots.inject("shell.overlay", () =>
            slots.register(
              { name: "shell.overlay", id: PLUGIN_ID + ".prompt-search", order: 90 },
              function PromptSearchOverlaySlot() {
                const ref = React.useRef(null);
                React.useEffect(() => {
                  if (ref.current === null) return;
                  const node = ref.current;
                  slotHost = node;
                  if (state.view !== null && state.view.node.parentNode !== node) node.appendChild(state.view.node);
                  return () => {
                    if (state.view !== null && state.view.node.parentNode === node) node.removeChild(state.view.node);
                    if (slotHost === node) slotHost = null;
                  };
                }, []);
                return React.createElement("div", {
                  ref: ref,
                  className: "dsh-self-use-search-host",
                  "data-dsh-self-use-search-slot": ""
                });
              }
            )
          );
        } catch (error) {
          warn("注册提示词查询浮层失败，退化为直接挂载", error);
          bodyHost = createHostLayer();
          if (document.body !== null) document.body.appendChild(bodyHost);
        }
      } else {
        bodyHost = createHostLayer();
        if (document.body !== null) document.body.appendChild(bodyHost);
      }

      return () => {
        state.stopped = true;
        if (sessionObserver !== null) {
          sessionObserver.disconnect();
          sessionObserver = null;
        }
        state.cacheBySession = {};
        state.openSessionId = "";
        document.removeEventListener("keydown", onDocumentKeyDown, true);
        detachView();
        state.open = false;
        // bodyHost 可能由 slot 未就绪时的退化路径创建，与 hostMode 无关，一律移除。
        if (bodyHost !== null && bodyHost.parentNode !== null) bodyHost.parentNode.removeChild(bodyHost);
        bodyHost = null;
        slotHost = null;
        if (activeSearchOpener === open) activeSearchOpener = null;
      };
    }
    // #endregion dsh-self-use feature-3

    exports.apply = apply;
    exports.inject = inject;
    exports.openSearchPanel = openSearchPanel;
    exports.filterPrompts = filterPrompts;
    exports.scorePromptMatch = scorePromptMatch;
    exports.snippetOf = snippetOf;
    exports.highlightSegments = highlightSegments;
    exports.isFindShortcut = isFindShortcut;
    exports.clampMinutes = clampMinutes;
    exports.clampQuestionWaitMinutes = clampQuestionWaitMinutes;
    exports.installQuestionActivityWatch = installQuestionActivityWatch;
    exports.readPrefs = readPrefs;
    exports.writePrefs = writePrefs;
    exports.syncPrefsFromHost = syncPrefsFromHost;
    exports.imageRescueStore = imageRescueStore;
    exports.createEyeButton = createEyeButton;
    exports.toggleModelHidden = toggleModelHidden;
    exports.toggleGroupHidden = toggleGroupHidden;
    exports.getModelCustomState = () => modelCustomState;
    exports.createPreviewToolbar = createPreviewToolbar;
    exports.renderList = renderList;
    exports.navigateTo = navigateTo;
    exports.renderBreadcrumb = renderBreadcrumb;
    exports.__setSidebarRight = (value) => { fmSidebarRight = value; };
    exports.eyeSignature = eyeSignature;
    exports.storeRescuedImage = storeRescuedImage;
    exports.restoreImagesIntoComposer = restoreImagesIntoComposer;
    exports.rescueSessionIdFromUrl = rescueSessionIdFromUrl;
    exports.pushPrefsToHost = pushPrefsToHost;
    exports.filterCatalogByCustom = filterCatalogByCustom;
    exports.retargetDefault = retargetDefault;
    exports.modelCustomKey = modelCustomKey;
    exports.createModelCustomSection = createModelCustomSection;
    exports.decodeMentionSessionId = decodeMentionSessionId;
    exports.isSubagentCandidate = isSubagentCandidate;
    exports.filterSubagentCandidates = filterSubagentCandidates;
    exports.installSubagentFilter = installSubagentFilter;
    exports.normalizeSkillNames = normalizeSkillNames;
    exports.filterSkillCandidates = filterSkillCandidates;
    exports.isHiddenSkillCandidate = isHiddenSkillCandidate;
    exports.installSkillFilter = installSkillFilter;
    exports.lookupPromptCache = lookupPromptCache;
    exports.resolvePromptLoad = resolvePromptLoad;
    return module.exports;
  }
});
