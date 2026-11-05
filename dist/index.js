// src/tpi.ts
function defineTianshuPlugin(spec) {
  const sdk = globalThis.__tianshuTPI;
  if (!sdk) throw new Error("not running inside Tianshu: TPI plugins load only through the Tianshu host");
  return sdk.defineTianshuPlugin(spec);
}

// src/tools.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// src/aspect.ts
var SIZES = {
  portrait: { width: 405, height: 720 },
  landscape: { width: 720, height: 405 },
  square: { width: 540, height: 540 }
};
var DEFAULT_ASPECT = "portrait";
var ASPECTS = ["portrait", "landscape", "square", "free"];
function isAspectType(v) {
  return typeof v === "string" && ASPECTS.includes(v);
}
function resolveSize(aspect) {
  if (aspect === "free") return { ...SIZES.portrait };
  return { ...SIZES[aspect] };
}

// src/ids.ts
import { randomUUID } from "node:crypto";
var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var InvalidInputError = class extends Error {
};
function isSafeId(id) {
  return typeof id === "string" && ID_RE.test(id);
}
function assertSafeId(id) {
  if (!isSafeId(id)) throw new InvalidInputError(`invalid shot id: ${String(id)}`);
}
function newShotId() {
  return "shot-" + randomUUID().replace(/-/g, "").slice(0, 8);
}

