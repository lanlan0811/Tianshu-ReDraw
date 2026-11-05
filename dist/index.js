// src/tpi.ts
function defineTianshuPlugin(spec) {
  const sdk = globalThis.__tianshuTPI;
  if (!sdk) throw new Error("not running inside Tianshu: TPI plugins load only through the Tianshu host");
  return sdk.defineTianshuPlugin(spec);
}

// src/tools.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync6, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";

// src/ids.ts
import { randomUUID } from "node:crypto";
var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var InvalidInputError = class extends Error {
};
function isSafeId(id) {
  return typeof id === "string" && ID_RE.test(id);
}
function assertSafeId(id) {
  if (!isSafeId(id)) throw new InvalidInputError(`invalid id: ${String(id)}`);
}
function gen(prefix) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
function newShotId() {
  return gen("shot");
}
function newFrameId() {
  return gen("frame");
}
function newAssetId() {
  return gen("asset");
}
function newVariantId() {
  return gen("var");
}
function newBoardId() {
  return gen("board");
}
function newVideoId() {
  return gen("vid");
}
function newJobId() {
  return gen("job");
}
function newEpisodeId() {
  return gen("ep");
}
function newSceneId() {
  return gen("sc");
}

// src/config.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";

// src/project.ts
import { EventEmitter } from "node:events";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/aspect.ts
var DEFAULT_ASPECT = "portrait";
var ASPECTS = ["portrait", "landscape", "square", "free"];
function isAspectType(v) {
  return typeof v === "string" && ASPECTS.includes(v);
}

// src/project.ts
var PROJECT_DIR_NAME = ".tianshu-redraw";
var STEP_IDS = ["frames", "localize", "script", "shotlist", "assets", "generate"];
var projectEvents = new EventEmitter();
projectEvents.setMaxListeners(0);
function projectDir(cwd) {
  return join(cwd, PROJECT_DIR_NAME);
}
function projectFile(cwd) {
  return join(projectDir(cwd), "project.json");
}
function assetsDir(cwd) {
  return join(projectDir(cwd), "assets");
}
function boardsDir(cwd) {
  return join(projectDir(cwd), "boards");
}
function videosDir(cwd) {
  return join(projectDir(cwd), "videos");
}
function vendorsDir(cwd) {
  return join(projectDir(cwd), "vendors");
}
function configFile(cwd) {
  return join(projectDir(cwd), "config.json");
}
function emptyPipeline() {
  const steps = {};
  const now = Date.now();
  for (const id of STEP_IDS) steps[id] = { status: "pending", updatedAt: now };
  return { currentStep: "frames", steps, globalPrefs: {} };
}
function emptyProject() {
  const now = Date.now();
  return {
    version: 2,
    meta: { id: "project", title: "\u672A\u547D\u540D\u77ED\u5267", createdAt: now, updatedAt: now, aspect: DEFAULT_ASPECT, episodeCount: 1 },
    source: { mode: "story" },
    frames: [],
    style: { styleId: "" },
    localization: { region: "", templateId: "default" },
    script: { status: "none", episodes: [], revisions: 0 },
    shots: [],
    assets: [],
    boards: [],
    videos: [],
    pipeline: emptyPipeline(),
    viewport: { x: 0, y: 0, zoom: 1 },
    edges: [],
    layout: {}
  };
}
function normalizeViewport(v) {
  if (v && typeof v === "object") {
    const o = v;
    const x = typeof o.x === "number" && Number.isFinite(o.x) ? o.x : 0;
    const y = typeof o.y === "number" && Number.isFinite(o.y) ? o.y : 0;
    const zoom = typeof o.zoom === "number" && Number.isFinite(o.zoom) && o.zoom > 0 ? o.zoom : 1;
    return { x, y, zoom };
  }
  return { x: 0, y: 0, zoom: 1 };
}
function str(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function num(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function isFrame(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return typeof o.id === "string" && isSafeId(o.id) && typeof o.path === "string";
}
function isShot(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return typeof o.id === "string" && isSafeId(o.id);
}
function isAsset(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return typeof o.id === "string" && isSafeId(o.id) && typeof o.kind === "string";
}
function isBoard(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return typeof o.id === "string" && isSafeId(o.id) && typeof o.shotId === "string";
}
function isVideo(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return typeof o.id === "string" && isSafeId(o.id) && typeof o.shotId === "string";
}
function isEdge(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return typeof o.id === "string" && typeof o.source === "string" && typeof o.target === "string";
}
function migrateV1(raw) {
  const project = emptyProject();
  const nodes = Array.isArray(raw.shots) ? raw.shots : Array.isArray(raw.nodes) ? raw.nodes : [];
  const now = Date.now();
  let i = 0;
  for (const n of nodes) {
    if (!n || typeof n.id !== "string" || !isSafeId(n.id)) continue;
    project.shots.push({
      id: n.id,
      index: i++,
      episodeId: "",
      durationSec: 3,
      shotSize: "",
      cameraMove: "",
      scene: "",
      characters: [],
      props: [],
      description: str(n.title),
      boardIds: [],
      videoIds: [],
      status: "draft",
      updatedAt: now
    });
    project.layout[n.id] = { x: num(n.x), y: num(n.y) };
  }
  if (Array.isArray(raw.edges)) {
    project.edges = raw.edges.filter(isEdge);
  }
  project.viewport = normalizeViewport(raw.viewport);
  return { project, migrated: nodes.length > 0 || raw.version !== 2 };
}
function normalizeProject(raw) {
  if (!raw || typeof raw !== "object") return { project: emptyProject(), problem: "\u9879\u76EE\u6587\u4EF6\u4E0D\u662F\u5BF9\u8C61", dropped: 0, migrated: false };
  const o = raw;
  if (o.version !== 2) {
    const { project, migrated } = migrateV1(o);
    return { project, dropped: 0, migrated };
  }
  const p = emptyProject();
  p.meta = { ...p.meta, ...typeof o.meta === "object" && o.meta ? o.meta : {} };
  if (typeof o.meta === "object" && o.meta) {
    const m = o.meta;
    p.meta.id = str(m.id, "project");
    p.meta.title = str(m.title, "\u672A\u547D\u540D\u77ED\u5267");
    p.meta.createdAt = num(m.createdAt, Date.now());
    p.meta.updatedAt = num(m.updatedAt, Date.now());
    p.meta.aspect = isAspectType(m.aspect) ? m.aspect : DEFAULT_ASPECT;
    p.meta.episodeCount = Math.max(1, Math.round(num(m.episodeCount, 1)));
    if (typeof m.region === "string") p.meta.region = m.region;
    if (typeof m.notes === "string") p.meta.notes = m.notes;
  }
  if (typeof o.source === "object" && o.source) {
    const s = o.source;
    p.source.mode = s.mode === "video" ? "video" : "story";
    if (typeof s.videoPath === "string") p.source.videoPath = s.videoPath;
    if (typeof s.story === "string") p.source.story = s.story;
    if (typeof s.durationSec === "number") p.source.durationSec = s.durationSec;
    if (typeof s.width === "number") p.source.width = s.width;
    if (typeof s.height === "number") p.source.height = s.height;
    if (typeof s.fps === "number") p.source.fps = s.fps;
    if (typeof s.ingestAt === "number") p.source.ingestAt = s.ingestAt;
  }
  const rawFrames = Array.isArray(o.frames) ? o.frames : [];
  p.frames = rawFrames.filter(isFrame);
  const rawShots = Array.isArray(o.shots) ? o.shots : [];
  p.shots = rawShots.filter(isShot);
  const rawAssets = Array.isArray(o.assets) ? o.assets : [];
  p.assets = rawAssets.filter(isAsset);
  const rawBoards = Array.isArray(o.boards) ? o.boards : [];
  p.boards = rawBoards.filter(isBoard);
  const rawVideos = Array.isArray(o.videos) ? o.videos : [];
  p.videos = rawVideos.filter(isVideo);
  const rawEdges = Array.isArray(o.edges) ? o.edges : [];
  p.edges = rawEdges.filter(isEdge);
  if (typeof o.style === "object" && o.style) {
    const s = o.style;
    p.style = { styleId: str(s.styleId), ...typeof s.promptFragment === "string" ? { promptFragment: s.promptFragment } : {}, ...typeof s.referenceImage === "string" ? { referenceImage: s.referenceImage } : {}, ...typeof s.appliedAt === "number" ? { appliedAt: s.appliedAt } : {} };
  }
  if (typeof o.localization === "object" && o.localization) {
    const l = o.localization;
    p.localization = { region: str(l.region), templateId: str(l.templateId, "default") };
    if (l.report && typeof l.report === "object") {
      const r = l.report;
      const c = r.checklist ?? {};
      p.localization.report = {
        region: str(r.region),
        checklist: {
          costume: str(c.costume),
          architecture: str(c.architecture),
          festival: str(c.festival),
          taboos: str(c.taboos),
          colorPreference: str(c.colorPreference),
          ...typeof c.notes === "string" ? { notes: c.notes } : {}
        },
        updatedAt: num(r.updatedAt, Date.now())
      };
    }
    if (typeof l.appliedAt === "number") p.localization.appliedAt = l.appliedAt;
  }
  if (typeof o.script === "object" && o.script) {
    const s = o.script;
    p.script = {
      status: s.status === "draft" || s.status === "approved" ? s.status : "none",
      episodes: Array.isArray(s.episodes) ? s.episodes.filter((e) => e && typeof e.id === "string") : [],
      revisions: num(s.revisions, 0),
      ...typeof s.approvedAt === "number" ? { approvedAt: s.approvedAt } : {}
    };
  }
  if (typeof o.pipeline === "object" && o.pipeline) {
    const pl = o.pipeline;
    const steps = emptyPipeline().steps;
    if (typeof pl.steps === "object" && pl.steps) {
      for (const id of STEP_IDS) {
        const s = pl.steps[id];
        if (s && typeof s === "object") {
          const so = s;
          const status = so.status === "active" || so.status === "done" ? so.status : "pending";
          const gate = so.gate && typeof so.gate === "object" ? so.gate : void 0;
          steps[id] = { status, updatedAt: num(so.updatedAt, Date.now()), ...gate ? { gate } : {} };
        }
      }
    }
    const prefsRaw = typeof pl.globalPrefs === "object" && pl.globalPrefs ? pl.globalPrefs : {};
    const prefs = {};
    if (prefsRaw.boardType === "single" || prefsRaw.boardType === "firstLast" || prefsRaw.boardType === "grid") prefs.boardType = prefsRaw.boardType;
    if (prefsRaw.gridMode === "multiShot" || prefsRaw.gridMode === "subPanels") prefs.gridMode = prefsRaw.gridMode;
    if (prefsRaw.videoModel && typeof prefsRaw.videoModel === "object") {
      const vm = prefsRaw.videoModel;
      if (typeof vm.vendorId === "string" && typeof vm.modelName === "string") prefs.videoModel = { vendorId: vm.vendorId, modelName: vm.modelName };
    }
    if (typeof prefsRaw.videoSeconds === "number") prefs.videoSeconds = prefsRaw.videoSeconds;
    p.pipeline = {
      currentStep: STEP_IDS.includes(pl.currentStep) ? pl.currentStep : "frames",
      steps,
      globalPrefs: prefs
    };
  }
  p.viewport = normalizeViewport(o.viewport);
  if (typeof o.layout === "object" && o.layout) {
    for (const [k, v] of Object.entries(o.layout)) {
      if (v && typeof v === "object") {
        const lv = v;
        p.layout[k] = { x: num(lv.x), y: num(lv.y) };
      }
    }
  }
  if (o.extractRequest && typeof o.extractRequest === "object") {
    const e = o.extractRequest;
    const st = e.status;
    p.extractRequest = {
      intervalSec: num(e.intervalSec, 2),
      status: st === "running" || st === "done" || st === "error" ? st : "requested",
      at: num(e.at, Date.now()),
      ...typeof e.message === "string" ? { message: e.message } : {}
    };
  }
  const dropped = rawFrames.length - p.frames.length + rawShots.length - p.shots.length + rawAssets.length - p.assets.length + rawBoards.length - p.boards.length + rawVideos.length - p.videos.length + rawEdges.length - p.edges.length;
  return { project: p, dropped, migrated: false };
}
function inspectProject(cwd) {
  const file = projectFile(cwd);
  if (!existsSync(file)) return { project: emptyProject(), dropped: 0, migrated: false };
  const raw = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err2) {
    return { project: emptyProject(), problem: err2.message, dropped: 0, migrated: false };
  }
  return normalizeProject(parsed);
}
function readProject(cwd) {
  return inspectProject(cwd).project;
}
function projectIssue(cwd) {
  const { problem, dropped, migrated } = inspectProject(cwd);
  if (problem) {
    return `project.json \u5DF2\u635F\u574F\uFF08${problem}\uFF09\u3002\u753B\u5E03\u6682\u6309\u7A7A\u9879\u76EE\u663E\u793A\uFF0C\u539F\u6587\u4EF6\u672A\u6539\u52A8\uFF0C\u4FEE\u590D\u540E\u4F1A\u81EA\u52A8\u6062\u590D\uFF1B\u7EE7\u7EED\u5199\u5165\u524D\u4F1A\u5148\u5907\u4EFD\u4E3A project.json.corrupt-*\u3002`;
  }
  if (dropped > 0) {
    return `project.json \u4E2D\u6709 ${dropped} \u6761\u65E0\u6548\u6761\u76EE\uFF0C\u8BFB\u53D6\u65F6\u5DF2\u5FFD\u7565\u3002\u539F\u6587\u4EF6\u672A\u6539\u52A8\uFF0C\u4E0B\u6B21\u5199\u5165\u524D\u4F1A\u5148\u5907\u4EFD\u4E3A project.json.corrupt-*\u3002`;
  }
  if (migrated) {
    return `\u68C0\u6D4B\u5230\u65E7\u7248\uFF08v1\uFF09\u9879\u76EE\u6587\u4EF6\uFF0C\u5DF2\u6309 v2 \u7ED3\u6784\u8BFB\u53D6\uFF1B\u9996\u6B21\u5199\u5165\u524D\u4F1A\u5907\u4EFD\u4E3A project.json.v1-*\u3002`;
  }
  return null;
}
var pendingBackups = /* @__PURE__ */ new Map();
function backupDamagedProject(cwd) {
  const file = projectFile(cwd);
  if (!existsSync(file)) return;
  let reason = null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.version !== 2) reason = "v1";
    else {
      const { problem, dropped } = inspectProject(cwd);
      if (problem || dropped > 0) reason = "corrupt";
    }
  } catch {
    reason = "corrupt";
  }
  if (!reason) return;
  const stamp = Date.now();
  const suffix = reason === "v1" ? `.v1-${stamp}` : `.corrupt-${stamp}`;
  for (let n = 0; n < 1e3; n++) {
    const dest = n === 0 ? `${file}${suffix}` : `${file}${suffix}-${n}`;
    try {
      copyFileSync(file, dest, constants.COPYFILE_EXCL);
    } catch (err2) {
      if (err2.code === "EEXIST") continue;
      throw err2;
    }
    pendingBackups.set(cwd, dest);
    console.error(`[tianshu-redraw] \u9879\u76EE\u6587\u4EF6\u9700\u5907\u4EFD\uFF08${reason}\uFF09\uFF0C\u5DF2\u5907\u4EFD\u5230 ${dest}`);
    return;
  }
  throw new Error(`\u65E0\u6CD5\u5907\u4EFD\u9879\u76EE\u6587\u4EF6\uFF1A${file}`);
}
function writeProjectAtomic(cwd, project) {
  mkdirSync(projectDir(cwd), { recursive: true });
  backupDamagedProject(cwd);
  project.meta.updatedAt = Date.now();
  const file = projectFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(project, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  projectEvents.emit("change", { cwd });
}
function mutateProject(cwd, fn) {
  const project = readProject(cwd);
  fn(project);
  writeProjectAtomic(cwd, project);
  return project;
}
function writeMedia(cwd, relFromProjectDir, data) {
  const abs = join(projectDir(cwd), relFromProjectDir);
  mkdirSync(join(abs, ".."), { recursive: true });
  const tmp = abs + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, abs);
  return join(PROJECT_DIR_NAME, relFromProjectDir);
}
function mediaAbs(cwd, relPath) {
  return join(cwd, relPath);
}
var MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav"
};
function extFromMime(mime) {
  const bare = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_EXT[bare] ?? "bin";
}
function mimeFromExt(ext) {
  const e = ext.replace(/^\./, "").toLowerCase();
  for (const [mime, mapped] of Object.entries(MIME_EXT)) {
    if (mapped === e) return mime;
  }
  return "application/octet-stream";
}
function readMediaBuffer(cwd, relPath) {
  const abs = mediaAbs(cwd, relPath);
  return existsSync(abs) ? readFileSync(abs) : null;
}
function setStep(cwd, step, status) {
  return mutateProject(cwd, (p) => {
    p.pipeline.steps[step].status = status;
    p.pipeline.steps[step].updatedAt = Date.now();
    if (status === "active") p.pipeline.currentStep = step;
  });
}
function setGate(cwd, step, gate) {
  return mutateProject(cwd, (p) => {
    const cur = p.pipeline.steps[step].gate ?? { asked: false, answered: false };
    p.pipeline.steps[step].gate = { ...cur, ...gate };
  });
}
function pendingGate(p) {
  for (const id of STEP_IDS) {
    const g = p.pipeline.steps[id].gate;
    if (g?.asked && !g.answered) return { step: id, ...g.question ? { question: g.question } : {} };
  }
  return null;
}
function isEdgeMatch(e, source, target) {
  return e.source === source && e.target === target;
}
function addEdge(cwd, source, target, label) {
  assertSafeId(source);
  assertSafeId(target);
  if (source === target) throw new InvalidInputError(`\u4E0D\u80FD\u5C06\u8282\u70B9\u8FDE\u63A5\u5230\u81EA\u8EAB\uFF1A${source}`);
  const project = readProject(cwd);
  const exists = project.edges.find((e) => isEdgeMatch(e, source, target));
  if (exists) return exists;
  const edge = { id: `edge-${source}-${target}`, source, target, ...label ? { label } : {} };
  project.edges.push(edge);
  writeProjectAtomic(cwd, project);
  return edge;
}
function removeEdge(cwd, source, target) {
  return mutateProject(cwd, (p) => {
    p.edges = p.edges.filter((e) => !isEdgeMatch(e, source, target));
  });
}
function setViewport(cwd, viewport) {
  const { project, problem, dropped, migrated } = inspectProject(cwd);
  if (problem || dropped > 0 || migrated) return project;
  project.viewport = normalizeViewport(viewport);
  writeProjectAtomic(cwd, project);
  return project;
}
function selectionFile(cwd) {
  return join(projectDir(cwd), "selection.json");
}
function readSelection(cwd) {
  const file = selectionFile(cwd);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed.kind !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeSelection(cwd, selection) {
  mkdirSync(projectDir(cwd), { recursive: true });
  const file = selectionFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(selection, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  projectEvents.emit("selection", { cwd });
}

// src/config.ts
function emptyConfig() {
  return { version: 1, active: {}, vendors: {} };
}
var SECRET_KEYS = /key|secret|token|password|passwd|pwd|apikey/i;
function readConfig(cwd) {
  const file = configFile(cwd);
  if (!existsSync2(file)) return emptyConfig();
  try {
    const raw = JSON.parse(readFileSync2(file, "utf8"));
    const cfg = emptyConfig();
    if (raw.active && typeof raw.active === "object") {
      const a = raw.active;
      for (const kind of ["image", "video"]) {
        const v = a[kind];
        if (v && typeof v === "object") {
          const vo = v;
          if (typeof vo.vendorId === "string" && typeof vo.modelName === "string") {
            cfg.active[kind] = { vendorId: vo.vendorId, modelName: vo.modelName };
          }
        }
      }
    }
    if (raw.vendors && typeof raw.vendors === "object") {
      for (const [id, entry] of Object.entries(raw.vendors)) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry;
        const out = {};
        if (typeof e.enabled === "boolean") out.enabled = e.enabled;
        if (typeof e.trusted === "boolean") out.trusted = e.trusted;
        if (e.inputValues && typeof e.inputValues === "object") {
          const iv = {};
          for (const [k, v] of Object.entries(e.inputValues)) {
            if (typeof v === "string") iv[k] = v;
          }
          out.inputValues = iv;
        }
        cfg.vendors[id] = out;
      }
    }
    return cfg;
  } catch {
    return emptyConfig();
  }
}
function writeConfig(cwd, cfg) {
  mkdirSync2(projectDir(cwd), { recursive: true });
  const file = configFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync2(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  renameSync2(tmp, file);
}
function updateConfig(cwd, patch) {
  const cfg = readConfig(cwd);
  const next = {
    version: 1,
    active: { ...cfg.active, ...patch.active ?? {} },
    vendors: { ...cfg.vendors }
  };
  if (patch.vendors) {
    for (const [id, entry] of Object.entries(patch.vendors)) {
      next.vendors[id] = { ...next.vendors[id] ?? {}, ...entry };
    }
  }
  writeConfig(cwd, next);
  return next;
}
function redactConfig(cfg) {
  const out = { version: 1, active: cfg.active, vendors: {} };
  for (const [id, entry] of Object.entries(cfg.vendors)) {
    const e = {};
    if (typeof entry.enabled === "boolean") e.enabled = entry.enabled;
    if (typeof entry.trusted === "boolean") e.trusted = entry.trusted;
    if (entry.inputValues) {
      const iv = {};
      for (const [k, v] of Object.entries(entry.inputValues)) iv[k] = SECRET_KEYS.test(k) ? "***" : v;
      e.inputValues = iv;
    }
    out.vendors[id] = e;
  }
  return out;
}

// src/jobs.ts
import { EventEmitter as EventEmitter2 } from "node:events";
var jobEvents = new EventEmitter2();
jobEvents.setMaxListeners(0);
var jobs = /* @__PURE__ */ new Map();
var concurrency = 2;
var running = 0;
var queue = [];
function setConcurrency(n) {
  concurrency = Math.max(1, Math.round(n));
}
function createJob(cwd, kind, label) {
  const job = {
    id: newJobId(),
    cwd,
    kind,
    label,
    status: "queued",
    progress: 0,
    message: "\u6392\u961F\u4E2D",
    startedAt: Date.now(),
    abort: new AbortController()
  };
  jobs.set(job.id, job);
  emit(cwd);
  return job;
}
function getJob(id) {
  return jobs.get(id);
}
function listJobs(cwd) {
  return [...jobs.values()].filter((j) => j.cwd === cwd).sort((a, b) => b.startedAt - a.startedAt);
}
function activeJobs(cwd) {
  return listJobs(cwd).filter((j) => j.status === "queued" || j.status === "running");
}
function emit(cwd) {
  jobEvents.emit("job", { cwd });
}
function updateJob(job, patch) {
  Object.assign(job, patch);
  if (patch.status === "done" || patch.status === "error" || patch.status === "cancelled") {
    job.finishedAt = Date.now();
  }
  emit(job.cwd);
}
function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") return false;
  job.abort.abort();
  updateJob(job, { status: "cancelled", message: "\u5DF2\u53D6\u6D88" });
  return true;
}
async function runJob(job, body) {
  await acquire();
  if (job.status === "cancelled") {
    release();
    return;
  }
  updateJob(job, { status: "running", progress: 0, message: "\u5F00\u59CB" });
  const report = (progress, message) => {
    if (job.abort.signal.aborted) return;
    updateJob(job, { progress: Math.max(0, Math.min(1, progress)), message });
  };
  try {
    const result = await body(job.abort.signal, report);
    if (job.abort.signal.aborted) return;
    updateJob(job, { status: "done", progress: 1, message: "\u5B8C\u6210", result });
  } catch (err2) {
    if (job.abort.signal.aborted) return;
    const aborted = job.abort.signal.aborted || err2?.name === "AbortError";
    updateJob(job, {
      status: aborted ? "cancelled" : "error",
      message: aborted ? "\u5DF2\u53D6\u6D88" : "\u5931\u8D25",
      error: aborted ? void 0 : err2?.message ?? String(err2)
    });
  } finally {
    release();
  }
}
function acquire() {
  if (running < concurrency) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      running++;
      resolve();
    });
  });
}
function release() {
  running = Math.max(0, running - 1);
  const next = queue.shift();
  if (next) next();
}
function resetJobsForTests() {
  jobs.clear();
  queue.length = 0;
  running = 0;
  concurrency = 2;
}

