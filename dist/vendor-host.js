// src/vendor/child-host.ts
import vm from "node:vm";

// src/vendor/globals.ts
import { createHmac } from "node:crypto";
function buildUrl(baseURL, url, params) {
  let full = url ?? "";
  if (baseURL && !/^https?:\/\//i.test(full)) {
    full = baseURL.replace(/\/+$/, "") + "/" + full.replace(/^\/+/, "");
  }
  if (params && Object.keys(params).length > 0) {
    const u = new URL(full);
    for (const [k, v] of Object.entries(params)) {
      if (v !== void 0 && v !== null) u.searchParams.set(k, String(v));
    }
    full = u.toString();
  }
  return full;
}
function createAxios(defaults = {}) {
  async function request(config) {
    const merged = { ...defaults, ...config, headers: { ...defaults.headers, ...config.headers } };
    const url = buildUrl(merged.baseURL, merged.url, merged.params);
    if (!url) throw new Error("axios: \u7F3A\u5C11 url");
    const method = (merged.method ?? "GET").toUpperCase();
    const controller = new AbortController();
    let timer;
    const timeoutMs = merged.timeout ?? 0;
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);
    if (merged.signal) merged.signal.addEventListener("abort", () => controller.abort(), { once: true });
    let body;
    const headers = { ...merged.headers ?? {} };
    if (merged.data !== void 0 && method !== "GET" && method !== "HEAD") {
      if (typeof merged.data === "string") body = merged.data;
      else {
        body = JSON.stringify(merged.data);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
          headers["Content-Type"] = "application/json";
        }
      }
    }
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      const hdrs = {};
      res.headers.forEach((v, k) => {
        hdrs[k] = v;
      });
      let data;
      if (merged.responseType === "arraybuffer") {
        data = Buffer.from(await res.arrayBuffer());
      } else if (merged.responseType === "text") {
        data = await res.text();
      } else {
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
      }
      if (res.status >= 400) {
        const err = new Error(`axios: HTTP ${res.status}`);
        err.response = { data, status: res.status, statusText: res.statusText, headers: hdrs };
        throw err;
      }
      return { data, status: res.status, statusText: res.statusText, headers: hdrs };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const instance = {
    request,
    get: (url, config) => request({ ...config, url, method: "GET" }),
    delete: (url, config) => request({ ...config, url, method: "DELETE" }),
    head: (url, config) => request({ ...config, url, method: "HEAD" }),
    post: (url, data, config) => request({ ...config, url, method: "POST", data }),
    put: (url, data, config) => request({ ...config, url, method: "PUT", data }),
    patch: (url, data, config) => request({ ...config, url, method: "PATCH", data }),
    create: (config) => createAxios(config)
  };
  return instance;
}
function base64Encode(data) {
  return Buffer.from(data).toString("base64");
}
function buildGlobals(logSink) {
  const logger = (msg) => {
    logSink(String(msg));
  };
  const axios = createAxios();
  const jsonwebtoken = {
    sign(payload, secret, options) {
      const alg = options?.algorithm ?? "HS256";
      if (alg !== "HS256") throw new Error(`jsonwebtoken: \u4EC5\u652F\u6301 HS256\uFF0C\u6536\u5230 ${alg}`);
      const header = { alg: "HS256", typ: "JWT" };
      const now = Math.floor(Date.now() / 1e3);
      const body = { ...payload, iat: now };
      if (typeof options?.expiresIn === "number") body.exp = now + options.expiresIn;
      else if (typeof options?.expiresIn === "string") {
        const m = /^(\d+)([smhd])$/.exec(options.expiresIn);
        if (m) {
          const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
          body.exp = now + Number(m[1]) * mult;
        }
      }
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const signingInput = `${b64(header)}.${b64(body)}`;
      const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
      return `${signingInput}.${sig}`;
    },
    verify(token, secret) {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("jsonwebtoken: \u65E0\u6548 token");
      const [h, p, s] = parts;
      const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
      if (expected !== s) throw new Error("jsonwebtoken: \u7B7E\u540D\u4E0D\u5339\u914D");
      return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    }
  };
  const urlToBase64 = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`urlToBase64: HTTP ${res.status}`);
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${mime};base64,${base64Encode(buf)}`;
  };
  const zipImage = async (base64, _size) => {
    logger("zipImage \u672A\u5B9E\u73B0\uFF08Node \u65E0\u56FE\u50CF\u7F16\u89E3\u7801\uFF09\uFF0C\u539F\u6837\u8FD4\u56DE");
    return base64;
  };
  const zipImageResolution = async (base64, _w, _h) => {
    logger("zipImageResolution \u672A\u5B9E\u73B0\uFF0C\u539F\u6837\u8FD4\u56DE");
    return base64;
  };
  const mergeImages = async (base64Arr) => {
    logger("mergeImages \u672A\u5B9E\u73B0\uFF0C\u8FD4\u56DE\u9996\u5F20");
    return base64Arr[0] ?? "";
  };
  const pollTask = async (fn, interval = 5e3, timeout = 6e5) => {
    const deadline = Date.now() + timeout;
    while (true) {
      const result = await fn();
      if (result.completed) return result;
      if (Date.now() >= deadline) return { completed: true, error: `pollTask \u8D85\u65F6\uFF08${timeout}ms\uFF09` };
      await new Promise((r) => setTimeout(r, interval));
    }
  };
  const factoryStub = (name) => () => {
    throw new Error(`${name} \u4E0D\u53EF\u7528\uFF1A\u672C\u63D2\u4EF6\u4E0D\u4F7F\u7528\u9002\u914D\u6587\u4EF6\u7684\u6587\u672C\u6A21\u578B\uFF08textRequest\uFF09`);
  };
  return {
    axios,
    logger,
    jsonwebtoken,
    zipImage,
    zipImageResolution,
    mergeImages,
    urlToBase64,
    pollTask,
    createOpenAI: factoryStub("createOpenAI"),
    createDeepSeek: factoryStub("createDeepSeek"),
    createZhipu: factoryStub("createZhipu"),
    createQwen: factoryStub("createQwen"),
    createAnthropic: factoryStub("createAnthropic"),
    createOpenAICompatible: factoryStub("createOpenAICompatible"),
    createXai: factoryStub("createXai"),
    createMinimax: factoryStub("createMinimax"),
    createGoogleGenerativeAI: factoryStub("createGoogleGenerativeAI"),
    console,
    Buffer,
    URL,
    URLSearchParams,
    fetch,
    AbortController,
    TextEncoder,
    TextDecoder,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    Map,
    Set
  };
}

// src/vendor/child-host.ts
var exportsRef = null;
var vendorRef = null;
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function log(msg) {
  send({ type: "log", msg });
}
function isImageModel(m) {
  return m.type === "image";
}
function isVideoModel(m) {
  return m.type === "video";
}
function validateVendor(v) {
  if (!v || typeof v !== "object") throw new Error("vendor \u4E0D\u662F\u5BF9\u8C61");
  const o = v;
  if (typeof o.id !== "string" || o.id.length === 0) throw new Error("vendor.id \u7F3A\u5931");
  if (typeof o.name !== "string") throw new Error("vendor.name \u7F3A\u5931");
  if (!Array.isArray(o.models)) throw new Error("vendor.models \u5FC5\u987B\u662F\u6570\u7EC4");
  const inputValues = typeof o.inputValues === "object" && o.inputValues ? o.inputValues : {};
  return {
    id: o.id,
    version: typeof o.version === "string" ? o.version : "1.0",
    name: o.name,
    author: typeof o.author === "string" ? o.author : "",
    ...typeof o.description === "string" ? { description: o.description } : {},
    ...typeof o.icon === "string" ? { icon: o.icon } : {},
    inputs: Array.isArray(o.inputs) ? o.inputs : [],
    inputValues,
    models: o.models
  };
}
function handleLoad(msg) {
  try {
    const globals = buildGlobals(log);
    const context = { ...globals, exports: {}, module: { exports: {} } };
    vm.createContext(context);
    const script = new vm.Script(msg.code, { filename: `${msg.vendorId}.ts` });
    script.runInContext(context, { timeout: 5e3 });
    const ex = context.exports ?? {};
    exportsRef = ex;
    const vendor = validateVendor(ex.vendor);
    Object.assign(vendor.inputValues, msg.inputValues ?? {});
    vendorRef = vendor;
    const imageModels = vendor.models.filter(isImageModel);
    const videoModels = vendor.models.filter(isVideoModel);
    send({ type: "loaded", vendor, imageModels, videoModels });
  } catch (err) {
    send({ type: "error", error: err?.message ?? String(err) });
  }
}
async function handleCall(msg) {
  try {
    if (!exportsRef || !vendorRef) throw new Error("\u5C1A\u672A\u52A0\u8F7D vendor");
    const fn = exportsRef[msg.method];
    if (typeof fn !== "function") throw new Error(`vendor \u672A\u5B9E\u73B0 ${msg.method}`);
    const model = vendorRef.models.find((m) => m.modelName === msg.modelName);
    if (!model) throw new Error(`\u672A\u627E\u5230\u6A21\u578B ${msg.modelName}`);
    const value = await fn(msg.config, model);
    if (typeof value !== "string") throw new Error(`${msg.method} \u672A\u8FD4\u56DE\u5B57\u7B26\u4E32\uFF08\u6709\u5934 base64\uFF09`);
    send({ type: "result", id: msg.id, value });
  } catch (err) {
    send({ type: "error", id: msg.id, error: err?.message ?? String(err) });
  }
}
var buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "load") handleLoad(msg);
    else if (msg.type === "call") void handleCall(msg);
    else if (msg.type === "shutdown") process.exit(0);
  }
});
process.stdin.on("end", () => process.exit(0));