// src/project.ts
import { EventEmitter } from "node:events";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var PROJECT_DIR_NAME = ".tianshu-redraw";
var projectEvents = new EventEmitter();
projectEvents.setMaxListeners(0);
function projectDir(cwd) {
  return join(cwd, PROJECT_DIR_NAME);
}
function projectFile(cwd) {
  return join(projectDir(cwd), "project.json");
}
function shotsDir(cwd) {
  return join(projectDir(cwd), "shots");
}
function emptyProject() {
  return { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, shots: [], edges: [] };
}
function inspectProject(cwd) {
  const file = projectFile(cwd);
  if (!existsSync(file)) return { project: emptyProject(), dropped: 0 };
  const raw = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { project: emptyProject(), problem: err.message, dropped: 0 };
  }
  const obj = parsed;
  if (!obj || !Array.isArray(obj.shots)) {
    return { project: emptyProject(), problem: "\u7F3A\u5C11 shots \u6570\u7EC4", dropped: 0 };
  }
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  const shots = obj.shots.filter(isShotNode);
  const edges = rawEdges.filter(isEdge);
  return {
    project: { version: 1, viewport: normalizeViewport(obj.viewport), shots, edges },
    dropped: obj.shots.length - shots.length + rawEdges.length - edges.length
  };
}
function readProject(cwd) {
  return inspectProject(cwd).project;
}
function projectIssue(cwd) {
  const { problem, dropped } = inspectProject(cwd);
  if (problem) {
    return `project.json \u5DF2\u635F\u574F\uFF08${problem}\uFF09\u3002\u753B\u5E03\u6682\u6309\u7A7A\u9879\u76EE\u663E\u793A\uFF0C\u539F\u6587\u4EF6\u672A\u6539\u52A8\uFF0C\u4FEE\u590D\u540E\u4F1A\u81EA\u52A8\u6062\u590D\uFF1B\u7EE7\u7EED\u5199\u5165\u524D\u4F1A\u5148\u5907\u4EFD\u4E3A project.json.corrupt-*\u3002`;
  }
  if (dropped > 0) {
    return `project.json \u4E2D\u6709 ${dropped} \u6761\u65E0\u6548\u7684\u955C\u5934\u6216\u8FDE\u7EBF\uFF0C\u8BFB\u53D6\u65F6\u5DF2\u5FFD\u7565\u3002\u539F\u6587\u4EF6\u672A\u6539\u52A8\uFF0C\u4E0B\u6B21\u5199\u5165\u524D\u4F1A\u5148\u5907\u4EFD\u4E3A project.json.corrupt-*\u3002`;
  }
  return null;
}
var pendingBackups = /* @__PURE__ */ new Map();
function takeProjectBackup(cwd) {
  const path = pendingBackups.get(cwd) ?? null;
  pendingBackups.delete(cwd);
  return path;
}
function backupDamagedProject(cwd) {
  const { problem, dropped } = inspectProject(cwd);
  if (!problem && dropped === 0) return;
  const file = projectFile(cwd);
  const stamp = Date.now();
  for (let n = 0; n < 1e3; n++) {
    const dest = n === 0 ? `${file}.corrupt-${stamp}` : `${file}.corrupt-${stamp}-${n}`;
    try {
      copyFileSync(file, dest, constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    pendingBackups.set(cwd, dest);
    console.error(`[tianshu-redraw] project.json \u5DF2\u635F\u574F\u6216\u542B\u65E0\u6548\u6761\u76EE\uFF0C\u8986\u76D6\u524D\u5DF2\u5907\u4EFD\u5230 ${dest}`);
    return;
  }
  throw new Error(`\u65E0\u6CD5\u5907\u4EFD\u635F\u574F\u7684\u9879\u76EE\u6587\u4EF6\uFF1A${file}`);
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
function isShotNode(n) {
  if (!n || typeof n !== "object") return false;
  const o = n;
  return typeof o.id === "string" && isSafeId(o.id) && o.type === "shot";
}
function isEdge(e) {
  if (!e || typeof e !== "object") return false;
  const o = e;
  return typeof o.id === "string" && typeof o.source === "string" && typeof o.target === "string";
}
function writeProjectAtomic(cwd, project) {
  mkdirSync(shotsDir(cwd), { recursive: true });
  backupDamagedProject(cwd);
  const file = projectFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(project, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  projectEvents.emit("change", { cwd });
}
function writeShotHtml(cwd, id, html) {
  assertSafeId(id);
  mkdirSync(shotsDir(cwd), { recursive: true });
  const rel = join(PROJECT_DIR_NAME, "shots", `${id}.html`);
  const abs = join(cwd, rel);
  const tmp = abs + ".tmp";
  writeFileSync(tmp, html, "utf8");
  renameSync(tmp, abs);
  return rel;
}
function readShotHtml(cwd, id) {
  if (!isSafeId(id)) return null;
  const abs = join(shotsDir(cwd), `${id}.html`);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}
function upsertShot(cwd, shot) {
  const project = readProject(cwd);
  const idx = project.shots.findIndex((n) => n.id === shot.id);
  if (idx >= 0) {
    const prev = project.shots[idx];
    project.shots[idx] = { ...prev, ...shot, createdAt: prev.createdAt, updatedAt: Date.now() };
  } else {
    project.shots.push(shot);
  }
  writeProjectAtomic(cwd, project);
  return project;
}
function autoLayoutPosition(index, size) {
  const originX = 260;
  const originY = 90;
  const gapX = 120;
  const gapY = 160;
  const cols = 4;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: originX + col * (size.width + gapX),
    y: originY + row * (size.height + gapY)
  };
}
function setViewport(cwd, viewport) {
  const { project, problem, dropped } = inspectProject(cwd);
  if (problem || dropped > 0) return project;
  project.viewport = normalizeViewport(viewport);
  writeProjectAtomic(cwd, project);
  return project;
}
function nextLayoutIndex(cwd) {
  return readProject(cwd).shots.length;
}
function removeShot(cwd, id) {
  assertSafeId(id);
  const project = readProject(cwd);
  project.shots = project.shots.filter((n) => n.id !== id);
  project.edges = project.edges.filter((e) => e.source !== id && e.target !== id);
  writeProjectAtomic(cwd, project);
  try {
    rmSync(join(shotsDir(cwd), `${id}.html`), { force: true });
  } catch {
  }
  return project;
}
function renameShot(cwd, id, title) {
  assertSafeId(id);
  const project = readProject(cwd);
  const shot = project.shots.find((n) => n.id === id);
  if (!shot) throw new InvalidInputError(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${id}`);
  shot.title = title;
  shot.updatedAt = Date.now();
  writeProjectAtomic(cwd, project);
  return project;
}
function moveShot(cwd, id, x, y) {
  assertSafeId(id);
  const project = readProject(cwd);
  const shot = project.shots.find((n) => n.id === id);
  if (!shot) throw new InvalidInputError(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${id}`);
  shot.x = x;
  shot.y = y;
  shot.updatedAt = Date.now();
  writeProjectAtomic(cwd, project);
  return project;
}
function duplicateShot(cwd, id, title) {
  assertSafeId(id);
  const project = readProject(cwd);
  const src = project.shots.find((n) => n.id === id);
  if (!src) throw new InvalidInputError(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${id}`);
  const newId = newShotId();
  const html = readShotHtml(cwd, id) ?? "";
  const rel = writeShotHtml(cwd, newId, html);
  const now = Date.now();
  const shot = {
    ...src,
    id: newId,
    title: title ?? `${src.title} \u526F\u672C`,
    x: src.x + 40,
    y: src.y + 40,
    contentPath: rel,
    createdAt: now,
    updatedAt: now
  };
  project.shots.push(shot);
  writeProjectAtomic(cwd, project);
  return shot;
}
function assertEdgeEnds(source, target) {
  assertSafeId(source);
  assertSafeId(target);
  if (source === target) throw new InvalidInputError(`\u4E0D\u80FD\u5C06\u955C\u5934\u8FDE\u63A5\u5230\u81EA\u8EAB\uFF1A${source}`);
}
function assertEdgeNodes(project, source, target) {
  if (!project.shots.some((n) => n.id === source)) throw new InvalidInputError(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${source}`);
  if (!project.shots.some((n) => n.id === target)) throw new InvalidInputError(`\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${target}`);
}
function addEdge(cwd, source, target, label) {
  assertEdgeEnds(source, target);
  const project = readProject(cwd);
  assertEdgeNodes(project, source, target);
  const exists = project.edges.find((e) => e.source === source && e.target === target);
  if (exists) {
    if (label !== void 0 && exists.label !== label) {
      exists.label = label;
      writeProjectAtomic(cwd, project);
    }
    return exists;
  }
  const edge = { id: `edge-${source}-${target}`, source, target, ...label ? { label } : {} };
  project.edges.push(edge);
  writeProjectAtomic(cwd, project);
  return edge;
}
function removeEdge(cwd, source, target) {
  const project = readProject(cwd);
  const edges = project.edges.filter((e) => !(e.source === source && e.target === target));
  if (edges.length === project.edges.length) return project;
  project.edges = edges;
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
    if (!parsed || typeof parsed.shotId !== "string") return null;
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

// src/server.ts
import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var WEB_DIR = fileURLToPath(new URL("./web/", import.meta.url));
var DEFAULT_PORT = 43187;
var MUTATION_HEADER = "x-tianshu-redraw";
var MAX_BODY = 4 * 1024 * 1024;
var MAX_VIEWPORT_BODY = 4096;
var BODY_DRAIN_MS = 2e3;
var state = null;
function tokenFor(cwd) {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
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
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
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
    projectEvents.on("change", ({ cwd: changed }) => {
      broadcast(created, tokenFor(changed), "project");
    });
    projectEvents.on("selection", ({ cwd: changed }) => {
      broadcast(created, tokenFor(changed), "selection");
    });
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
  "canvas.js.map": "application/json; charset=utf-8"
};
function handleRequest(req, res) {
  try {
    routeRequest(req, res);
  } catch (err) {
    console.error("[tianshu-redraw] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A", err);
    if (res.headersSent) res.destroy();
    else send(res, 500, "text/plain; charset=utf-8", "internal error");
  }
}
function routeRequest(req, res) {
  const host = req.headers.host;
  if (!host || !isLocalHost(host)) {
    return send(res, 403, "text/plain; charset=utf-8", "forbidden host");
  }
  let url;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "bad request");
  }
  const path = url.pathname;
  if (req.method === "GET" && path === "/healthz") {
    return send(res, 200, "text/plain; charset=utf-8", "ok");
  }
  if (req.method === "GET" && path === "/") {
    return serveStatic(res, "index.html");
  }
  if (req.method === "GET" && path.startsWith("/assets/")) {
    const name = path.slice("/assets/".length);
    if (name in ASSET_TYPES) return serveStatic(res, name, ASSET_TYPES[name]);
    return send(res, 404, "text/plain; charset=utf-8", "not found");
  }
  if (req.method === "GET" && path === "/api/project") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    const issue = projectIssue(cwd);
    return sendJson(res, { ...readProject(cwd), ...issue ? { issue } : {} });
  }
  if (req.method === "GET" && path === "/api/events") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    return handleSse(res, tokenFor(cwd));
  }
  if (req.method === "GET" && path.startsWith("/shot/")) {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    let id;
    try {
      id = decodeURIComponent(path.slice("/shot/".length));
    } catch (err) {
      if (err instanceof URIError) return send(res, 400, "text/plain; charset=utf-8", "bad shot id");
      throw err;
    }
    const html = readShotHtml(cwd, id);
    if (html === null) return send(res, 404, "text/plain; charset=utf-8", "shot not found");
    return sendUntrustedHtml(res, decorateShotHtml(html));
  }
  if (req.method === "GET" && path === "/api/selection") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, { selection: readSelection(cwd) });
  }
  if (req.method === "GET" && path === "/api/shot-html") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const html = readShotHtml(cwd, url.searchParams.get("id") ?? "");
    if (html === null) return send(res, 404, "text/plain; charset=utf-8", "shot not found");
    return send(res, 200, "text/plain; charset=utf-8", html);
  }
  if (req.method === "POST") {
    if (String(req.headers[MUTATION_HEADER] ?? "") !== "1") {
      return send(res, 403, "text/plain; charset=utf-8", "missing header");
    }
    if (path === "/api/viewport") return handleViewport(req, res);
    if (path === "/api/selection") return handleSelection(req, res);
    if (path === "/api/shots") return handleShots(req, res);
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
    } catch (err) {
      if (err instanceof InvalidInputError) {
        return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: err.message }));
      }
      console.error("[tianshu-redraw] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A", err);
      if (res.headersSent) res.destroy();
      else send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: "internal error" }));
    }
  });
}
function handleSelection(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const shotId = typeof body.shotId === "string" ? body.shotId : "";
    const kind = body.kind === "shot" ? "shot" : "element";
    if (!shotId) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing shotId" }));
    assertSafeId(shotId);
    const raw = body.payload;
    const selection = {
      shotId,
      kind,
      at: Date.now(),
      ...kind === "element" && raw ? {
        element: {
          xpath: String(raw.xpath ?? ""),
          tagName: String(raw.tagName ?? ""),
          textContent: typeof raw.textContent === "string" ? raw.textContent : void 0,
          computedStyles: raw.computedStyles && typeof raw.computedStyles === "object" ? raw.computedStyles : void 0
        }
      } : {}
    };
    writeSelection(cwd, selection);
    return sendJson(res, { ok: true });
  });
}
function handleShots(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    const id = typeof body.id === "string" ? body.id : "";
    if (op === "remove") {
      if (!id) throw new InvalidInputError("missing id");
      removeShot(cwd, id);
      return sendJson(res, { ok: true, id });
    }
    if (op === "rename") {
      if (!id || typeof body.title !== "string") throw new InvalidInputError("missing id or title");
      renameShot(cwd, id, body.title);
      return sendJson(res, { ok: true, id, title: body.title });
    }
    if (op === "move") {
      if (!id) throw new InvalidInputError("missing id");
      moveShot(cwd, id, Number(body.x) || 0, Number(body.y) || 0);
      return sendJson(res, { ok: true, id });
    }
    if (op === "duplicate") {
      if (!id) throw new InvalidInputError("missing id");
      const shot = duplicateShot(cwd, id, typeof body.title === "string" ? body.title : void 0);
      return sendJson(res, { ok: true, shot });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handleEdges(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    const source = typeof body.source === "string" ? body.source : "";
    const target = typeof body.target === "string" ? body.target : "";
    if (!source || !target) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing source or target" }));
    if (op === "add") {
      const edge = addEdge(cwd, source, target, typeof body.label === "string" ? body.label : void 0);
      return sendJson(res, { ok: true, edge });
    }
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
      const x = Number(body.x);
      const y = Number(body.y);
      const zoom = Number(body.zoom);
      setViewport(cwd, {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1
      });
      return sendJson(res, { ok: true });
    },
    MAX_VIEWPORT_BODY
  );
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
  const file = join2(WEB_DIR, name);
  if (!existsSync2(file)) return send(res, 404, "text/plain; charset=utf-8", "asset not built");
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  if (name === "index.html") {
    headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";
  }
  res.writeHead(200, headers);
  res.end(readFileSync2(file));
}
var SHOT_BASE_STYLE = '<style>html,body{margin:0;background:#0b0d10;color:#e6e8ec;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}</style>';
function decorateShotHtml(html) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${SHOT_BASE_STYLE}</head>`);
  const bodyOpen = html.match(/<body[^>]*>/i);
  if (bodyOpen) return html.replace(bodyOpen[0], `${bodyOpen[0]}${SHOT_BASE_STYLE}`);
  return SHOT_BASE_STYLE + html;
}
function sendUntrustedHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; font-src data:; connect-src 'none'; form-action 'none'"
  });
  res.end(html);
}
function sendJson(res, body) {
  send(res, 200, "application/json; charset=utf-8", JSON.stringify(body));
}
function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

// src/tools.ts
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function positive(v) {
  return v !== void 0 && v > 0 ? Math.round(v) : void 0;
}
function withBackupNotice(run) {
  return async (call) => {
    const result = await run(call);
    const backup = takeProjectBackup(call.cwd);
    if (!backup) return result;
    return { ...result, content: `${result.content}