// src/styles/library.ts
import { existsSync as existsSync3, readdirSync, readFileSync as readFileSync3 } from "node:fs";
import { join as join2 } from "node:path";
var BUILTIN = [
  {
    id: "anime-jp",
    name: "\u65E5\u7CFB\u52A8\u6F2B",
    category: "anime",
    tagline: "\u8D5B\u7490\u7490\u4E0A\u8272\u3001\u5E72\u51C0\u7EBF\u7A3F\u3001\u65E5\u5F0F\u4E94\u5B98",
    promptFragment: "Japanese anime style, cel shading, clean line art, expressive eyes, vibrant colors, studio-quality key visual",
    builtin: true
  },
  {
    id: "anime-cn",
    name: "\u56FD\u98CE\u52A8\u6F2B",
    category: "anime",
    tagline: "\u6C34\u58A8\u8D28\u611F\u3001\u4E1C\u65B9\u914D\u8272\u3001\u5199\u610F\u7EBF\u6761",
    promptFragment: "Chinese guofeng anime style, ink-wash texture, oriental color palette, elegant flowing lines, traditional aesthetics",
    builtin: true
  },
  {
    id: "anime-us",
    name: "\u6B27\u7F8E\u5361\u901A",
    category: "anime",
    tagline: "\u539A\u6D82\u3001\u5F3A\u5BF9\u6BD4\u3001\u5938\u5F20\u9020\u578B",
    promptFragment: "Western cartoon style, painterly rendering, bold shapes, strong contrast, Pixar-like appeal",
    builtin: true
  },
  {
    id: "anime-kr",
    name: "\u97E9\u7CFB\u6761\u6F2B",
    category: "anime",
    tagline: "\u67D4\u548C\u5149\u5F71\u3001\u7CBE\u81F4\u4E94\u5B98\u3001\u90FD\u5E02\u611F",
    promptFragment: "Korean webtoon style, soft lighting, delicate facial features, modern urban aesthetic, semi-realistic",
    builtin: true
  },
  {
    id: "real-cinematic",
    name: "\u7535\u5F71\u5199\u5B9E",
    category: "cinematic",
    tagline: "\u771F\u5B9E\u8D28\u611F\u3001\u7535\u5F71\u7EA7\u5E03\u5149",
    promptFragment: "cinematic photorealism, film-grade lighting, shallow depth of field, 35mm lens, natural skin texture",
    builtin: true
  },
  {
    id: "real-3d",
    name: "3D \u6E32\u67D3",
    category: "cinematic",
    tagline: "\u4E09\u7EF4\u8D28\u611F\u3001\u6B21\u4E16\u4EE3\u6E32\u67D3",
    promptFragment: "high-quality 3D render, next-gen game cinematic, subsurface scattering, detailed materials, unreal engine look",
    builtin: true
  }
];
function stylesDir(cwd) {
  return join2(projectDir(cwd), "styles");
}
function loadUserStyles(cwd) {
  const dir = stylesDir(cwd);
  if (!existsSync3(dir)) return [];
  const out = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const id = f.replace(/\.json$/, "");
      if (!isSafeId(id)) continue;
      try {
        const raw = JSON.parse(readFileSync3(join2(dir, f), "utf8"));
        if (typeof raw.name !== "string" || typeof raw.promptFragment !== "string") continue;
        out.push({
          id,
          name: raw.name,
          category: ["anime", "regional", "cinematic", "custom"].includes(raw.category) ? raw.category : "custom",
          tagline: typeof raw.tagline === "string" ? raw.tagline : "",
          promptFragment: raw.promptFragment,
          ...typeof raw.description === "string" ? { description: raw.description } : {},
          builtin: false
        });
      } catch {
      }
    }
  } catch {
  }
  return out;
}
function listStyles(cwd) {
  const map = /* @__PURE__ */ new Map();
  for (const s of BUILTIN) map.set(s.id, s);
  for (const s of loadUserStyles(cwd)) map.set(s.id, s);
  return [...map.values()];
}
function resolveStyle(cwd, id) {
  return listStyles(cwd).find((s) => s.id === id) ?? null;
}
function formatStyleList(cwd) {
  const styles = listStyles(cwd);
  const lines = styles.map((s) => `- ${s.name}\uFF08${s.id}\uFF09${s.builtin ? "" : " [\u81EA\u5B9A\u4E49]"}\uFF1A${s.tagline}`);
  return `\u53EF\u9009\u8F6C\u7ED8\u98CE\u683C\uFF08\u9879\u76EE\u7EA7\u9501\u5B9A\uFF09\uFF1A
${lines.join("\n")}

\u9501\u5B9A\uFF1Aredraw_style_set style_id=<id>\uFF1B\u4E5F\u53EF\u5728 .tianshu-redraw/styles/ \u653E\u81EA\u5B9A\u4E49\u98CE\u683C JSON\u3002`;
}
var LOCALIZATION_TEMPLATES = [
  {
    id: "default",
    name: "\u901A\u7528\u5730\u533A\u672C\u571F\u5316",
    region: "",
    prompt: "\u8BF7\u9488\u5BF9\u76EE\u6807\u5730\u533A\u505A\u672C\u571F\u5316\u8C03\u7814\uFF0C\u8F93\u51FA\u7ED3\u6784\u5316\u6E05\u5355\uFF1A\u670D\u9970\uFF08\u65E5\u5E38/\u793C\u4EEA/\u9636\u5C42\u5DEE\u5F02\uFF09\u3001\u5EFA\u7B51\uFF08\u6C11\u5C45/\u516C\u5171\u7A7A\u95F4/\u6750\u8D28\uFF09\u3001\u8282\u65E5\u4E0E\u4E60\u4FD7\u3001\u7981\u5FCC\u4E0E\u654F\u611F\u70B9\u3001\u8272\u5F69\u504F\u597D\u4E0E\u8C61\u5F81\u3002\u8981\u6C42\u4E2D\u6027\u3001\u5BA2\u89C2\u3001\u907F\u514D\u523B\u677F\u5370\u8C61\uFF0C\u4E14\u5B8C\u5168\u53EF\u88AB\u7528\u6237\u7F16\u8F91\u3002"
  }
];
function localizationTemplate(id) {
  return LOCALIZATION_TEMPLATES.find((t) => t.id === id) ?? LOCALIZATION_TEMPLATES[0];
}