\u6CE8\u610F\uFF1Aproject.json \u66FE\u635F\u574F\u6216\u542B\u65E0\u6548\u6761\u76EE\uFF0C\u8986\u76D6\u524D\u5DF2\u5907\u4EFD\u5230 ${backup}` };
  };
}
function projectHint(cwd) {
  return `${PROJECT_DIR_NAME}/\uFF08\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(cwd)}\uFF09`;
}
async function redrawOpen(call) {
  const port = num(call.args.port);
  const { url } = await ensureServer(call.cwd, port ?? void 0);
  writeUrlHint(call.cwd, url);
  if (call.args.open === true) openBrowser(url);
  return {
    content: `\u753B\u5E03\u670D\u52A1\u5DF2\u5C31\u7EEA\u3002\u8BF7\u7ACB\u523B\u628A\u4E0B\u9762\u8FD9\u4E00\u884C\u539F\u6837\u53D1\u7ED9\u7528\u6237\uFF08\u5355\u72EC\u4E00\u884C\uFF0C\u4FBF\u4E8E\u70B9\u51FB\uFF09\uFF1A
${url}
\u5728\u7528\u6237\u62FF\u5230\u94FE\u63A5\u540E\uFF0C\u518D\u5F00\u59CB\u5199\u5165\u5206\u955C\u955C\u5934\uFF08redraw_upsert_shot\uFF09\u3002
\u5DE5\u4F5C\u533A\uFF1A${call.cwd}
\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(call.cwd)}
\u64CD\u4F5C\u63D0\u793A\uFF1A\u7A7A\u683C+\u62D6\u62FD \u6216 \u4E2D\u952E\u62D6\u62FD \u5E73\u79FB\uFF1BCtrl+\u6EDA\u8F6E \u7F29\u653E\uFF1B\u666E\u901A\u6EDA\u8F6E \u5E73\u79FB\u3002`
  };
}
function writeUrlHint(cwd, url) {
  try {
    writeFileSync2(join3(cwd, PROJECT_DIR_NAME, "url.txt"), url + "\n", "utf8");
  } catch {
  }
}
function openBrowser(url) {
  try {
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
  }
}
async function redrawUpsertShot(call) {
  const args = call.args;
  const htmlPath = str(args.html_path);
  let html;
  if (htmlPath) {
    if (!existsSync3(htmlPath)) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A\u6587\u4EF6\u4E0D\u5B58\u5728 ${htmlPath}`, isError: true };
    }
    try {
      html = readFileSync3(htmlPath, "utf8");
    } catch (err) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A${err.message}`, isError: true };
    }
  } else {
    html = str(args.html);
  }
  const requestedId = str(args.id);
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `\u975E\u6CD5 id\uFF1A${requestedId}\uFF08\u4EC5\u5141\u8BB8\u5B57\u6BCD\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u3001\u8FDE\u5B57\u7B26\uFF0C1\u201364 \u4F4D\uFF09`, isError: true };
  }
  const project = readProject(call.cwd);
  const existing = requestedId ? project.shots.find((n) => n.id === requestedId) : void 0;
  if (!html && !existing) {
    return {
      content: "\u7F3A\u5C11\u5185\u5BB9\uFF1A\u8BF7\u63D0\u4F9B html_path\uFF08\u5DE5\u4F5C\u533A\u5185\u7684 HTML \u6587\u4EF6\uFF09\u6216 html\uFF08\u5185\u8054 HTML\uFF09\u3002\u4EC5\u66F4\u65B0\u5DF2\u6709\u955C\u5934\u7684\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8\u65F6\uFF0C\u9700\u4F20\u5DF2\u5B58\u5728\u7684 id\u3002",
      isError: true
    };
  }
  const id = requestedId ?? newShotId();
  const aspectProvided = isAspectType(args.aspect);
  const aspect = isAspectType(args.aspect) ? args.aspect : existing?.aspect ?? DEFAULT_ASPECT;
  const base = existing && !aspectProvided ? { width: existing.width, height: existing.height } : resolveSize(aspect);
  const size = {
    width: positive(num(args.width)) ?? base.width,
    height: positive(num(args.height)) ?? base.height
  };
  let x = num(args.x);
  let y = num(args.y);
  if (x === void 0 || y === void 0) {
    if (existing) {
      x = x ?? existing.x;
      y = y ?? existing.y;
    } else {
      const pos = autoLayoutPosition(nextLayoutIndex(call.cwd), size);
      x = x ?? pos.x;
      y = y ?? pos.y;
    }
  }
  const rel = html !== void 0 ? writeShotHtml(call.cwd, id, html) : existing?.contentPath ?? "";
  const now = Date.now();
  const shot = {
    id,
    type: "shot",
    title: str(args.title) ?? existing?.title ?? id,
    x,
    y,
    width: size.width,
    height: size.height,
    aspect,
    contentPath: rel,
    contentRev: html !== void 0 ? now : existing?.contentRev,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  upsertShot(call.cwd, shot);
  const { url } = await ensureServer(call.cwd);
  return {
    content: `${existing ? "\u5DF2\u66F4\u65B0" : "\u5DF2\u6DFB\u52A0"}\u955C\u5934\u8282\u70B9\u300C${shot.title}\u300D\uFF08id=${id}\uFF09\u3002