// src/vendor/runner.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync as readdirSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
var HOST_PATH = fileURLToPath(new URL("./vendor-host.js", import.meta.url));
function checkVendorSource(src) {
  if (/^\s*import\b/m.test(src)) return "vendor \u6587\u4EF6\u7981\u6B62\u4F7F\u7528 import\uFF08\u4EC5\u53EF\u7528\u6A21\u677F\u58F0\u660E\u7684\u5168\u5C40\uFF09";
  if (/^\s*export\s+(default|const|function|class|let|var)\b/m.test(src)) {
    return "vendor \u6587\u4EF6\u7981\u6B62\u5177\u540D/\u9ED8\u8BA4\u5BFC\u51FA\uFF0C\u4EC5\u5141\u8BB8 `export {}`";
  }
  return null;
}
function prepareVendorCode(src) {
  const stripped = stripTypeScriptTypes(src, { mode: "strip" });
  return stripped.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, "");
}
var VendorSession = class {
  constructor(file) {
    this.file = file;
  }
  proc = null;
  buffer = "";
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  logs = [];
  vendor = null;
  imageModels = [];
  videoModels = [];
  ready = null;
  /** 启动子进程并加载 vendor。 */
  async start(inputValues) {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const src = readFileSync4(this.file, "utf8");
      const staticErr = checkVendorSource(src);
      if (staticErr) return reject(new Error(staticErr));
      const code = prepareVendorCode(src);
      const vendorId = this.file.split(/[\\/]/).pop()?.replace(/\.ts$/, "") ?? "vendor";
      const proc = spawn(
        process.execPath,
        ["--permission", `--allow-fs-read=${vendorsDirOf(this.file)}`, HOST_PATH],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          // 清空宿主环境变量：node:vm 不是安全边界，vendor 代码可经 constructor 链拿到
          // process.env；只保留运行必需项，避免泄漏宿主的 API Key / 代理等敏感变量。
          env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? "" }
        }
      );
      this.proc = proc;
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk) => this.onData(chunk, resolve, reject));
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => {
        const msg = chunk.toString().trim();
        if (msg && !/ExperimentalWarning/.test(msg)) this.logs.push(`[stderr] ${msg}`);
      });
      proc.on("error", (err2) => reject(err2));
      proc.on("exit", (code2) => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(`vendor \u5B50\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF08code ${code2}\uFF09`));
        }
        this.pending.clear();
        this.proc = null;
      });
      this.write({ type: "load", code, vendorId, inputValues });
    });
    return this.ready;
  }
  onData(chunk, resolveStart, rejectStart) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "log") {
        this.logs.push(String(msg.msg));
      } else if (msg.type === "loaded") {
        this.vendor = msg.vendor;
        this.imageModels = msg.imageModels ?? [];
        this.videoModels = msg.videoModels ?? [];
        resolveStart();
      } else if (msg.type === "result" && typeof msg.id === "number") {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve(String(msg.value));
        }
      } else if (msg.type === "error") {
        const err2 = new Error(String(msg.error ?? "\u672A\u77E5\u9519\u8BEF"));
        if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(msg.id);
            p.reject(err2);
            continue;
          }
        }
        rejectStart(err2);
      }
    }
  }
  write(msg) {
    if (!this.proc) throw new Error("vendor \u5B50\u8FDB\u7A0B\u672A\u8FD0\u884C");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
  call(method, config, modelName, timeoutMs) {
    if (!this.proc) return Promise.reject(new Error("vendor \u5B50\u8FDB\u7A0B\u672A\u8FD0\u884C"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} \u8D85\u65F6\uFF08${timeoutMs}ms\uFF09`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ type: "call", id, method, config, modelName });
    });
  }
  imageRequest(config, modelName, timeoutMs = 12e4) {
    return this.call("imageRequest", config, modelName, timeoutMs);
  }
  videoRequest(config, modelName, timeoutMs = 9e5) {
    return this.call("videoRequest", config, modelName, timeoutMs);
  }
  takeLogs() {
    const l = this.logs;
    this.logs = [];
    return l;
  }
  dispose() {
    try {
      this.write({ type: "shutdown" });
    } catch {
    }
    this.proc?.kill();
    this.proc = null;
  }
};
function vendorsDirOf(file) {
  return file.replace(/[\\/][^\\/]+$/, "");
}
function listVendorFiles(cwd) {
  const dir = vendorsDir(cwd);
  if (!existsSync4(dir)) return [];
  try {
    return readdirSync2(dir).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")).filter(isSafeId).sort();
  } catch {
    return [];
  }
}
async function loadVendorSummary(cwd, id, inputValues) {
  if (!isSafeId(id)) return { id, error: "\u975E\u6CD5 vendor id" };
  const file = join3(vendorsDir(cwd), `${id}.ts`);
  if (!existsSync4(file)) return { id, error: `vendor \u6587\u4EF6\u4E0D\u5B58\u5728\uFF1Avendors/${id}.ts` };
  const session = new VendorSession(file);
  try {
    await session.start(inputValues);
    if (!session.vendor) return { id, error: "vendor \u52A0\u8F7D\u5931\u8D25" };
    return { id, file, vendor: session.vendor, imageModels: session.imageModels, videoModels: session.videoModels };
  } catch (err2) {
    return { id, error: err2?.message ?? String(err2) };
  } finally {
    session.dispose();
  }
}
var sessions = /* @__PURE__ */ new Map();
async function getVendorSession(cwd, id, inputValues) {
  if (!isSafeId(id)) throw new Error("\u975E\u6CD5 vendor id");
  const key = `${cwd}::${id}`;
  let session = sessions.get(key);
  if (!session || !session.vendor) {
    session?.dispose();
    session = new VendorSession(join3(vendorsDir(cwd), `${id}.ts`));
    await session.start(inputValues);
    sessions.set(key, session);
  }
  return session;
}
function disposeVendorSessions(cwd) {
  for (const [key, session] of sessions) {
    if (!cwd || key.startsWith(`${cwd}::`)) {
      session.dispose();
      sessions.delete(key);
    }
  }
}

// src/generate/image.ts
import { relative } from "node:path";

// src/media.ts
var DATA_URI_RE = /^data:([^;,]+)?(;base64)?,(.*)$/s;
function decodeDataUri(input, fallbackMime = "image/png") {
  const trimmed = input.trim();
  const m = DATA_URI_RE.exec(trimmed);
  if (m) {
    const mime = m[1] || fallbackMime;
    const isB64 = m[2] === ";base64";
    const payload = m[3] ?? "";
    if (!isB64) return null;
    const data = Buffer.from(payload, "base64");
    if (data.length === 0) return null;
    return { mime, data, ext: extFromMime(mime) };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 32) {
    const data = Buffer.from(trimmed, "base64");
    if (data.length === 0) return null;
    return { mime: fallbackMime, data, ext: extFromMime(fallbackMime) };
  }
  return null;
}
function persistMedia(cwd, input, opts) {
  const decoded = decodeDataUri(input, opts.fallbackMime ?? "image/png");
  if (!decoded) return null;
  const rel = `${opts.relDirFromProjectDir}/${opts.baseName}.${decoded.ext}`;
  const path = writeMedia(cwd, rel, decoded.data);
  return {
    path,
    rev: Date.now(),
    generatedAt: Date.now(),
    vendorId: opts.vendorId,
    modelName: opts.modelName,
    mime: decoded.mime
  };
}

// src/generate/image.ts
async function resolveImageVendor(cwd) {
  const cfg = readConfig(cwd);
  const active = cfg.active.image;
  if (!active) throw new Error("\u672A\u914D\u7F6E\u56FE\u50CF\u6A21\u578B\uFF1A\u8BF7\u5148\u5728 config.json \u7684 active.image \u6307\u5B9A vendorId \u4E0E modelName");
  const entry = cfg.vendors[active.vendorId];
  if (!entry?.trusted) throw new Error(`\u4F9B\u5E94\u5546 ${active.vendorId} \u672A\u6807\u8BB0\u4E3A\u53EF\u4FE1\uFF1A\u8BF7\u5728 config.json \u7684 vendors.${active.vendorId}.trusted \u8BBE\u4E3A true`);
  const session = await getVendorSession(cwd, active.vendorId, entry.inputValues ?? {});
  const model = session.imageModels.find((m) => m.modelName === active.modelName);
  if (!model) {
    const names = session.imageModels.map((m) => m.modelName).join(", ") || "\uFF08\u65E0\uFF09";
    throw new Error(`\u4F9B\u5E94\u5546 ${active.vendorId} \u6CA1\u6709\u56FE\u50CF\u6A21\u578B ${active.modelName}\uFF1B\u53EF\u7528\uFF1A${names}`);
  }
  return { vendorId: active.vendorId, modelName: active.modelName, model, session };
}
function relDirFrom(cwd, abs) {
  return relative(projectDir(cwd), abs).split("\\").join("/");
}
function refsToBase64(cwd, paths) {
  const out = [];
  for (const p of paths) {
    const buf = readMediaBuffer(cwd, p);
    if (!buf) continue;
    const mime = /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : "image/png";
    out.push({ type: "image", sourceType: "base64", base64: `data:${mime};base64,${buf.toString("base64")}` });
  }
  return out;
}
function styleLine(p) {
  return p.style.promptFragment || void 0;
}
function startAssetGeneration(cwd, assetId, variantId) {
  const label = variantId ? `\u8D44\u4EA7\u53D8\u4F53 ${assetId}/${variantId}` : `\u8D44\u4EA7\u57FA\u7840\u56FE ${assetId}`;
  const job = createJob(cwd, variantId ? "assets_variant" : "assets_generate", label);
  void runJob(job, async (signal, report) => {
    const vendor = await resolveImageVendor(cwd);
    const project = readProject(cwd);
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`\u8D44\u4EA7\u4E0D\u5B58\u5728\uFF1A${assetId}`);
    report(0.1, "\u6784\u9020\u63D0\u793A\u8BCD");
    let prompt;
    let refPaths = [];
    if (variantId) {
      const variant = asset.variants.find((v) => v.id === variantId);
      if (!variant) throw new Error(`\u53D8\u4F53\u4E0D\u5B58\u5728\uFF1A${variantId}`);
      if (!asset.baseImage) throw new Error("\u53D8\u4F53\u9700\u8981\u57FA\u7840\u56FE\u4F5C\u53C2\u8003\uFF1A\u8BF7\u5148\u751F\u6210\u57FA\u7840\u56FE");
      prompt = [styleLine(project), asset.prompt, variant.prompt].filter(Boolean).join("\uFF0C");
      refPaths = [asset.baseImage.path];
    } else {
      prompt = [styleLine(project), asset.prompt || asset.spec].filter(Boolean).join("\uFF0C");
    }
    const config = {
      prompt,
      size: "2K",
      aspectRatio: asset.kind === "scene" ? "16:9" : "3:4",
      ...refPaths.length ? { referenceList: refsToBase64(cwd, refPaths) } : {}
    };
    report(0.25, `\u8C03\u7528 ${vendor.vendorId}/${vendor.modelName}`);
    const b64 = await vendor.session.imageRequest(config, vendor.modelName, 18e4);
    if (signal.aborted) throw new Error("\u5DF2\u53D6\u6D88");
    report(0.85, "\u5199\u5165\u6587\u4EF6");
    const baseName = variantId ?? "base";
    const ref = persistMedia(cwd, b64, {
      relDirFromProjectDir: relDirFrom(cwd, `${assetsDir(cwd)}/${assetId}`),
      baseName,
      vendorId: vendor.vendorId,
      modelName: vendor.modelName
    });
    if (!ref) throw new Error("\u4F9B\u5E94\u5546\u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548\u7684\u6709\u5934 base64 \u56FE\u50CF");
    mutateProject(cwd, (p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (!a) return;
      if (variantId) {
        const v = a.variants.find((x) => x.id === variantId);
        if (v) {
          v.image = ref;
          v.status = "ready";
        }
      } else {
        a.baseImage = ref;
        a.status = "ready";
      }
      a.updatedAt = Date.now();
    });
    return { paths: [ref.path], items: [{ id: variantId ?? assetId, path: ref.path }] };
  });
  return job;
}
function shotPrompt(shot, styleFragment) {
  return [
    styleFragment,
    `${shot.shotSize || ""}${shot.description}`,
    shot.scene ? `\u573A\u666F\uFF1A${shot.scene}` : "",
    shot.characters.length ? `\u4EBA\u7269\uFF1A${shot.characters.join("\u3001")}` : "",
    shot.props.length ? `\u9053\u5177\uFF1A${shot.props.join("\u3001")}` : "",
    shot.emotion ? `\u60C5\u7EEA\uFF1A${shot.emotion}` : ""
  ].filter(Boolean).join("\uFF0C");
}
function startBoardGeneration(cwd, shotId, opts) {
  const job = createJob(cwd, "boards_generate", `\u5206\u955C\u56FE ${shotId}\uFF08${opts.kind}${opts.gridMode ? "/" + opts.gridMode : ""}\uFF09`);
  void runJob(job, async (signal, report) => {
    const vendor = await resolveImageVendor(cwd);
    const project = readProject(cwd);
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) throw new Error(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${shotId}`);
    const dir = relDirFrom(cwd, `${boardsDir(cwd)}/${shotId}`);
    const base = shotPrompt(shot, styleLine(project));
    const items = [];
    let seq = 0;
    const callImage = async (prompt, aspect, refPaths) => {
      const config = {
        prompt,
        size: "2K",
        aspectRatio: aspect,
        ...refPaths.length ? { referenceList: refsToBase64(cwd, refPaths) } : {}
      };
      const b64 = await vendor.session.imageRequest(config, vendor.modelName, 18e4);
      if (signal.aborted) throw new Error("\u5DF2\u53D6\u6D88");
      return persistMedia(cwd, b64, {
        relDirFromProjectDir: dir,
        baseName: `${shotId}-${seq++}`,
        vendorId: vendor.vendorId,
        modelName: vendor.modelName
      });
    };
    const boardId = newBoardId();
    if (opts.kind === "single") {
      report(0.3, "\u751F\u6210\u5355\u5E27\u5206\u955C\u56FE");
      const ref = await callImage(base, "9:16", []);
      if (!ref) throw new Error("\u56FE\u50CF\u751F\u6210\u5931\u8D25");
      items.push({ id: shotId, path: ref.path });
      appendBoard(cwd, { id: boardId, shotId, kind: "single", image: ref });
    } else if (opts.kind === "firstLast") {
      report(0.2, "\u751F\u6210\u9996\u5E27");
      const first = await callImage(`${base}\uFF0C\u9996\u5E27\u753B\u9762`, "9:16", []);
      report(0.6, "\u751F\u6210\u5C3E\u5E27");
      const last = await callImage(`${base}\uFF0C\u5C3E\u5E27\u753B\u9762\uFF08\u4E0E\u9996\u5E27\u540C\u4E00\u573A\u666F\u7684\u540E\u7EED\u72B6\u6001\uFF09`, "9:16", first ? [first.path] : []);
      if (!first || !last) throw new Error("\u9996\u5C3E\u5E27\u751F\u6210\u5931\u8D25");
      items.push({ id: `${shotId}-first`, path: first.path }, { id: `${shotId}-last`, path: last.path });
      appendBoard(cwd, { id: boardId, shotId, kind: "firstLast", panels: [{ index: 0, image: first }, { index: 1, image: last }] });
    } else if (opts.gridMode === "subPanels") {
      const n = Math.max(2, Math.min(9, opts.panels ?? 4));
      const panels = [];
      for (let i = 0; i < n; i++) {
        report(0.1 + 0.8 * i / n, `\u751F\u6210\u7B2C ${i + 1}/${n} \u683C`);
        const ref = await callImage(`${base}\uFF0C\u7B2C ${i + 1} \u683C\uFF08\u52A8\u4F5C\u5206\u89E3\uFF09`, "1:1", []);
        if (ref) {
          panels.push({ index: i, image: ref });
          items.push({ id: `${shotId}-p${i}`, path: ref.path });
        }
      }
      if (panels.length === 0) throw new Error("\u5BAB\u683C\u751F\u6210\u5931\u8D25");
      appendBoard(cwd, { id: boardId, shotId, kind: "grid", gridMode: "subPanels", panels });
    } else {
      report(0.3, "\u751F\u6210\u591A\u955C\u603B\u89C8\u5BAB\u683C");
      const overviewPrompt = `${styleLine(project) ? styleLine(project) + "\uFF0C" : ""}\u6545\u4E8B\u677F\u603B\u89C8\uFF0C\u591A\u955C\u5934\u5BAB\u683C\uFF1A${shot.description}`;
      const ref = await callImage(overviewPrompt, "1:1", []);
      if (!ref) throw new Error("\u5BAB\u683C\u751F\u6210\u5931\u8D25");
      items.push({ id: shotId, path: ref.path });
      appendBoard(cwd, { id: boardId, shotId, kind: "grid", gridMode: "multiShot", image: ref });
    }
    report(1, "\u5B8C\u6210");
    return { paths: items.map((i) => i.path), items };
  });
  return job;
}
function appendBoard(cwd, board) {
  mutateProject(cwd, (p) => {
    const item = {
      id: board.id,
      shotId: board.shotId,
      kind: board.kind,
      ...board.gridMode ? { gridMode: board.gridMode } : {},
      ...board.image ? { image: board.image } : {},
      ...board.panels ? { panels: board.panels } : {},
      status: "ready",
      updatedAt: Date.now()
    };
    p.boards.push(item);
    const shot = p.shots.find((s) => s.id === board.shotId);
    if (shot) shot.boardIds.push(item.id);
  });
}

// src/generate/video.ts
import { relative as relative2 } from "node:path";
async function resolveVideoVendor(cwd, vendorId, modelName) {
  const cfg = readConfig(cwd);
  const active = vendorId && modelName ? { vendorId, modelName } : cfg.active.video;
  if (!active) throw new Error("\u672A\u914D\u7F6E\u89C6\u9891\u6A21\u578B\uFF1A\u8BF7\u5728 config.json \u7684 active.video \u6307\u5B9A vendorId \u4E0E modelName\uFF0C\u6216\u5728\u8C03\u7528\u65F6\u4F20\u5165");
  const entry = cfg.vendors[active.vendorId];
  if (!entry?.trusted) throw new Error(`\u4F9B\u5E94\u5546 ${active.vendorId} \u672A\u6807\u8BB0\u4E3A\u53EF\u4FE1\uFF1A\u8BF7\u5728 config.json \u7684 vendors.${active.vendorId}.trusted \u8BBE\u4E3A true`);
  const session = await getVendorSession(cwd, active.vendorId, entry.inputValues ?? {});
  const model = session.videoModels.find((m) => m.modelName === active.modelName);
  if (!model) {
    const names = session.videoModels.map((m) => m.modelName).join(", ") || "\uFF08\u65E0\uFF09";
    throw new Error(`\u4F9B\u5E94\u5546 ${active.vendorId} \u6CA1\u6709\u89C6\u9891\u6A21\u578B ${active.modelName}\uFF1B\u53EF\u7528\uFF1A${names}`);
  }
  return { vendorId: active.vendorId, modelName: active.modelName, model, session };
}
function refs(cwd, paths) {
  const out = [];
  for (const p of paths) {
    const buf = readMediaBuffer(cwd, p);
    if (!buf) continue;
    const mime = /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : "image/png";
    out.push({ type: "image", sourceType: "base64", base64: `data:${mime};base64,${buf.toString("base64")}` });
  }
  return out;
}
function relDirFrom2(cwd, abs) {
  return relative2(projectDir(cwd), abs).split("\\").join("/");
}
function pickReferencePaths(project, shot, mode) {
  const paths = [];
  const boards = project.boards.filter((b) => b.shotId === shot.id);
  const hasFirstLast = mode.some((m) => m === "startEndRequired" || m === "endFrameOptional" || m === "startFrameOptional");
  for (const b of boards) {
    if (b.kind === "firstLast" && b.panels) {
      for (const panel of b.panels) if (panel.image) paths.push(panel.image.path);
    } else if (b.kind === "single" && b.image) {
      paths.push(b.image.path);
    }
  }
  if (hasFirstLast && paths.length > 2) return paths.slice(0, 2);
  if (mode.includes("singleImage")) return paths.slice(0, 1);
  return paths;
}
function startVideoGeneration(cwd, shotId, opts) {
  const job = createJob(cwd, "video_generate", `\u89C6\u9891\u6BB5 ${shotId}`);
  void runJob(job, async (signal, report) => {
    const vendor = await resolveVideoVendor(cwd, opts.vendorId, opts.modelName);
    const project = readProject(cwd);
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) throw new Error(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${shotId}`);
    const mode = Array.isArray(vendor.model.mode) ? vendor.model.mode : ["text"];
    const duration = opts.durationSec ?? project.pipeline.globalPrefs.videoSeconds ?? pickDuration(vendor.model);
    const resolution = opts.resolution ?? pickResolution(vendor.model, duration);
    const aspectRatio = project.meta.aspect === "landscape" ? "16:9" : "9:16";
    const prompt = opts.prompt ?? [project.style.promptFragment, shot.description, shot.cameraMove ? `\u8FD0\u955C\uFF1A${shot.cameraMove}` : "", shot.dialogue ? `\u53F0\u8BCD\uFF1A${shot.dialogue}` : ""].filter(Boolean).join("\uFF0C");
    const refPaths = opts.referencePaths ?? pickReferencePaths(project, shot, mode);
    const referenceList = refPaths.length ? refs(cwd, refPaths) : [];
    const config = {
      duration,
      resolution,
      aspectRatio,
      prompt,
      mode,
      ...referenceList.length ? { referenceList } : {},
      ...typeof vendor.model.audio === "boolean" ? { audio: vendor.model.audio } : {}
    };
    const videoId = newVideoId();
    const dir = relDirFrom2(cwd, `${videosDir(cwd)}/${shotId}`);
    report(0.1, `\u63D0\u4EA4 ${vendor.vendorId}/${vendor.modelName}\uFF08${duration}s ${resolution}\uFF09`);
    const b64 = await vendor.session.videoRequest(config, vendor.modelName, 9e5);
    if (signal.aborted) throw new Error("\u5DF2\u53D6\u6D88");
    report(0.9, "\u5199\u5165\u89C6\u9891");
    const ref = persistMedia(cwd, b64, {
      relDirFromProjectDir: dir,
      baseName: videoId,
      vendorId: vendor.vendorId,
      modelName: vendor.modelName,
      fallbackMime: "video/mp4"
    });
    if (!ref) throw new Error("\u4F9B\u5E94\u5546\u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548\u7684\u6709\u5934 base64 \u89C6\u9891");
    mutateProject(cwd, (p) => {
      p.videos.push({
        id: videoId,
        shotId,
        prompt,
        vendorId: vendor.vendorId,
        modelName: vendor.modelName,
        durationSec: duration,
        resolution,
        aspectRatio,
        mode,
        audio: typeof vendor.model.audio === "boolean" ? vendor.model.audio : false,
        ...refPaths.length ? { referenceFrameIds: refPaths } : {},
        output: ref,
        status: "ready",
        jobId: job.id,
        updatedAt: Date.now()
      });
      const s = p.shots.find((x) => x.id === shotId);
      if (s) s.videoIds.push(videoId);
    });
    return { paths: [ref.path], items: [{ id: videoId, path: ref.path }] };
  });
  return job;
}
function pickDuration(model) {
  const map = model.durationResolutionMap?.[0];
  return map?.duration?.[0] ?? 5;
}
function pickResolution(model, duration) {
  const entry = model.durationResolutionMap?.find((m) => m.duration.includes(duration));
  return entry?.resolution?.[0] ?? model.durationResolutionMap?.[0]?.resolution?.[0] ?? "720p";
}

// src/server.ts
import http from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, existsSync as existsSync5, readFileSync as readFileSync5, statSync } from "node:fs";
import { join as join4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var WEB_DIR = fileURLToPath2(new URL("./web/", import.meta.url));
var FFMPEG_DIR = fileURLToPath2(new URL("./ffmpeg/", import.meta.url));
var DEFAULT_PORT = 43187;
var MUTATION_HEADER = "x-tianshu-redraw";
var MAX_BODY = 8 * 1024 * 1024;
var MAX_VIEWPORT_BODY = 4096;
var BODY_DRAIN_MS = 2e3;
var state = null;
function tokenFor(cwd) {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err2) => {
      server.off("listening", onListening);
      reject(err2);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}
async function listenWithFallback(server, preferred) {
  if (preferred === 0) return listen(server, 0);
  for (let i = 0; i < 21; i++) {
    try {
      return await listen(server, preferred + i);
    } catch (err2) {
      if (err2.code !== "EADDRINUSE") throw err2;
    }
  }
  return listen(server, 0);
}
async function ensureServer(cwd, preferredPort = DEFAULT_PORT) {
  if (!state) {
    const server = http.createServer(handleRequest);
    server.on("clientError", (_err, socket) => socket.destroy());
    const port = await listenWithFallback(server, preferredPort);
    server.unref();
    const created = { server, port, tokens: /* @__PURE__ */ new Map(), sse: /* @__PURE__ */ new Map() };
    state = created;
    for (const evt of ["change", "selection", "job", "pipeline", "frames", "config"]) {
      const name = evt === "change" ? "project" : evt;
      projectEvents.on(evt, ({ cwd: changed }) => broadcast(created, tokenFor(changed), name));
    }
    jobEvents.on("job", ({ cwd: changed }) => broadcast(created, tokenFor(changed), "job"));
  }
  const token = tokenFor(cwd);
  state.tokens.set(token, cwd);
  return { token, port: state.port, url: `http://127.0.0.1:${state.port}/?ws=${token}` };
}
function currentUrl(cwd) {
  if (!state) return null;
  const token = tokenFor(cwd);
  if (!state.tokens.has(token)) return null;
  return `http://127.0.0.1:${state.port}/?ws=${token}`;
}
var ASSET_TYPES = {
  "canvas.js": "application/javascript; charset=utf-8",
  "canvas.css": "text/css; charset=utf-8",
  "frames-worker.js": "application/javascript; charset=utf-8",
  "canvas.js.map": "application/json; charset=utf-8"
};
function handleRequest(req, res) {
  try {
    routeRequest(req, res);
  } catch (err2) {
    console.error("[tianshu-redraw] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A", err2);
    if (res.headersSent) res.destroy();
    else send(res, 500, "text/plain; charset=utf-8", "internal error");
  }
}
function routeRequest(req, res) {
  const host = req.headers.host;
  if (!host || !isLocalHost(host)) return send(res, 403, "text/plain; charset=utf-8", "forbidden host");
  let url;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "bad request");
  }
  const path = url.pathname;
  if (req.method === "GET" && path === "/healthz") return send(res, 200, "text/plain; charset=utf-8", "ok");
  if (req.method === "GET" && path === "/") return serveStatic(res, "index.html");
  if (req.method === "GET" && path.startsWith("/assets/")) {
    const name = path.slice("/assets/".length);
    if (name in ASSET_TYPES) return serveStatic(res, name, ASSET_TYPES[name]);
    return send(res, 404, "text/plain; charset=utf-8", "not found");
  }
  if (req.method === "GET" && path.startsWith("/ffmpeg/")) {
    const name = path.slice("/ffmpeg/".length);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return send(res, 400, "text/plain; charset=utf-8", "bad name");
    const type = name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".js") ? "application/javascript; charset=utf-8" : "application/octet-stream";
    return serveFile(res, join4(FFMPEG_DIR, name), type);
  }
  if (req.method === "GET" && path === "/api/project") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    const issue = projectIssue(cwd);
    const p = readProject(cwd);
    return sendJson(res, { ...p, jobs: activeJobs(cwd).map(jobView), ...issue ? { issue } : {}, gate: pendingGate(p) });
  }
  if (req.method === "GET" && path === "/api/config") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, redactConfig(readConfig(cwd)));
  }
  if (req.method === "GET" && path === "/api/events") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    return handleSse(res, tokenFor(cwd));
  }
  if (req.method === "GET" && path === "/api/media") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const rel = url.searchParams.get("path") ?? "";
    if (!rel.startsWith(".tianshu-redraw/") || rel.includes("..")) return send(res, 400, "text/plain; charset=utf-8", "bad path");
    const abs = mediaAbs(cwd, rel);
    if (!existsSync5(abs)) return send(res, 404, "text/plain; charset=utf-8", "not found");
    const ext = rel.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "";
    return serveFile(res, abs, mimeFromExt(ext));
  }
  if (req.method === "GET" && path === "/api/source-video") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const p = readProject(cwd);
    if (p.source.mode !== "video" || !p.source.videoPath) return send(res, 404, "text/plain; charset=utf-8", "no source video");
    return streamVideo(req, res, mediaAbs(cwd, p.source.videoPath));
  }
  if (req.method === "GET" && path === "/api/selection") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, { selection: readSelection(cwd) });
  }
  if (req.method === "POST") {
    if (String(req.headers[MUTATION_HEADER] ?? "") !== "1") return send(res, 403, "text/plain; charset=utf-8", "missing header");
    if (path === "/api/viewport") return handleViewport(req, res);
    if (path === "/api/selection") return handleSelection(req, res);
    if (path === "/api/pipeline") return handlePipeline(req, res);
    if (path === "/api/config") return handleConfig(req, res);
    if (path === "/api/frames") return handleFrames(req, res);
    if (path === "/api/frames/contact") return handleContactSheet(req, res);
    if (path === "/api/frames/status") return handleFramesStatus(req, res);
    if (path === "/api/edges") return handleEdges(req, res);
  }
  return send(res, 404, "text/plain; charset=utf-8", "not found");
}
function readJsonBody(req, res, onBody, maxBytes = MAX_BODY) {
  let raw = "";
  let rejected = false;
  req.setEncoding("utf8");
  req.on("error", () => {
  });
  req.on("data", (chunk) => {
    if (rejected) return;
    raw += chunk;
    if (raw.length > maxBytes) {
      rejected = true;
      raw = "";
      const drain = setTimeout(() => req.destroy(), BODY_DRAIN_MS);
      drain.unref();
      req.once("close", () => clearTimeout(drain));
      send(res, 413, "application/json; charset=utf-8", JSON.stringify({ error: "body too large" }));
    }
  });
  req.on("end", () => {
    if (rejected || res.writableEnded || res.headersSent) return;
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad json" }));
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad json" }));
    }
    const body = parsed;
    try {
      const cwd = resolveCwd(typeof body.ws === "string" ? body.ws : null);
      if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
      onBody({ ...body, __cwd: cwd });
    } catch (err2) {
      if (err2 instanceof InvalidInputError) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: err2.message }));
      console.error("[tianshu-redraw] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A", err2);
      if (res.headersSent) res.destroy();
      else send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: "internal error" }));
    }
  });
}
function handleSelection(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const kind = String(body.kind ?? "none");
    const id = typeof body.id === "string" ? body.id : void 0;
    if (id) assertSafeId(id);
    const selection = { kind: ["shot", "asset", "board", "video", "frame"].includes(kind) ? kind : "none", ...id ? { id } : {}, at: Date.now() };
    writeSelection(cwd, selection);
    return sendJson(res, { ok: true });
  });
}
function handlePipeline(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    if (op === "set_step") {
      const step = String(body.step ?? "");
      if (!STEP_IDS.includes(step)) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad step" }));
      mutateProject(cwd, (p) => {
        p.pipeline.currentStep = step;
      });
      return sendJson(res, { ok: true });
    }
    if (op === "answer_gate") {
      const step = String(body.step ?? "");
      if (!STEP_IDS.includes(step)) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad step" }));
      mutateProject(cwd, (p) => {
        const g = p.pipeline.steps[step].gate ?? { asked: true, answered: false };
        p.pipeline.steps[step].gate = { ...g, asked: true, answered: true, answer: typeof body.answer === "string" ? body.answer : "approved" };
      });
      return sendJson(res, { ok: true });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handleConfig(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const patch = body.patch ?? {};
    const next = updateConfig(cwd, patch);
    return sendJson(res, redactConfig(next));
  });
}
function handleFrames(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "add");
    if (op === "add") {
      const index = Number(body.index);
      const tSec = Number(body.tSec);
      const dataUri = String(body.data ?? "");
      const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUri);
      if (!m) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad image data" }));
      const id = newFrameId();
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const path = writeMedia(cwd, `frames/${id}.${ext}`, Buffer.from(m[2], "base64"));
      mutateProject(cwd, (p) => {
        const frame = { id, index: Number.isFinite(index) ? index : p.frames.length, tSec: Number.isFinite(tSec) ? tSec : 0, path, width: Number(body.width) || 0, height: Number(body.height) || 0, selected: false };
        p.frames.push(frame);
      });
      projectEvents.emit("frames", { cwd });
      return sendJson(res, { ok: true, id, path });
    }
    if (op === "select") {
      const id = String(body.id ?? "");
      if (id) assertSafeId(id);
      mutateProject(cwd, (p) => {
        const f = p.frames.find((x) => x.id === id);
        if (f) f.selected = body.selected === true;
      });
      return sendJson(res, { ok: true });
    }
    if (op === "clear") {
      mutateProject(cwd, (p) => {
        p.frames = [];
        p.extractRequest = void 0;
      });
      projectEvents.emit("frames", { cwd });
      return sendJson(res, { ok: true });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handleContactSheet(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const dataUri = String(body.data ?? "");
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUri);
    if (!m) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad image data" }));
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const path = writeMedia(cwd, `frames/_contact/sheet-${Date.now()}.${ext}`, Buffer.from(m[2], "base64"));
    mutateProject(cwd, (p) => {
      p.frames.push({ id: `sheet-${Date.now().toString(36)}`, index: -1, tSec: 0, path, width: Number(body.width) || 0, height: Number(body.height) || 0, selected: false });
      if (p.extractRequest) p.extractRequest = { ...p.extractRequest, status: "done", message: "\u62BD\u5E27\u5B8C\u6210" };
      p.pipeline.steps.frames.status = "done";
    });
    projectEvents.emit("frames", { cwd });
    return sendJson(res, { ok: true, path });
  });
}
function handleFramesStatus(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const status = String(body.status ?? "running");
    const message = typeof body.message === "string" ? body.message : void 0;
    mutateProject(cwd, (p) => {
      if (p.extractRequest) p.extractRequest = { ...p.extractRequest, status: status === "error" ? "error" : status === "done" ? "done" : "running", ...message ? { message } : {} };
      if (status === "error") p.pipeline.steps.frames.status = "active";
    });
    projectEvents.emit("frames", { cwd });
    return sendJson(res, { ok: true });
  });
}
function handleEdges(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    const source = typeof body.source === "string" ? body.source : "";
    const target = typeof body.target === "string" ? body.target : "";
    if (!source || !target) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing source or target" }));
    if (op === "add") return sendJson(res, { ok: true, edge: addEdge(cwd, source, target, typeof body.label === "string" ? body.label : void 0) });
    if (op === "remove") {
      removeEdge(cwd, source, target);
      return sendJson(res, { ok: true });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handleViewport(req, res) {
  readJsonBody(
    req,
    res,
    (body) => {
      const cwd = String(body.__cwd);
      setViewport(cwd, { x: Number(body.x) || 0, y: Number(body.y) || 0, zoom: Number(body.zoom) > 0 ? Number(body.zoom) : 1 });
      return sendJson(res, { ok: true });
    },
    MAX_VIEWPORT_BODY
  );
}
function jobView(j) {
  return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, message: j.message, ...j.error ? { error: j.error } : {} };
}
function streamVideo(req, res, abs) {
  if (!existsSync5(abs) || !statSync(abs).isFile()) return send(res, 404, "text/plain; charset=utf-8", "not found");
  const size = statSync(abs).size;
  const ext = abs.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "mp4";
  const type = mimeFromExt(ext);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : size - 1;
      if (start >= size || end >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff"
      });
      createReadStream(abs, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
  createReadStream(abs).pipe(res);
}
function serveFile(res, abs, type) {
  if (!existsSync5(abs) || !statSync(abs).isFile()) return send(res, 404, "text/plain; charset=utf-8", "not found");
  res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
  createReadStream(abs).pipe(res);
}
function handleSse(res, token) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 2000\n\n");
  const s = state;
  if (!s) {
    res.end();
    return;
  }
  const set = s.sse.get(token) ?? /* @__PURE__ */ new Set();
  set.add(res);
  s.sse.set(token, set);
  const keepAlive = setInterval(() => {
    try {
      res.write(": ka\n\n");
    } catch {
    }
  }, 25e3);
  keepAlive.unref();
  res.on("close", () => {
    clearInterval(keepAlive);
    set.delete(res);
  });
}
function broadcast(s, token, event = "project") {
  const set = s.sse.get(token);
  if (!set) return;
  const frame = `event: ${event}
data: ${JSON.stringify({ at: Date.now() })}

`;
  for (const res of set) {
    try {
      res.write(frame);
    } catch {
    }
  }
}
function resolveCwd(token) {
  if (!token || !state) return null;
  return state.tokens.get(token) ?? null;
}
function isLocalHost(host) {
  const name = host.split(":")[0]?.toLowerCase();
  return name === "127.0.0.1" || name === "localhost";
}
function serveStatic(res, name, type = "text/html; charset=utf-8") {
  const file = join4(WEB_DIR, name);
  if (!existsSync5(file)) return send(res, 404, "text/plain; charset=utf-8", "asset not built");
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  if (name === "index.html") {
    headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:";
  }
  res.writeHead(200, headers);
  res.end(readFileSync5(file));
}
function sendJson(res, body) {
  send(res, 200, "application/json; charset=utf-8", JSON.stringify(body));
}
function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