\u4F4D\u7F6E\uFF1Ax=${shot.x}, y=${shot.y}\uFF1B\u5C3A\u5BF8\uFF1A${shot.width}\xD7${shot.height}\uFF08${aspect}\uFF09
` + (html !== void 0 ? `\u5206\u955C\u6587\u4EF6\uFF1A${join3(call.cwd, rel)}
` : `\u5206\u955C\u5185\u5BB9\u672A\u6539\u52A8\uFF08\u4EC5\u66F4\u65B0\u4E86\u8282\u70B9\u4FE1\u606F\uFF09\u3002
`) + `\u753B\u5E03 URL\uFF1A${url}
\u9879\u76EE\uFF1A${projectHint(call.cwd)}`
  };
}
function formatSelection(selection, project) {
  const shot = project.shots.find((n) => n.id === selection.shotId);
  const shotTitle = shot ? shot.title : selection.shotId;
  const lines = [
    `\u9009\u4E2D\u7C7B\u578B\uFF1A${selection.kind === "element" ? "\u955C\u5934\u5185\u5143\u7D20" : "\u6574\u4E2A\u955C\u5934\u8282\u70B9"}`,
    `\u6240\u5C5E\u955C\u5934\uFF1A${shotTitle}\uFF08id=${selection.shotId}\uFF09`
  ];
  if (selection.kind === "element" && selection.element) {
    const el = selection.element;
    lines.push(`\u5143\u7D20\uFF1A<${el.tagName}> xpath=${el.xpath}`);
    if (el.textContent) lines.push(`\u6587\u672C\uFF1A${el.textContent}`);
    if (el.computedStyles) {
      const keys = ["color", "background-color", "font-size", "font-weight", "padding", "margin", "border-radius"];
      const picked = keys.filter((k) => el.computedStyles?.[k]).map((k) => `${k}: ${el.computedStyles?.[k]}`);
      if (picked.length) lines.push(`\u5173\u952E\u6837\u5F0F\uFF1A${picked.join("\uFF1B")}`);
    }
  }
  return lines;
}
async function redrawGetState(call) {
  const project = readProject(call.cwd);
  const selection = readSelection(call.cwd);
  const url = currentUrl(call.cwd);
  const sections = [];
  const issue = projectIssue(call.cwd);
  if (issue) sections.push(`\u8B66\u544A\uFF1A${issue}`);
  if (project.shots.length === 0) {
    sections.push("\u753B\u5E03\u4E0A\u6682\u65E0\u955C\u5934\u8282\u70B9\u3002\n\u7528 redraw_upsert_shot \u6DFB\u52A0\u4E00\u4E2A\u5206\u955C\u3002");
  } else {
    const lines = project.shots.map((n, i) => {
      return `${i + 1}. ${n.title} (id=${n.id})
   \u4F4D\u7F6E x=${n.x}, y=${n.y}\uFF1B\u5C3A\u5BF8 ${n.width}\xD7${n.height}\uFF08${n.aspect}\uFF09`;
    });
    sections.push(`\u753B\u5E03\u4E0A\u6709 ${project.shots.length} \u4E2A\u955C\u5934\u8282\u70B9\uFF1A