// src/tools.ts
function str2(v) {
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function num2(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function strArr(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) : [];
}
function ok(content) {
  return { content };
}
function err(content) {
  return { content, isError: true };
}
function absPath(cwd, rel) {
  return join5(cwd, rel);
}
function gateNotice(cwd) {
  const p = readProject(cwd);
  const gate = pendingGate(p);
  if (!gate) return "";
  return `

\u26A0\uFE0F \u5F53\u524D\u6709\u672A\u56DE\u7B54\u7684\u95E8\u63A7\uFF08\u6B65\u9AA4 ${gate.step}\uFF09\uFF1A${gate.question ?? "\u7B49\u5F85\u7528\u6237\u786E\u8BA4"}\u3002\u8BF7\u5148\u5411\u7528\u6237\u63D0\u95EE\u5E76\u7B49\u5F85\u56DE\u7B54\uFF0C\u518D\u7EE7\u7EED\u3002`;
}
async function redrawOpen(call) {
  const port = num2(call.args.port);
  const { url } = await ensureServer(call.cwd, port ?? void 0);
  try {
    writeFileSync3(join5(call.cwd, PROJECT_DIR_NAME, "url.txt"), url + "\n", "utf8");
  } catch {
  }
  const p = readProject(call.cwd);
  const steps = STEP_IDS.map((id) => `${id}:${p.pipeline.steps[id].status}`).join(" ");
  return ok(
    `\u753B\u5E03\u670D\u52A1\u5DF2\u5C31\u7EEA\u3002\u8BF7\u7ACB\u523B\u628A\u4E0B\u9762\u8FD9\u4E00\u884C\u539F\u6837\u53D1\u7ED9\u7528\u6237\uFF08\u5355\u72EC\u4E00\u884C\uFF0C\u4FBF\u4E8E\u70B9\u51FB\uFF09\uFF1A
${url}
\u5DE5\u4F5C\u533A\uFF1A${call.cwd}
\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(call.cwd)}
\u5F53\u524D\u6D41\u7A0B\uFF1A${steps}
\u4E0B\u4E00\u6B65\uFF1A\u4ECE\u300C\u62BD\u5E27\u770B\u7247\u300D\u5F00\u59CB\uFF08redraw_frames_ingest\uFF09\u3002\u753B\u5E03\u64CD\u4F5C\uFF1A\u7A7A\u683C/\u4E2D\u952E\u62D6\u62FD\u5E73\u79FB\uFF0CCtrl+\u6EDA\u8F6E\u7F29\u653E\u3002`
  );
}
async function redrawGetState(call) {
  const p = readProject(call.cwd);
  const selection = readSelection(call.cwd);
  const url = currentUrl(call.cwd);
  const sections = [];
  const issue = projectIssue(call.cwd);
  if (issue) sections.push(`\u8B66\u544A\uFF1A${issue}`);
  sections.push(
    `\u6D41\u7A0B\u8FDB\u5EA6\uFF08\u5F53\u524D\uFF1A${p.pipeline.currentStep}\uFF09\uFF1A
` + STEP_IDS.map((id) => {
      const s = p.pipeline.steps[id];
      const g = s.gate ? ` \u95E8\u63A7[${s.gate.answered ? "\u5DF2\u7B54" : s.gate.asked ? "\u5F85\u7B54" : "\u672A\u95EE"}]` : "";
      return `- ${id}: ${s.status}${g}`;
    }).join("\n")
  );
  const gate = pendingGate(p);
  if (gate) sections.push(`\u26A0\uFE0F \u672A\u56DE\u7B54\u7684\u95E8\u63A7\uFF08${gate.step}\uFF09\uFF1A${gate.question ?? "\u7B49\u5F85\u7528\u6237\u786E\u8BA4"}`);
  sections.push(
    `\u8BA1\u6570\uFF1A\u62BD\u5E27 ${p.frames.length}\uFF5C\u955C\u5934 ${p.shots.length}\uFF5C\u8D44\u4EA7 ${p.assets.length}\uFF5C\u5206\u955C\u56FE ${p.boards.length}\uFF5C\u89C6\u9891 ${p.videos.length}`
  );
  if (p.style.styleId) sections.push(`\u98CE\u683C\uFF1A${p.style.styleId}`);
  if (p.localization.region) sections.push(`\u672C\u571F\u5316\u5730\u533A\uFF1A${p.localization.region}`);
  if (p.source.mode === "video" && p.source.videoPath) sections.push(`\u7D20\u6750\uFF1A\u89C6\u9891 ${p.source.videoPath}`);
  else if (p.source.story) sections.push(`\u7D20\u6750\uFF1A\u6587\u672C\u5267\u60C5\uFF08${p.source.story.slice(0, 40)}\u2026\uFF09`);
  const jobs2 = activeJobs(call.cwd);
  if (jobs2.length) {
    sections.push(`\u6D3B\u8DC3\u4EFB\u52A1\uFF08${jobs2.length}\uFF09\uFF1A
` + jobs2.map((j) => `- ${j.id} ${j.kind} ${Math.round(j.progress * 100)}% ${j.message}`).join("\n"));
  }
  if (selection && selection.kind !== "none") {
    sections.push(`\u5F53\u524D\u9009\u4E2D\uFF1A${selection.kind} ${selection.id ?? ""}`);
  }
  sections.push(url ? `\u753B\u5E03 URL\uFF1A${url}` : "\u63D0\u793A\uFF1A\u5148\u8C03\u7528 redraw_open \u83B7\u53D6\u753B\u5E03 URL\u3002");
  return ok(sections.join("\n\n"));
}
async function redrawConfigGet(call) {
  const cfg = redactConfig(readConfig(call.cwd));
  const vendors = listVendorFiles(call.cwd);
  return ok(
    `\u914D\u7F6E\uFF08\u5BC6\u94A5\u5DF2\u8131\u654F\uFF09\uFF1A
${JSON.stringify(cfg, null, 2)}

\u5DE5\u4F5C\u533A\u9002\u914D\u6587\u4EF6\uFF08vendors/\uFF09\uFF1A${vendors.length ? vendors.join(", ") : "\uFF08\u65E0\uFF09"}
\u4F9B\u5E94\u5546\u9700\u5728 config.json \u7684 vendors.<id>.trusted=true \u624D\u5141\u8BB8\u6267\u884C\u5176\u4EE3\u7801\u3002`
  );
}
async function redrawConfigSet(call) {
  const patch = {};
  const imageVendor = str2(call.args.image_vendor);
  const imageModel = str2(call.args.image_model);
  const videoVendor = str2(call.args.video_vendor);
  const videoModel = str2(call.args.video_model);
  const active = {};
  if (imageVendor && imageModel) active.image = { vendorId: imageVendor, modelName: imageModel };
  if (videoVendor && videoModel) active.video = { vendorId: videoVendor, modelName: videoModel };
  if (Object.keys(active).length) patch.active = active;
  const vendorId = str2(call.args.vendor_id);
  const inputValues = call.args.input_values;
  if (vendorId) {
    patch.vendors = { [vendorId]: { ...typeof call.args.trusted === "boolean" ? { trusted: call.args.trusted } : {}, ...inputValues ? { inputValues } : {} } };
  }
  if (Object.keys(patch).length === 0) return err("\u6CA1\u6709\u53EF\u8BBE\u7F6E\u7684\u5B57\u6BB5\u3002\u53EF\u7528\uFF1Aimage_vendor/image_model\u3001video_vendor/video_model\u3001vendor_id+input_values+trusted\u3002");
  const next = updateConfig(call.cwd, patch);
  return ok(`\u5DF2\u66F4\u65B0\u914D\u7F6E\uFF1A
${JSON.stringify(redactConfig(next), null, 2)}`);
}
async function redrawVendorList(call) {
  const files = listVendorFiles(call.cwd);
  if (files.length === 0) {
    return ok(`\u5DE5\u4F5C\u533A\u6CA1\u6709\u9002\u914D\u6587\u4EF6\u3002\u8BF7\u5728 ${PROJECT_DIR_NAME}/vendors/ \u653E\u5165 <id>.ts\uFF08\u683C\u5F0F\u53C2\u8003 Toonflow \u4F9B\u5E94\u5546\u6A21\u677F\uFF09\u3002`);
  }
  const cfg = readConfig(call.cwd);
  const lines = [];
  for (const id of files) {
    const entry = cfg.vendors[id];
    const summary = await loadVendorSummary(call.cwd, id, entry?.inputValues ?? {});
    if ("error" in summary) {
      lines.push(`- ${id}\uFF1A\u274C ${summary.error}`);
    } else {
      const imgs = summary.imageModels.map((m) => `${m.name}(${m.modelName})`).join("\u3001") || "\u65E0";
      const vids = summary.videoModels.map((m) => `${m.name}(${m.modelName})`).join("\u3001") || "\u65E0";
      lines.push(`- ${id}\uFF08${summary.vendor.name}\uFF0C${entry?.trusted ? "\u5DF2\u4FE1\u4EFB" : "\u672A\u4FE1\u4EFB"}\uFF09
  \u56FE\u50CF\u6A21\u578B\uFF1A${imgs}
  \u89C6\u9891\u6A21\u578B\uFF1A${vids}`);
    }
  }
  return ok(`\u5DE5\u4F5C\u533A\u9002\u914D\u6587\u4EF6\uFF1A
${lines.join("\n")}`);
}
async function redrawVendorValidate(call) {
  const id = str2(call.args.vendor_id);
  if (!id) return err("\u9700\u8981 vendor_id");
  const cfg = readConfig(call.cwd);
  const summary = await loadVendorSummary(call.cwd, id, cfg.vendors[id]?.inputValues ?? {});
  if ("error" in summary) return err(`\u6821\u9A8C\u5931\u8D25\uFF1A${summary.error}`);
  return ok(
    `\u9002\u914D\u6587\u4EF6 ${id} \u6821\u9A8C\u901A\u8FC7\u3002
\u4F9B\u5E94\u5546\uFF1A${summary.vendor.name} v${summary.vendor.version}
\u56FE\u50CF\u6A21\u578B\uFF1A${summary.imageModels.map((m) => m.modelName).join(", ") || "\u65E0"}
\u89C6\u9891\u6A21\u578B\uFF1A${summary.videoModels.map((m) => m.modelName).join(", ") || "\u65E0"}`
  );
}
async function redrawStyleList(call) {
  return ok(formatStyleList(call.cwd));
}
async function redrawStyleSet(call) {
  const id = str2(call.args.style_id);
  if (!id) return err("\u9700\u8981 style_id");
  const style = resolveStyle(call.cwd, id);
  if (!style) return err(`\u672A\u77E5\u98CE\u683C\uFF1A${id}\u3002\u7528 redraw_style_list \u67E5\u770B\u53EF\u9009\u98CE\u683C\u3002`);
  mutateProject(call.cwd, (p) => {
    p.style = { styleId: style.id, promptFragment: style.promptFragment, appliedAt: Date.now() };
    if (!p.meta.region) p.meta.region = p.localization.region || void 0;
  });
  return ok(`\u5DF2\u9501\u5B9A\u98CE\u683C\u300C${style.name}\u300D\uFF08${style.id}\uFF09\u3002\u63D0\u793A\u8BCD\u7247\u6BB5\uFF1A${style.promptFragment}`);
}
async function redrawFramesIngest(call) {
  const videoPath = str2(call.args.video_path);
  const story = str2(call.args.story);
  if (!videoPath && !story) return err("\u9700\u8981 video_path\uFF08\u672C\u5730\u89C6\u9891\u6587\u4EF6\uFF09\u6216 story\uFF08\u7EAF\u6587\u672C\u5267\u60C5\uFF09\u4E4B\u4E00\u3002");
  if (videoPath) {
    if (!existsSync6(videoPath)) return err(`\u89C6\u9891\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${videoPath}`);
    const ext = (videoPath.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "mp4").toLowerCase();
    const destRel = `${PROJECT_DIR_NAME}/assets/source/source.${ext}`;
    mkdirSync3(join5(call.cwd, PROJECT_DIR_NAME, "assets", "source"), { recursive: true });
    const dest = join5(call.cwd, destRel);
    try {
      writeFileSync3(dest, readFileSync6(videoPath));
    } catch (e) {
      return err(`\u590D\u5236\u89C6\u9891\u5931\u8D25\uFF1A${e.message}`);
    }
    mutateProject(call.cwd, (p) => {
      p.source = { ...p.source, mode: "video", videoPath: destRel, ingestAt: Date.now() };
    });
    setStep(call.cwd, "frames", "active");
    return ok(
      `\u5DF2\u63A5\u6536\u89C6\u9891\u7D20\u6750\uFF1A${destRel}\uFF08\u539F\u8DEF\u5F84 ${videoPath}\uFF09
\u4E0B\u4E00\u6B65\uFF1Aredraw_frames_extract\uFF08interval_sec \u6307\u5B9A\u62BD\u5E27\u95F4\u9694\u79D2\uFF09\u3002
\u6CE8\u610F\uFF1A\u62BD\u5E27\u5728\u6D4F\u89C8\u5668\u5185\u7528 ffmpeg.wasm \u6267\u884C\uFF0C\u9700\u7528\u6237\u6253\u5F00\u753B\u5E03\u3002`
    );
  }
  mutateProject(call.cwd, (p) => {
    p.source = { mode: "story", story, ingestAt: Date.now() };
  });
  setStep(call.cwd, "frames", "done");
  return ok(`\u5DF2\u63A5\u6536\u6587\u672C\u5267\u60C5\uFF08${story.length} \u5B57\uFF09\u3002\u65E0\u89C6\u9891\u7D20\u6750\uFF0C\u8DF3\u8FC7\u62BD\u5E27\uFF0C\u53EF\u76F4\u63A5\u8FDB\u5165\u672C\u571F\u5316\uFF08redraw_localize_set\uFF09\u3002`);
}
async function redrawFramesExtract(call) {
  const interval = num2(call.args.interval_sec) ?? 2;
  if (interval <= 0) return err("interval_sec \u5FC5\u987B\u4E3A\u6B63\u6570");
  const p = readProject(call.cwd);
  if (p.source.mode !== "video" || !p.source.videoPath) return err("\u5F53\u524D\u7D20\u6750\u4E0D\u662F\u89C6\u9891\uFF0C\u65E0\u9700\u62BD\u5E27\u3002");
  const { url } = await ensureServer(call.cwd);
  mutateProject(call.cwd, (proj) => {
    proj.extractRequest = { intervalSec: interval, status: "requested", at: Date.now() };
    proj.pipeline.steps.frames.status = "active";
  });
  return ok(
    `\u5DF2\u63D0\u4EA4\u62BD\u5E27\u8BF7\u6C42\uFF1A\u6BCF ${interval} \u79D2\u4E00\u5E27\u3002
**\u62BD\u5E27\u5728\u6D4F\u89C8\u5668\u5185\u6267\u884C**\uFF0C\u8BF7\u628A\u753B\u5E03\u94FE\u63A5\u53D1\u7ED9\u7528\u6237\u5E76\u8BA9\u5176\u4FDD\u6301\u6253\u5F00\uFF1A
${url}
\u968F\u540E\u7528 redraw_job_status / redraw_frames_list \u8F6E\u8BE2\u7ED3\u679C\u3002`
  );
}
async function redrawFramesList(call) {
  const p = readProject(call.cwd);
  if (p.frames.length === 0) {
    const req = p.extractRequest;
    return ok(
      `\u6682\u65E0\u62BD\u5E27\u7ED3\u679C\u3002` + (req ? `\u62BD\u5E27\u8BF7\u6C42\u72B6\u6001\uFF1A${req.status}${req.message ? "\uFF08" + req.message + "\uFF09" : ""}\u3002` : "") + `
\u8BF7\u786E\u8BA4\u7528\u6237\u5DF2\u6253\u5F00\u753B\u5E03\u5E76\u5B8C\u6210\u62BD\u5E27\u3002`
    );
  }
  const contact = p.frames.find((f) => f.path.includes("_contact"));
  const lines = p.frames.filter((f) => !f.path.includes("_contact")).map((f) => `- [${f.index}] ${f.tSec}s ${absPath(call.cwd, f.path)}`);
  return ok(
    `\u5171 ${p.frames.length} \u5E27\uFF08\u8DEF\u5F84\u4F9B\u4F60\u5F15\u7528\uFF0C\u4F60\u65E0\u6CD5\u76F4\u63A5\u770B\u5230\u56FE\u50CF\u5185\u5BB9\uFF0C\u9700\u7528\u6237\u67E5\u770B\uFF09\uFF1A
${lines.join("\n")}
` + (contact ? `\u5BAB\u683C\u603B\u89C8\u56FE\uFF1A${absPath(call.cwd, contact.path)}
` : "") + `\u63D0\u793A\uFF1A\u8BF7\u7528\u6237\u9010\u5E27\u67E5\u770B\u6216\u53C2\u8003\u5BAB\u683C\u56FE\uFF0C\u636E\u6B64\u7406\u89E3\u5267\u60C5\u3002`
  );
}
async function redrawLocalizeSet(call) {
  const region = str2(call.args.region);
  if (!region) return err("\u9700\u8981 region\uFF08\u76EE\u6807\u5730\u533A\uFF09");
  const templateId = str2(call.args.template_id) ?? "default";
  const template = localizationTemplate(templateId);
  const c = call.args.checklist ?? {};
  mutateProject(call.cwd, (p) => {
    p.localization = {
      region,
      templateId,
      report: {
        region,
        checklist: {
          costume: str2(c.costume) ?? "",
          architecture: str2(c.architecture) ?? "",
          festival: str2(c.festival) ?? "",
          taboos: str2(c.taboos) ?? "",
          colorPreference: str2(c.colorPreference) ?? "",
          ...str2(c.notes) ? { notes: str2(c.notes) } : {}
        },
        updatedAt: Date.now()
      },
      appliedAt: Date.now()
    };
    p.meta.region = region;
  });
  setStep(call.cwd, "localize", "done");
  return ok(
    `\u5DF2\u8BB0\u5F55\u672C\u571F\u5316\u62A5\u544A\uFF08\u5730\u533A\uFF1A${region}\uFF0C\u6A21\u677F\uFF1A${template.name}\uFF09\u3002
\u8C03\u7814\u63D0\u793A\uFF1A${template.prompt}
\u4E0B\u4E00\u6B65\uFF1A\u5199\u5267\u672C\uFF08redraw_script_upsert\uFF09\u3002`
  );
}
async function redrawLocalizeGet(call) {
  const p = readProject(call.cwd);
  if (!p.localization.region) return ok("\u5C1A\u672A\u8BBE\u7F6E\u672C\u571F\u5316\u3002\u7528 redraw_localize_set \u8BBE\u7F6E\u5730\u533A\u4E0E\u7ED3\u6784\u5316\u62A5\u544A\u3002");
  const r = p.localization.report;
  return ok(
    `\u5730\u533A\uFF1A${p.localization.region}\uFF08\u6A21\u677F ${p.localization.templateId}\uFF09
` + (r ? `\u670D\u9970\uFF1A${r.checklist.costume}
\u5EFA\u7B51\uFF1A${r.checklist.architecture}
\u8282\u65E5\uFF1A${r.checklist.festival}
\u7981\u5FCC\uFF1A${r.checklist.taboos}
\u8272\u5F69\u504F\u597D\uFF1A${r.checklist.colorPreference}` + (r.checklist.notes ? `
\u5907\u6CE8\uFF1A${r.checklist.notes}` : "") : "\uFF08\u65E0\u7ED3\u6784\u5316\u62A5\u544A\uFF09")
  );
}
function parseEpisodes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let i = 0;
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const scenes = Array.isArray(e.scenes) ? e.scenes.map((s, si) => ({
      id: typeof s.id === "string" && isSafeId(s.id) ? s.id : newSceneId(),
      index: num2(s.index) ?? si,
      slug: str2(s.slug) ?? "",
      location: str2(s.location) ?? "",
      timeOfDay: str2(s.timeOfDay) ?? "",
      summary: str2(s.summary) ?? "",
      beats: strArr(s.beats)
    })) : [];
    out.push({
      id: typeof e.id === "string" && isSafeId(e.id) ? e.id : newEpisodeId(),
      index: num2(e.index) ?? i,
      title: str2(e.title) ?? `\u7B2C ${i + 1} \u96C6`,
      logline: str2(e.logline) ?? "",
      synopsis: str2(e.synopsis) ?? "",
      scenes,
      status: "draft",
      updatedAt: Date.now()
    });
    i++;
  }
  return out;
}
async function redrawScriptUpsert(call) {
  const episodes = parseEpisodes(call.args.episodes);
  if (episodes.length === 0) return err("\u9700\u8981 episodes \u6570\u7EC4\uFF08\u6BCF\u96C6\u542B title/logline/synopsis/scenes\uFF09\u3002");
  const revise = call.args.revise === true;
  mutateProject(call.cwd, (p) => {
    if (revise) {
      for (const ep of episodes) {
        const idx = p.script.episodes.findIndex((x) => x.index === ep.index);
        if (idx >= 0) p.script.episodes[idx] = { ...ep, id: p.script.episodes[idx].id, status: "draft" };
        else p.script.episodes.push(ep);
      }
      p.script.revisions++;
    } else {
      p.script.episodes = episodes;
      p.script.revisions = 1;
    }
    p.script.status = "draft";
    delete p.script.approvedAt;
  });
  setStep(call.cwd, "script", "active");
  setGate(call.cwd, "script", { asked: true, answered: false, question: "\u5267\u672C\u5DF2\u8349\u62DF\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u6279\u51C6\uFF08\u6216\u63D0\u51FA\u4FEE\u6539\uFF09" });
  return ok(
    `\u5DF2\u5199\u5165\u5267\u672C\u8349\u7A3F\uFF1A${episodes.length} \u96C6\u3002
\u26A0\uFE0F \u8BF7\u5148\u5411\u7528\u6237\u5C55\u793A\u5267\u672C\u8981\u70B9\u5E76**\u7B49\u5F85\u786E\u8BA4**\uFF0C\u518D\u8C03\u7528 redraw_script_approve\u3002` + gateNotice(call.cwd)
  );
}
async function redrawScriptGet(call) {
  const p = readProject(call.cwd);
  if (p.script.episodes.length === 0) return ok("\u5C1A\u65E0\u5267\u672C\u3002\u7528 redraw_script_upsert \u5199\u5165\u3002");
  const lines = p.script.episodes.map(
    (e) => `\u7B2C ${e.index + 1} \u96C6\u300A${e.title}\u300B\uFF08${e.status}\uFF09
  \u4E00\u53E5\u8BDD\uFF1A${e.logline}
  \u6897\u6982\uFF1A${e.synopsis}
  \u573A\u6B21\uFF08${e.scenes.length}\uFF09\uFF1A
` + e.scenes.map((s) => `    ${s.index + 1}. ${s.slug || s.location}\uFF5C${s.timeOfDay}\uFF5C${s.summary}`).join("\n")
  );
  return ok(`\u5267\u672C\u72B6\u6001\uFF1A${p.script.status}\uFF08\u4FEE\u8BA2 ${p.script.revisions} \u6B21\uFF09

${lines.join("\n\n")}`);
}
async function redrawScriptApprove(call) {
  const p = readProject(call.cwd);
  if (p.script.status !== "draft") return err("\u5F53\u524D\u6CA1\u6709\u5F85\u6279\u51C6\u7684\u5267\u672C\u8349\u7A3F\u3002");
  mutateProject(call.cwd, (proj) => {
    proj.script.status = "approved";
    proj.script.approvedAt = Date.now();
    proj.script.episodes.forEach((e) => e.status = "approved");
  });
  setGate(call.cwd, "script", { answered: true, answer: str2(call.args.answer) ?? "approved" });
  setStep(call.cwd, "script", "done");
  return ok("\u5267\u672C\u5DF2\u6279\u51C6\u3002\u4E0B\u4E00\u6B65\uFF1A\u5199\u5206\u955C\u8868\uFF08redraw_shotlist_upsert\uFF09\u3002");
}
function parseShots(raw, episodeId) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let i = 0;
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    out.push({
      id: typeof s.id === "string" && isSafeId(s.id) ? s.id : newShotId(),
      index: num2(s.index) ?? i,
      episodeId: str2(s.episodeId) ?? episodeId,
      durationSec: num2(s.durationSec) ?? 3,
      shotSize: str2(s.shotSize) ?? "",
      cameraMove: str2(s.cameraMove) ?? "",
      scene: str2(s.scene) ?? "",
      characters: strArr(s.characters),
      props: strArr(s.props),
      description: str2(s.description) ?? "",
      ...str2(s.dialogue) ? { dialogue: str2(s.dialogue) } : {},
      ...str2(s.voiceover) ? { voiceover: str2(s.voiceover) } : {},
      ...str2(s.emotion) ? { emotion: str2(s.emotion) } : {},
      ...str2(s.sourceFrameId) ? { sourceFrameId: str2(s.sourceFrameId) } : {},
      boardIds: [],
      videoIds: [],
      status: "draft",
      updatedAt: Date.now()
    });
    i++;
  }
  return out;
}
async function redrawShotlistUpsert(call) {
  const shots = parseShots(call.args.shots, str2(call.args.episode_id) ?? "");
  if (shots.length === 0) return err("\u9700\u8981 shots \u6570\u7EC4\uFF08\u6807\u51C6\u5B57\u6BB5\uFF1AshotSize/cameraMove/scene/characters/props/description/dialogue/emotion/durationSec\uFF09\u3002");
  const revise = call.args.revise === true;
  mutateProject(call.cwd, (p) => {
    if (revise) {
      for (const s of shots) {
        const idx = p.shots.findIndex((x) => x.index === s.index);
        if (idx >= 0) p.shots[idx] = { ...s, id: p.shots[idx].id, boardIds: p.shots[idx].boardIds, videoIds: p.shots[idx].videoIds };
        else p.shots.push(s);
      }
      p.shots.sort((a, b) => a.index - b.index);
      p.shots.forEach((s, i) => s.index = i);
    } else {
      p.shots = shots;
    }
  });
  setStep(call.cwd, "shotlist", "active");
  setGate(call.cwd, "shotlist", { asked: true, answered: false, question: "\u5206\u955C\u8868\u5DF2\u8349\u62DF\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u6279\u51C6\uFF08\u6216\u63D0\u51FA\u4FEE\u6539\uFF09" });
  return ok(
    `\u5DF2\u5199\u5165\u5206\u955C\u8868\uFF1A${shots.length} \u4E2A\u955C\u5934\u3002
\u26A0\uFE0F \u8BF7\u5148\u5411\u7528\u6237\u5C55\u793A\u5206\u955C\u8981\u70B9\u5E76**\u7B49\u5F85\u786E\u8BA4**\uFF0C\u518D\u8C03\u7528 redraw_shotlist_approve\u3002` + gateNotice(call.cwd)
  );
}
async function redrawShotlistGet(call) {
  const p = readProject(call.cwd);
  if (p.shots.length === 0) return ok("\u5C1A\u65E0\u5206\u955C\u8868\u3002\u7528 redraw_shotlist_upsert \u5199\u5165\u3002");
  const lines = p.shots.map(
    (s) => `${s.index + 1}. [${s.shotSize}] ${s.durationSec}s\uFF5C${s.scene}\uFF5C${s.cameraMove}
   \u4EBA\u7269\uFF1A${s.characters.join("\u3001") || "\u2014"}\uFF5C\u9053\u5177\uFF1A${s.props.join("\u3001") || "\u2014"}
   \u753B\u9762\uFF1A${s.description}
` + (s.dialogue ? `   \u5BF9\u767D\uFF1A${s.dialogue}
` : "") + (s.voiceover ? `   \u65C1\u767D\uFF1A${s.voiceover}
` : "") + (s.emotion ? `   \u60C5\u7EEA\uFF1A${s.emotion}` : "")
  );
  return ok(`\u5206\u955C\u8868\uFF08${p.shots.length} \u4E2A\u955C\u5934\uFF0C\u72B6\u6001 ${p.script.status}\uFF09\uFF1A
${lines.join("\n")}`);
}
async function redrawShotlistApprove(call) {
  const p = readProject(call.cwd);
  if (p.shots.length === 0) return err("\u5C1A\u65E0\u5206\u955C\u8868\u53EF\u6279\u51C6\u3002");
  mutateProject(call.cwd, (proj) => {
    proj.shots.forEach((s) => s.status = "approved");
  });
  setGate(call.cwd, "shotlist", { answered: true, answer: str2(call.args.answer) ?? "approved" });
  setStep(call.cwd, "shotlist", "done");
  return ok("\u5206\u955C\u8868\u5DF2\u6279\u51C6\u3002\u4E0B\u4E00\u6B65\uFF1A\u5206\u914D\u8D44\u4EA7\uFF08redraw_assets_upsert\uFF09\u3002");
}
async function redrawAssetsUpsert(call) {
  const raw = call.args.assets;
  if (!Array.isArray(raw) || raw.length === 0) return err("\u9700\u8981 assets \u6570\u7EC4\uFF08kind/name/spec/prompt\uFF0C\u53EF\u9009 variants\uFF09\u3002");
  let count = 0;
  mutateProject(call.cwd, (p) => {
    for (const a of raw) {
      if (!a || typeof a !== "object") continue;
      const kind = a.kind === "prop" || a.kind === "scene" ? a.kind : "character";
      const name = str2(a.name);
      if (!name) continue;
      const variantsRaw = Array.isArray(a.variants) ? a.variants : [];
      const existing = p.assets.find((x) => x.name === name && x.kind === kind);
      const variants = variantsRaw.map((v) => ({
        id: typeof v.id === "string" && isSafeId(v.id) ? v.id : newVariantId(),
        name: str2(v.name) ?? "\u53D8\u4F53",
        prompt: str2(v.prompt) ?? "",
        status: "spec"
      }));
      if (existing) {
        existing.spec = str2(a.spec) ?? existing.spec;
        existing.prompt = str2(a.prompt) ?? existing.prompt;
        for (const v of variants) {
          if (!existing.variants.some((x) => x.name === v.name)) existing.variants.push(v);
        }
        existing.updatedAt = Date.now();
      } else {
        p.assets.push({
          id: newAssetId(),
          kind,
          name,
          spec: str2(a.spec) ?? "",
          prompt: str2(a.prompt) ?? "",
          variants,
          shotIds: [],
          status: "spec",
          updatedAt: Date.now()
        });
      }
      count++;
    }
  });
  setStep(call.cwd, "assets", "active");
  return ok(
    `\u5DF2\u5199\u5165 ${count} \u4E2A\u8D44\u4EA7\uFF08\u6587\u5B57\u8BBE\u5B9A + \u63D0\u793A\u8BCD\uFF09\u3002
\u6CE8\u610F\uFF1A**\u5148\u6587\u5B57\u8BBE\u5B9A+\u63D0\u793A\u8BCD\uFF0C\u518D\u751F\u6210\u8D44\u4EA7\u56FE**\uFF08redraw_assets_generate kind=base\uFF09\uFF1B\u884D\u751F\u53D8\u4F53\u7528\u57FA\u7840\u56FE\u4F5C\u53C2\u8003\uFF08kind=variant\uFF09\u3002`
  );
}
async function redrawAssetsList(call) {
  const p = readProject(call.cwd);
  if (p.assets.length === 0) return ok("\u5C1A\u65E0\u8D44\u4EA7\u3002\u7528 redraw_assets_upsert \u5199\u5165\u3002");
  const group = (kind) => {
    const items = p.assets.filter((a) => a.kind === kind);
    if (items.length === 0) return `\uFF08\u65E0\uFF09`;
    return items.map(
      (a) => `- ${a.name}\uFF08${a.id}\uFF0C${a.status}\uFF09
  \u8BBE\u5B9A\uFF1A${a.spec}
  \u63D0\u793A\u8BCD\uFF1A${a.prompt}
  \u57FA\u7840\u56FE\uFF1A${a.baseImage ? absPath(call.cwd, a.baseImage.path) : "\uFF08\u672A\u751F\u6210\uFF09"}
  \u53D8\u4F53\uFF1A${a.variants.length ? a.variants.map((v) => `${v.name}[${v.status}]${v.image ? " " + absPath(call.cwd, v.image.path) : ""}`).join("\uFF1B") : "\uFF08\u65E0\uFF09"}`
    ).join("\n");
  };
  return ok(`\u4EBA\u7269\uFF1A
${group("character")}

\u9053\u5177\uFF1A
${group("prop")}

\u573A\u666F\uFF1A
${group("scene")}`);
}
async function redrawAssetsGenerate(call) {
  const assetId = str2(call.args.asset_id);
  if (!assetId) return err("\u9700\u8981 asset_id");
  const variantId = str2(call.args.variant_id);
  const p = readProject(call.cwd);
  const asset = p.assets.find((a) => a.id === assetId);
  if (!asset) return err(`\u8D44\u4EA7\u4E0D\u5B58\u5728\uFF1A${assetId}`);
  try {
    const job = startAssetGeneration(call.cwd, assetId, variantId);
    return ok(`\u5DF2\u63D0\u4EA4\u751F\u6210\u4EFB\u52A1\uFF1A${job.id}\uFF08${job.label}\uFF09\u3002\u7528 redraw_job_status \u8F6E\u8BE2\uFF1B\u5B8C\u6210\u540E\u56FE\u7247\u8DEF\u5F84\u4F1A\u5199\u5165\u9879\u76EE\u3002`);
  } catch (e) {
    return err(e.message);
  }
}
async function redrawBoardsPlan(call) {
  const boardType = str2(call.args.board_type);
  const gridMode = str2(call.args.grid_mode);
  if (boardType && !["single", "firstLast", "grid"].includes(boardType)) return err("board_type \u53D6 single/firstLast/grid");
  if (gridMode && !["multiShot", "subPanels"].includes(gridMode)) return err("grid_mode \u53D6 multiShot/subPanels");
  mutateProject(call.cwd, (p) => {
    if (boardType) p.pipeline.globalPrefs.boardType = boardType;
    if (gridMode) p.pipeline.globalPrefs.gridMode = gridMode;
  });
  return ok(`\u5DF2\u8BB0\u5F55\u5206\u955C\u56FE\u504F\u597D\uFF1A\u7C7B\u578B=${boardType ?? "\uFF08\u6CBF\u7528\uFF09"}\uFF0C\u5BAB\u683C=${gridMode ?? "\uFF08\u6CBF\u7528\uFF09"}\u3002\u540E\u7EED\u6CBF\u7528\u8BE5\u504F\u597D\u3002`);
}
async function redrawBoardsGenerate(call) {
  const shotId = str2(call.args.shot_id);
  const p = readProject(call.cwd);
  const prefs = p.pipeline.globalPrefs;
  const kind = str2(call.args.kind) ?? prefs.boardType ?? "single";
  const gridMode = str2(call.args.grid_mode) ?? prefs.gridMode ?? "multiShot";
  const targets = shotId ? [shotId] : p.shots.map((s) => s.id);
  if (targets.length === 0) return err("\u6CA1\u6709\u955C\u5934\u53EF\u751F\u6210\u5206\u955C\u56FE\u3002");
  const jobIds = [];
  try {
    for (const id of targets) {
      const job = startBoardGeneration(call.cwd, id, { kind, gridMode, panels: num2(call.args.panels) });
      jobIds.push(job.id);
    }
  } catch (e) {
    return err(e.message);
  }
  setStep(call.cwd, "generate", "active");
  return ok(`\u5DF2\u63D0\u4EA4 ${jobIds.length} \u4E2A\u5206\u955C\u56FE\u4EFB\u52A1\uFF08\u7C7B\u578B ${kind}${kind === "grid" ? "/" + gridMode : ""}\uFF09\uFF1A${jobIds.join(", ")}\u3002\u7528 redraw_job_status \u8F6E\u8BE2\u3002`);
}
async function redrawVideoGenerate(call) {
  const shotId = str2(call.args.shot_id);
  if (!shotId) return err("\u9700\u8981 shot_id");
  const p = readProject(call.cwd);
  const seconds = num2(call.args.duration_sec);
  if (seconds !== void 0) mutateProject(call.cwd, (proj) => {
    proj.pipeline.globalPrefs.videoSeconds = seconds;
  });
  try {
    const job = startVideoGeneration(call.cwd, shotId, {
      ...str2(call.args.prompt) ? { prompt: str2(call.args.prompt) } : {},
      ...seconds !== void 0 ? { durationSec: seconds } : {},
      ...str2(call.args.resolution) ? { resolution: str2(call.args.resolution) } : {},
      ...str2(call.args.vendor_id) ? { vendorId: str2(call.args.vendor_id) } : {},
      ...str2(call.args.model_name) ? { modelName: str2(call.args.model_name) } : {}
    });
    return ok(`\u5DF2\u63D0\u4EA4\u89C6\u9891\u751F\u6210\u4EFB\u52A1\uFF1A${job.id}\uFF08\u955C\u5934 ${shotId}\uFF09\u3002\u9010\u6BB5\u8F93\u51FA\uFF0C\u4E0D\u62FC\u63A5\u3002\u7528 redraw_job_status \u8F6E\u8BE2\u3002`);
  } catch (e) {
    return err(e.message);
  }
}
async function redrawJobStatus(call) {
  const id = str2(call.args.job_id);
  if (id) {
    const job = getJob(id);
    if (!job) return err(`\u4EFB\u52A1\u4E0D\u5B58\u5728\uFF1A${id}`);
    return ok(
      `\u4EFB\u52A1 ${job.id}\uFF08${job.kind}\uFF0C${job.label}\uFF09\uFF1A${job.status} ${Math.round(job.progress * 100)}%
${job.message}` + (job.error ? `
\u9519\u8BEF\uFF1A${job.error}` : "") + (job.result ? `
\u4EA7\u51FA\uFF1A
${job.result.paths.map((p) => "  " + absPath(call.cwd, p)).join("\n")}` : "")
    );
  }
  const jobs2 = listJobs(call.cwd);
  if (jobs2.length === 0) return ok("\u5F53\u524D\u6CA1\u6709\u4EFB\u52A1\u3002");
  const lines = jobs2.slice(0, 20).map((j) => `- ${j.id} ${j.kind} ${j.status} ${Math.round(j.progress * 100)}% ${j.message}`);
  return ok(`\u4EFB\u52A1\uFF08\u6700\u8FD1 ${lines.length} \u4E2A\uFF09\uFF1A
${lines.join("\n")}`);
}
async function redrawJobCancel(call) {
  const id = str2(call.args.job_id);
  if (!id) return err("\u9700\u8981 job_id");
  return cancelJob(id) ? ok(`\u5DF2\u53D6\u6D88\u4EFB\u52A1 ${id}\u3002`) : err(`\u65E0\u6CD5\u53D6\u6D88\uFF1A\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u7ED3\u675F\uFF08${id}\uFF09\u3002`);
}
function tool(name, description, input_schema, execute, opts = {}) {
  return {
    definition: { name, description, input_schema },
    pathParams: opts.pathParams ?? {},
    requiresApproval: () => false,
    isConcurrencySafe: () => opts.concurrencySafe === true,
    isEnabled: () => true,
    execute
  };
}
var tools = [
  // 通用
  tool("redraw_open", "\u542F\u52A8/\u590D\u7528\u672C\u5DE5\u4F5C\u533A\u7684\u672C\u5730\u753B\u5E03\u670D\u52A1\u5E76\u8FD4\u56DE\u6D4F\u89C8\u5668 URL\uFF08127.0.0.1\uFF09\u3002**\u7B2C\u4E00\u6B65\u6C38\u8FDC\u5148\u8C03\u7528\u5B83\u3002**", {
    type: "object",
    properties: { port: { type: "integer", description: "\u53EF\u9009\u9996\u9009\u7AEF\u53E3\uFF1B0=\u81EA\u52A8\u5206\u914D\uFF08\u9ED8\u8BA4 43187\uFF09" } },
    required: []
  }, redrawOpen, { concurrencySafe: true }),
  tool("redraw_get_state", "\u8BFB\u53D6\u6574\u4F53\u72B6\u6001\uFF1A\u6D41\u7A0B\u8FDB\u5EA6\u4E0E\u95E8\u63A7\u3001\u8BA1\u6570\u3001\u98CE\u683C\u3001\u672C\u571F\u5316\u3001\u7D20\u6750\u3001\u6D3B\u8DC3\u4EFB\u52A1\u3001\u5F53\u524D\u9009\u4E2D\u3001\u753B\u5E03 URL\u3002\u4FEE\u6539\u4EFB\u4F55\u4E1C\u897F\u524D\u5148\u8C03\u7528\u3002", {
    type: "object",
    properties: {},
    required: []
  }, redrawGetState, { concurrencySafe: true }),
  tool("redraw_config_get", "\u8BFB\u53D6\u5DE5\u4F5C\u533A\u914D\u7F6E\uFF08\u5BC6\u94A5\u8131\u654F\uFF09\u4E0E\u5DE5\u4F5C\u533A\u9002\u914D\u6587\u4EF6\u5217\u8868\u3002", {
    type: "object",
    properties: {},
    required: []
  }, redrawConfigGet, { concurrencySafe: true }),
  tool("redraw_config_set", "\u5199\u5165\u914D\u7F6E\uFF1A\u542F\u7528\u56FE\u50CF/\u89C6\u9891\u4F9B\u5E94\u5546\u4E0E\u6A21\u578B\uFF08image_vendor/image_model/video_vendor/video_model\uFF09\u3001\u8BBE\u7F6E\u67D0 vendor \u7684 input_values \u4E0E trusted\u3002", {
    type: "object",
    properties: {
      image_vendor: { type: "string" },
      image_model: { type: "string" },
      video_vendor: { type: "string" },
      video_model: { type: "string" },
      vendor_id: { type: "string", description: "\u8981\u5199\u5165 input_values \u7684 vendor id" },
      input_values: { type: "object", description: "\u5982 {apiKey, baseUrl}" },
      trusted: { type: "boolean", description: "\u662F\u5426\u4FE1\u4EFB\u8BE5 vendor \u7684\u4EE3\u7801\uFF08\u9700 true \u624D\u5141\u8BB8\u6267\u884C\uFF09" }
    },
    required: []
  }, redrawConfigSet),
  tool("redraw_vendor_list", "\u5217\u51FA\u5DE5\u4F5C\u533A vendors/*.ts \u9002\u914D\u6587\u4EF6\u53CA\u5176\u56FE\u50CF/\u89C6\u9891\u6A21\u578B\u4E0E\u4FE1\u4EFB\u72B6\u6001\u3002", {
    type: "object",
    properties: {},
    required: []
  }, redrawVendorList, { concurrencySafe: true }),
  tool("redraw_vendor_validate", "\u6821\u9A8C\u4E00\u4E2A vendor \u9002\u914D\u6587\u4EF6\u80FD\u5426\u52A0\u8F7D\uFF08\u53BB\u7C7B\u578B + \u5B50\u8FDB\u7A0B\u6267\u884C + vendor \u5F62\u72B6\uFF09\u3002", {
    type: "object",
    properties: { vendor_id: { type: "string" } },
    required: ["vendor_id"]
  }, redrawVendorValidate, { concurrencySafe: true }),
  tool("redraw_style_list", "\u5217\u51FA\u5185\u7F6E + \u5DE5\u4F5C\u533A\u81EA\u5B9A\u4E49\u8F6C\u7ED8\u98CE\u683C\u3002", {
    type: "object",
    properties: {},
    required: []
  }, redrawStyleList, { concurrencySafe: true }),
  tool("redraw_style_set", "\u9501\u5B9A\u9879\u76EE\u7EA7\u8F6C\u7ED8\u98CE\u683C\uFF08\u5176\u63D0\u793A\u8BCD\u7247\u6BB5\u4F1A\u62FC\u8FDB\u6240\u6709\u751F\u6210\u63D0\u793A\u8BCD\uFF09\u3002", {
    type: "object",
    properties: { style_id: { type: "string" } },
    required: ["style_id"]
  }, redrawStyleSet),
  // 步骤 1
  tool("redraw_frames_ingest", "\u63A5\u6536\u7D20\u6750\uFF1A\u672C\u5730\u89C6\u9891\u6587\u4EF6\u8DEF\u5F84\uFF08video_path\uFF09\u6216\u7EAF\u6587\u672C\u5267\u60C5\uFF08story\uFF09\u3002\u89C6\u9891\u4F1A\u590D\u5236\u8FDB\u5DE5\u4F5C\u533A\u3002", {
    type: "object",
    properties: { video_path: { type: "string", description: "\u672C\u5730\u89C6\u9891\u6587\u4EF6\u8DEF\u5F84" }, story: { type: "string", description: "\u7EAF\u6587\u672C\u5267\u60C5\uFF08\u65E0\u89C6\u9891\u65F6\uFF09" } },
    required: []
  }, redrawFramesIngest, { pathParams: { video_path: "read" } }),
  tool("redraw_frames_extract", "\u63D0\u4EA4\u62BD\u5E27\u8BF7\u6C42\uFF08\u56FA\u5B9A\u95F4\u9694\uFF09\u3002**\u62BD\u5E27\u5728\u6D4F\u89C8\u5668\u5185\u7528 ffmpeg.wasm \u6267\u884C**\uFF0C\u9700\u7528\u6237\u6253\u5F00\u753B\u5E03\u3002", {
    type: "object",
    properties: { interval_sec: { type: "number", description: "\u62BD\u5E27\u95F4\u9694\u79D2\uFF08\u9ED8\u8BA4 2\uFF09" } },
    required: []
  }, redrawFramesExtract),
  tool("redraw_frames_list", "\u5217\u51FA\u62BD\u5E27\u7ED3\u679C\u8DEF\u5F84\u4E0E\u5BAB\u683C\u603B\u89C8\u56FE\u8DEF\u5F84\u3002**\u4F60\u65E0\u6CD5\u76F4\u63A5\u770B\u5230\u56FE\u50CF**\uFF0C\u8BF7\u8BA9\u7528\u6237\u67E5\u770B\u3002", {
    type: "object",
    properties: {},
    required: []
  }, redrawFramesList, { concurrencySafe: true }),
  // 步骤 2
  tool("redraw_localize_set", "\u8BB0\u5F55\u76EE\u6807\u5730\u533A\u4E0E\u7ED3\u6784\u5316\u672C\u571F\u5316\u62A5\u544A\uFF08\u670D\u9970/\u5EFA\u7B51/\u8282\u65E5/\u7981\u5FCC/\u8272\u5F69\u504F\u597D\uFF09\u3002", {
    type: "object",
    properties: {
      region: { type: "string" },
      template_id: { type: "string" },
      checklist: { type: "object", properties: { costume: { type: "string" }, architecture: { type: "string" }, festival: { type: "string" }, taboos: { type: "string" }, colorPreference: { type: "string" }, notes: { type: "string" } } }
    },
    required: ["region"]
  }, redrawLocalizeSet),
  tool("redraw_localize_get", "\u8BFB\u53D6\u5F53\u524D\u672C\u571F\u5316\u62A5\u544A\u3002", { type: "object", properties: {}, required: [] }, redrawLocalizeGet, { concurrencySafe: true }),
  // 步骤 3
  tool("redraw_script_upsert", "\u5199\u5165/\u4FEE\u8BA2\u5267\u672C\u8349\u7A3F\uFF08episodes \u6570\u7EC4\uFF09\u3002\u5199\u5B8C\u540E\u5FC5\u987B**\u505C\u4E0B\u95EE\u7528\u6237\u786E\u8BA4**\u3002", {
    type: "object",
    properties: {
      episodes: { type: "array", items: { type: "object", properties: { title: { type: "string" }, logline: { type: "string" }, synopsis: { type: "string" }, scenes: { type: "array", items: { type: "object" } } } } },
      revise: { type: "boolean", description: "true=\u6309\u96C6\u53F7\u5408\u5E76\u4FEE\u8BA2\uFF0Cfalse=\u6574\u4F53\u66FF\u6362" }
    },
    required: ["episodes"]
  }, redrawScriptUpsert),
  tool("redraw_script_get", "\u8BFB\u53D6\u5F53\u524D\u5267\u672C\u3002", { type: "object", properties: {}, required: [] }, redrawScriptGet, { concurrencySafe: true }),
  tool("redraw_script_approve", "\u6279\u51C6\u5267\u672C\uFF08\u9700\u7528\u6237\u5DF2\u786E\u8BA4\uFF09\u3002", {
    type: "object",
    properties: { answer: { type: "string" } },
    required: []
  }, redrawScriptApprove),
  // 步骤 4
  tool("redraw_shotlist_upsert", "\u5199\u5165/\u4FEE\u8BA2\u5206\u955C\u8868\uFF08shots \u6570\u7EC4\uFF0C\u6807\u51C6\u5168\u5957\u5B57\u6BB5\uFF09\u3002\u5199\u5B8C\u540E\u5FC5\u987B**\u505C\u4E0B\u95EE\u7528\u6237\u786E\u8BA4**\u3002", {
    type: "object",
    properties: {
      shots: { type: "array", items: { type: "object", properties: { index: { type: "number" }, durationSec: { type: "number" }, shotSize: { type: "string" }, cameraMove: { type: "string" }, scene: { type: "string" }, characters: { type: "array", items: { type: "string" } }, props: { type: "array", items: { type: "string" } }, description: { type: "string" }, dialogue: { type: "string" }, voiceover: { type: "string" }, emotion: { type: "string" } } } },
      episode_id: { type: "string" },
      revise: { type: "boolean" }
    },
    required: ["shots"]
  }, redrawShotlistUpsert),
  tool("redraw_shotlist_get", "\u8BFB\u53D6\u5F53\u524D\u5206\u955C\u8868\u3002", { type: "object", properties: {}, required: [] }, redrawShotlistGet, { concurrencySafe: true }),
  tool("redraw_shotlist_approve", "\u6279\u51C6\u5206\u955C\u8868\uFF08\u9700\u7528\u6237\u5DF2\u786E\u8BA4\uFF09\u3002", {
    type: "object",
    properties: { answer: { type: "string" } },
    required: []
  }, redrawShotlistApprove),
  // 步骤 5
  tool("redraw_assets_upsert", "\u5199\u5165\u8D44\u4EA7\uFF08\u4EBA\u7269/\u9053\u5177/\u573A\u666F\uFF09\u7684\u6587\u5B57\u8BBE\u5B9A\u4E0E\u63D0\u793A\u8BCD\uFF0C\u53CA\u884D\u751F\u53D8\u4F53\u3002**\u5148\u6587\u5B57\u540E\u751F\u6210\u56FE**\u3002", {
    type: "object",
    properties: {
      assets: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["character", "prop", "scene"] }, name: { type: "string" }, spec: { type: "string" }, prompt: { type: "string" }, variants: { type: "array", items: { type: "object", properties: { name: { type: "string" }, prompt: { type: "string" } } } } } } }
    },
    required: ["assets"]
  }, redrawAssetsUpsert),
  tool("redraw_assets_list", "\u5217\u51FA\u8D44\u4EA7\u3001\u53D8\u4F53\u53CA\u5176\u56FE\u7247\u8DEF\u5F84\u3002", { type: "object", properties: {}, required: [] }, redrawAssetsList, { concurrencySafe: true }),
  tool("redraw_assets_generate", "\u751F\u6210\u8D44\u4EA7\u56FE\uFF1Akind=base\uFF08\u57FA\u7840\u56FE\uFF09\u6216 kind=variant\uFF08\u53D8\u4F53\uFF0C\u7528\u57FA\u7840\u56FE\u4F5C\u53C2\u8003\uFF09\u3002", {
    type: "object",
    properties: { asset_id: { type: "string" }, variant_id: { type: "string", description: "kind=variant \u65F6\u5FC5\u586B" } },
    required: ["asset_id"]
  }, redrawAssetsGenerate),
  // 步骤 6
  tool("redraw_boards_plan", "\u8BB0\u5F55\u5206\u955C\u56FE\u504F\u597D\uFF08\u7C7B\u578B single/firstLast/grid\uFF1B\u5BAB\u683C multiShot/subPanels\uFF09\uFF0C\u540E\u7EED\u6CBF\u7528\u3002", {
    type: "object",
    properties: { board_type: { type: "string", enum: ["single", "firstLast", "grid"] }, grid_mode: { type: "string", enum: ["multiShot", "subPanels"] } },
    required: []
  }, redrawBoardsPlan),
  tool("redraw_boards_generate", "\u751F\u6210\u5206\u955C\u56FE\uFF08\u7701\u7565 shot_id \u5219\u5BF9\u5168\u90E8\u955C\u5934\uFF09\u3002\u7C7B\u578B/\u5BAB\u683C\u6CBF\u7528\u504F\u597D\u6216\u672C\u6B21\u6307\u5B9A\u3002", {
    type: "object",
    properties: {
      shot_id: { type: "string" },
      kind: { type: "string", enum: ["single", "firstLast", "grid"] },
      grid_mode: { type: "string", enum: ["multiShot", "subPanels"] },
      panels: { type: "number", description: "subPanels \u5206\u683C\u6570" }
    },
    required: []
  }, redrawBoardsGenerate),
  tool("redraw_video_generate", "\u4E3A\u4E00\u4E2A\u955C\u5934\u751F\u6210\u4E00\u6BB5\u89C6\u9891\uFF08\u9010\u6BB5\uFF0C\u4E0D\u62FC\u63A5\uFF09\u3002\u53EF\u6307\u5B9A\u79D2\u6570/\u5206\u8FA8\u7387/\u4F9B\u5E94\u5546/\u6A21\u578B\u3002", {
    type: "object",
    properties: {
      shot_id: { type: "string" },
      prompt: { type: "string" },
      duration_sec: { type: "number" },
      resolution: { type: "string" },
      vendor_id: { type: "string" },
      model_name: { type: "string" }
    },
    required: ["shot_id"]
  }, redrawVideoGenerate),
  tool("redraw_job_status", "\u67E5\u8BE2\u4EFB\u52A1\u72B6\u6001\u4E0E\u4EA7\u51FA\u8DEF\u5F84\uFF08\u6307\u5B9A job_id \u6216\u5217\u51FA\u5168\u90E8\uFF09\u3002", {
    type: "object",
    properties: { job_id: { type: "string" } },
    required: []
  }, redrawJobStatus, { concurrencySafe: true }),
  tool("redraw_job_cancel", "\u53D6\u6D88\u4E00\u4E2A\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\u3002", {
    type: "object",
    properties: { job_id: { type: "string" } },
    required: ["job_id"]
  }, redrawJobCancel),
  tool("redraw_add_edge", "\u5728\u753B\u5E03\u4E0A\u4E3A\u4E24\u4E2A\u8282\u70B9\uFF08\u955C\u5934/\u8D44\u4EA7/\u5206\u955C\uFF09\u8FDE\u7EBF\u3002", {
    type: "object",
    properties: { source: { type: "string" }, target: { type: "string" }, label: { type: "string" } },
    required: ["source", "target"]
  }, async (call) => {
    const s = str2(call.args.source);
    const t = str2(call.args.target);
    if (!s || !t) return err("\u9700\u8981 source \u4E0E target");
    try {
      const edge = addEdge(call.cwd, s, t, str2(call.args.label));
      return ok(`\u5DF2\u8FDE\u7EBF ${edge.source} \u2192 ${edge.target}`);
    } catch (e) {
      return err(e.message);
    }
  })
];

// src/lifecycle.ts
import { existsSync as existsSync7, writeFileSync as writeFileSync4 } from "node:fs";
var TRIGGER_RE = /转绘|短剧|分镜|镜头|抽帧|redraw|storyboard|drama/i;
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function buildStateBlock(cwd) {
  const p = readProject(cwd);
  const jobs2 = activeJobs(cwd);
  const gate = pendingGate(p);
  const sel = readSelection(cwd);
  const cfg = redactConfig(readConfig(cwd));
  const lines = ["<tianshu-redraw-state>"];
  lines.push(`  <project exists="true" step="${p.pipeline.currentStep}" title="${esc(p.meta.title)}" />`);
  lines.push("  <pipeline>");
  for (const id of STEP_IDS) {
    const s = p.pipeline.steps[id];
    const gateAttr = s.gate ? ` gate="${s.gate.answered ? "answered" : s.gate.asked ? "pending" : "unasked"}"` : "";
    lines.push(`    <step id="${id}" status="${s.status}"${gateAttr} />`);
  }
  lines.push("  </pipeline>");
  if (gate) lines.push(`  <gate pending="true" step="${gate.step}" question="${esc(gate.question ?? "\u7B49\u5F85\u7528\u6237\u786E\u8BA4")}" />`);
  lines.push(
    `  <counts frames="${p.frames.length}" shots="${p.shots.length}" assets="${p.assets.length}" boards="${p.boards.length}" videos="${p.videos.length}" />`
  );
  if (jobs2.length) {
    const j = jobs2[0];
    lines.push(`  <jobs active="${jobs2.length}" latest="${j.id}" kind="${j.kind}" status="${j.status}" progress="${j.progress.toFixed(2)}" />`);
  }
  const prefs = p.pipeline.globalPrefs;
  const prefParts = [];
  if (prefs.boardType) prefParts.push(`boardType="${prefs.boardType}"`);
  if (prefs.gridMode) prefParts.push(`gridMode="${prefs.gridMode}"`);
  if (prefs.videoModel) prefParts.push(`videoModel="${esc(prefs.videoModel.modelName)}"`);
  if (prefs.videoSeconds) prefParts.push(`videoSeconds="${prefs.videoSeconds}"`);
  if (prefParts.length) lines.push(`  <prefs ${prefParts.join(" ")} />`);
  if (p.style.styleId) lines.push(`  <style id="${p.style.styleId}" />`);
  if (cfg.active.image) lines.push(`  <imageModel vendor="${cfg.active.image.vendorId}" model="${cfg.active.image.modelName}" />`);
  if (cfg.active.video) lines.push(`  <videoModel vendor="${cfg.active.video.vendorId}" model="${cfg.active.video.modelName}" />`);
  if (sel && sel.kind !== "none") lines.push(`  <selection kind="${sel.kind}" id="${sel.id ?? ""}" />`);
  if (p.source.mode === "video" && p.source.videoPath) lines.push(`  <source mode="video" videoPath="${esc(p.source.videoPath)}" />`);
  else if (p.source.story) lines.push(`  <source mode="story" />`);
  lines.push("</tianshu-redraw-state>");
  return lines.join("\n");
}
function minimalBlock() {
  return [
    "<tianshu-redraw-state>",
    '  <project exists="false" />',
    "  <hint>\u5C1A\u65E0\u9879\u76EE\u3002\u7B2C\u4E00\u6B65\u8C03\u7528 redraw_open \u62FF\u5230\u753B\u5E03\u94FE\u63A5\u5E76\u5355\u72EC\u4E00\u884C\u53D1\u7ED9\u7528\u6237\uFF0C\u518D redraw_frames_ingest\u3002</hint>",
    "</tianshu-redraw-state>"
  ].join("\n");
}
function makeLifecycle(host) {
  return {
    turnStart(e) {
      const cwd = host.cwd;
      if (!cwd || !host.promptContext) return;
      try {
        const projectExists = existsSync7(`${cwd}/.tianshu-redraw/project.json`);
        const triggered = TRIGGER_RE.test(e.userInput ?? "");
        if (!projectExists && !triggered) {
          host.promptContext.setBlock(null);
          return;
        }
        host.promptContext.setBlock(projectExists ? buildStateBlock(cwd) : minimalBlock());
      } catch (err2) {
        host.log?.warn(`turnStart \u72B6\u6001\u5757\u6CE8\u5165\u5931\u8D25\uFF1A${err2.message}`);
      }
    },
    toolEnd() {
    },
    turnEnd() {
    },
    sessionEnd() {
      const cwd = host.cwd;
      if (!cwd) return;
      try {
        for (const j of listJobs(cwd)) {
          if (j.status === "running" || j.status === "queued") cancelJob(j.id);
        }
        const dir = host.storage?.dataDir();
        if (dir) {
          const snapshot = { at: Date.now(), jobs: listJobs(cwd).map((j) => ({ id: j.id, kind: j.kind, status: j.status })) };
          writeFileSync4(`${dir}/jobs-${Date.now()}.json`, JSON.stringify(snapshot, null, 2), "utf8");
        }
      } catch (err2) {
        host.log?.warn(`sessionEnd \u6536\u5C3E\u5931\u8D25\uFF1A${err2.message}`);
      }
    }
  };
}