${lines.join("\n")}`);
  }
  if (project.edges.length > 0) {
    const titleOf = (id) => project.shots.find((n) => n.id === id)?.title ?? id;
    const lines = project.edges.map(
      (e) => `- ${titleOf(e.source)}\uFF08${e.source}\uFF09 \u2192 ${titleOf(e.target)}\uFF08${e.target}\uFF09${e.label ? `\uFF1A${e.label}` : ""}`
    );
    sections.push(`\u955C\u5934\u8FDE\u7EBF\uFF08${project.edges.length} \u6761\uFF09\uFF1A
${lines.join("\n")}`);
  }
  if (selection) {
    sections.push(`\u5F53\u524D\u9009\u4E2D\uFF1A
${formatSelection(selection, project).join("\n")}`);
  } else {
    sections.push(
      "\u5F53\u524D\u753B\u5E03\u6CA1\u6709\u9009\u4E2D\u9879\u3002\n\u8BF7\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u753B\u5E03\uFF0C\u70B9\u51FB\u67D0\u4E2A\u955C\u5934\u8282\u70B9\u540E\u518D\u8BD5\u3002"
    );
  }
  sections.push(url ? `\u753B\u5E03 URL\uFF1A${url}` : "\u63D0\u793A\uFF1A\u5148\u8C03\u7528 redraw_open \u83B7\u53D6\u753B\u5E03 URL\u3002");
  return { content: sections.join("\n\n") };
}
async function redrawArrange(call) {
  const action = str(call.args.action);
  switch (action) {
    case "remove": {
      const id = str(call.args.id);
      if (!id) return { content: "remove \u9700\u8981 id\u3002", isError: true };
      const project = readProject(call.cwd);
      if (!project.shots.some((n) => n.id === id)) return { content: `\u955C\u5934\u4E0D\u5B58\u5728\uFF1A${id}`, isError: true };
      const next = removeShot(call.cwd, id);
      return { content: `\u5DF2\u5220\u9664\u955C\u5934\u8282\u70B9 ${id}\uFF08\u8FDE\u5E26\u5176\u8FDE\u7EBF\u4E0E\u5206\u955C\u6587\u4EF6\uFF09\u3002\u5269\u4F59 ${next.shots.length} \u4E2A\u8282\u70B9\u3002` };
    }
    case "duplicate": {
      const id = str(call.args.id);
      if (!id) return { content: "duplicate \u9700\u8981 id\u3002", isError: true };
      try {
        const shot = duplicateShot(call.cwd, id, str(call.args.title));
        const { url } = await ensureServer(call.cwd);
        return {
          content: `\u5DF2\u590D\u5236\u955C\u5934\u8282\u70B9\uFF0C\u65B0 id=${shot.id}\uFF0C\u6807\u9898\u300C${shot.title}\u300D\u3002
\u4F4D\u7F6E\uFF1Ax=${shot.x}, y=${shot.y}
\u753B\u5E03 URL\uFF1A${url}`
        };
      } catch (err) {
        return { content: err.message, isError: true };
      }
    }
    case "link": {
      const source = str(call.args.source);
      const target = str(call.args.target);
      if (!source || !target) return { content: "link \u9700\u8981 source \u548C target\u3002", isError: true };
      try {
        const edge = addEdge(call.cwd, source, target, str(call.args.label));
        return { content: `\u5DF2\u8FDE\u7EBF ${edge.source} \u2192 ${edge.target}${edge.label ? `\uFF08${edge.label}\uFF09` : ""}\u3002` };
      } catch (err) {
        return { content: err.message, isError: true };
      }
    }
    case "unlink": {
      const source = str(call.args.source);
      const target = str(call.args.target);
      if (!source || !target) return { content: "unlink \u9700\u8981 source \u548C target\u3002", isError: true };
      const before = readProject(call.cwd).edges.length;
      const next = removeEdge(call.cwd, source, target);
      if (next.edges.length === before) return { content: `\u6CA1\u6709\u5339\u914D\u7684\u8FDE\u7EBF ${source} \u2192 ${target}\uFF0C\u672A\u4F5C\u6539\u52A8\u3002` };
      return { content: `\u5DF2\u53D6\u6D88\u8FDE\u7EBF ${source} \u2192 ${target}\u3002` };
    }
    default:
      return {
        content: `\u672A\u77E5\u6216\u7F3A\u5931\u7684 action\uFF1A${action ?? "(\u7A7A)"}\u3002\u53EF\u9009\uFF1Aremove / duplicate / link / unlink\u3002`,
        isError: true
      };
  }
}
var tools = [
  {
    definition: {
      name: "redraw_open",
      description: "\u542F\u52A8/\u590D\u7528\u672C\u5DE5\u4F5C\u533A\u7684\u672C\u5730\u753B\u5E03\u670D\u52A1\uFF0C\u8FD4\u56DE\u53EF\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u7684 URL\uFF08127.0.0.1\uFF09\u3002**\u8FD9\u662F\u8F6C\u7ED8\u77ED\u5267\u5DE5\u5382\u7684\u7B2C\u4E00\u6B65\uFF1A\u5148\u8C03\u7528\u672C\u5DE5\u5177\u628A\u753B\u5E03\u94FE\u63A5\u7ED9\u7528\u6237\uFF0C\u518D\u5F00\u59CB\u5199\u5165\u5206\u955C\u3002**",
      input_schema: {
        type: "object",
        properties: {
          port: { type: "integer", description: "\u53EF\u9009\u9996\u9009\u7AEF\u53E3\uFF1B0=\u81EA\u52A8\u5206\u914D\uFF08\u9ED8\u8BA4 43187\uFF0C\u88AB\u5360\u7528\u5219\u9012\u589E\uFF09" },
          open: { type: "boolean", description: "\u53EF\u9009\uFF1A\u5C1D\u8BD5\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u6D4F\u89C8\u5668\u6253\u5F00\uFF08\u9ED8\u8BA4 false\uFF09" }
        },
        required: []
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: redrawOpen
  },
  {
    definition: {
      name: "redraw_upsert_shot",
      description: "\u65B0\u589E\u6216\u66F4\u65B0\u753B\u5E03\u4E0A\u7684\u955C\u5934\u8282\u70B9\u3002\u4F18\u5148\u4F20 html\uFF08\u5185\u8054\uFF09\u5199\u5165\u5206\u955C\u5361\u5185\u5BB9\uFF08\u81EA\u52A8\u4FDD\u5B58\u5230 .tianshu-redraw/shots/\uFF0C\u65E0\u9700\u4E5F\u4E0D\u8981\u5728\u5DE5\u4F5C\u533A\u53E6\u5EFA\u6587\u4EF6\u5939\uFF09\uFF0Chtml_path \u4EC5\u7528\u4E8E\u5BFC\u5165\u5DF2\u6709\u6587\u4EF6\u3002\u5BF9\u5DF2\u6709 id \u53EF\u7701\u7565 html\uFF0C\u4EC5\u66F4\u65B0\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u753B\u5E45\uFF08\u5373\u91CD\u547D\u540D\u3001\u79FB\u52A8\u3001\u8C03\u6574\u5C3A\u5BF8\uFF0C\u672A\u6307\u5B9A\u7684\u5B57\u6BB5\u4FDD\u6301\u539F\u503C\uFF09\u3002\u8FD4\u56DE\u91CC\u4F1A\u5E26\u4E0A\u753B\u5E03 URL\uFF08\u82E5\u753B\u5E03\u670D\u52A1\u5C1A\u672A\u542F\u52A8\u4F1A\u81EA\u52A8\u542F\u52A8\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          html_path: { type: "string", description: "\u5DF2\u6709 HTML \u6587\u4EF6\u8DEF\u5F84\uFF08\u5DE5\u4F5C\u533A\u5185\uFF0C\u4F18\u5148\u4E8E html\uFF09\uFF1B\u4E00\u822C\u4E0D\u8981\u7528\uFF0C\u8BF7\u76F4\u63A5\u7528 html \u5185\u8054" },
          html: { type: "string", description: "\u5185\u8054 HTML\uFF08\u63A8\u8350\u65B9\u5F0F\uFF1A\u5206\u955C\u53EA\u5B58\u653E\u5728 .tianshu-redraw/shots/\uFF09\uFF1B\u66F4\u65B0\u5DF2\u6709\u955C\u5934\u7684\u5143\u6570\u636E\u65F6\u53EF\u7701\u7565" },
          title: { type: "string", description: "\u955C\u5934\u6807\u9898\uFF08\u5982\u300C\u7B2C1\u96C6 \xB7 \u955C\u593403\u300D\uFF09" },
          id: { type: "string", description: "\u955C\u5934 id\uFF08\u5B57\u6BCD\u6570\u5B57/_/-\uFF09\u3002\u7F3A\u7701\u5219\u65B0\u5EFA\u5E76\u81EA\u52A8\u751F\u6210\uFF1B\u4F20\u5DF2\u5B58\u5728\u7684 id \u5219\u66F4\u65B0\u8BE5\u955C\u5934" },
          x: { type: "number", description: "\u753B\u5E03 X \u5750\u6807\uFF08\u65B0\u5EFA\u7F3A\u7701\u6309\u7F51\u683C\u81EA\u52A8\u6392\u5E03\uFF1B\u66F4\u65B0\u7F3A\u7701\u4FDD\u6301\u539F\u4F4D\uFF09" },
          y: { type: "number", description: "\u753B\u5E03 Y \u5750\u6807\uFF08\u65B0\u5EFA\u7F3A\u7701\u6309\u7F51\u683C\u81EA\u52A8\u6392\u5E03\uFF1B\u66F4\u65B0\u7F3A\u7701\u4FDD\u6301\u539F\u4F4D\uFF09" },
          width: { type: "number", description: "\u903B\u8F91\u5BBD\u5EA6 px\uFF08\u8986\u76D6\u753B\u5E45\u9884\u8BBE\uFF09" },
          height: { type: "number", description: "\u903B\u8F91\u9AD8\u5EA6 px\uFF08\u8986\u76D6\u753B\u5E45\u9884\u8BBE\uFF09" },
          aspect: {
            type: "string",
            enum: ["portrait", "landscape", "square", "free"],
            description: "\u753B\u5E45\u9884\u8BBE\uFF08\u65B0\u5EFA\u9ED8\u8BA4 portrait \u7AD6\u5C4F 9:16\uFF1B\u66F4\u65B0\u7F3A\u7701\u4FDD\u6301\u539F\u753B\u5E45\u4E0E\u5C3A\u5BF8\uFF09"
          }
        },
        required: []
      }
    },
    pathParams: { html_path: "read" },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(redrawUpsertShot)
  },
  {
    definition: {
      name: "redraw_get_state",
      description: "\u8BFB\u53D6\u753B\u5E03\u5F53\u524D\u72B6\u6001\uFF1A\u6240\u6709\u955C\u5934\u8282\u70B9\uFF08id/\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u753B\u5E45\uFF09\u3001\u955C\u5934\u8FDE\u7EBF\u3001\u7528\u6237\u5728\u753B\u5E03\u4E0A\u7684\u9009\u4E2D\u9879\uFF08\u6574\u4E2A\u955C\u5934\u6216\u955C\u5934\u5185\u5143\u7D20\uFF0C\u542B xpath/\u6807\u7B7E/\u6587\u6848/\u5173\u952E\u6837\u5F0F\uFF09\u4EE5\u53CA\u753B\u5E03 URL\u3002\u4FEE\u6539\u5206\u955C\u524D\u5148\u8C03\u7528\uFF0C\u636E\u6B64\u5B9A\u4F4D\u7528\u6237\u6307\u7684\u662F\u54EA\u4E2A\u955C\u5934\u3002",
      input_schema: { type: "object", properties: {}, required: [] }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: withBackupNotice(redrawGetState)
  },
  {
    definition: {
      name: "redraw_arrange",
      description: "\u7F16\u6392\u753B\u5E03\uFF1A\u6309 action \u5220\u9664\u955C\u5934\uFF08remove\uFF0C\u8FDE\u5E26\u5176\u8FDE\u7EBF\u4E0E\u5206\u955C\u6587\u4EF6\uFF09\u3001\u590D\u5236\u955C\u5934\uFF08duplicate\uFF09\u3001\u5728\u4E24\u4E2A\u955C\u5934\u95F4\u8FDE\u7EBF\uFF08link\uFF09\u6216\u53D6\u6D88\u8FDE\u7EBF\uFF08unlink\uFF09\u3002\u91CD\u547D\u540D/\u79FB\u52A8\u8BF7\u7528 redraw_upsert_shot\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["remove", "duplicate", "link", "unlink"],
            description: "\u64CD\u4F5C\u7C7B\u578B"
          },
          id: { type: "string", description: "remove / duplicate \u4F7F\u7528\uFF1A\u955C\u5934\u8282\u70B9 id" },
          title: { type: "string", description: "duplicate \u53EF\u9009\uFF1A\u65B0\u6807\u9898\uFF08\u9ED8\u8BA4\u300C\u539F\u6807\u9898 \u526F\u672C\u300D\uFF09" },
          source: { type: "string", description: "link / unlink \u4F7F\u7528\uFF1A\u6E90\u955C\u5934 id" },
          target: { type: "string", description: "link / unlink \u4F7F\u7528\uFF1A\u76EE\u6807\u955C\u5934 id" },
          label: { type: "string", description: "link \u53EF\u9009\uFF1A\u8FDE\u7EBF\u6807\u7B7E" }
        },
        required: ["action"]
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(redrawArrange)
  }
];

// src/index.ts
var PLUGIN_ID = "tianshu-redraw";
var index_default = defineTianshuPlugin({
  id: PLUGIN_ID,
  activate() {
    return {
      tools: tools.map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.input_schema,
        concurrencySafe: tool.isConcurrencySafe?.() === true,
        requiresApproval: tool.requiresApproval?.() === true,
        pathParams: tool.pathParams ?? {},
        execute: (call) => tool.execute({ args: call.args, cwd: call.cwd, sessionId: call.sessionId ?? "default" })
      }))
    };
  }
});
export {
  index_default as default,
  tools
};