// src/index.ts
var PLUGIN_ID = "tianshu-redraw";
var index_default = defineTianshuPlugin({
  id: PLUGIN_ID,
  activate(hostUnknown) {
    const host = hostUnknown ?? {};
    const lifecycleHost = {
      ...host.cwd ? { cwd: host.cwd } : {},
      ...host.promptContext ? { promptContext: host.promptContext } : {},
      ...host.storage ? { storage: host.storage } : {},
      ...host.log ? { log: host.log } : {}
    };
    const lifecycle = makeLifecycle(lifecycleHost);
    return {
      tools: tools.map((tool2) => ({
        name: tool2.definition.name,
        description: tool2.definition.description,
        inputSchema: tool2.definition.input_schema,
        concurrencySafe: tool2.isConcurrencySafe?.() === true,
        requiresApproval: tool2.requiresApproval?.() === true,
        pathParams: tool2.pathParams ?? {},
        execute: (call) => tool2.execute({ args: call.args, cwd: call.cwd, sessionId: call.sessionId ?? "default" })
      })),
      lifecycle: {
        turnStart: (e) => lifecycle.turnStart(e),
        toolEnd: (e) => lifecycle.toolEnd(e),
        turnEnd: (e) => lifecycle.turnEnd(e),
        sessionEnd: (e) => lifecycle.sessionEnd(e)
      },
      dispose() {
        disposeVendorSessions();
      }
    };
  }
});
export {
  VendorSession,
  buildStateBlock,
  cancelJob,
  checkVendorSource,
  createJob,
  index_default as default,
  disposeVendorSessions,
  getJob,
  listJobs,
  prepareVendorCode,
  resetJobsForTests,
  runJob,
  setConcurrency,
  tools
};
