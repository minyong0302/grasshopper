import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const { RESEND_API_KEY, JOKBO_FROM_EMAIL, JOKBO_NOTION_URL, JOKBO_ALLOWED_EMAILS } = process.env;
const allowed = new Set((JOKBO_ALLOWED_EMAILS ?? "").split(",")
  .map((email) => email.trim().toLowerCase()).filter(Boolean));
const notion = URL.canParse(JOKBO_NOTION_URL) ? new URL(JOKBO_NOTION_URL) : null;
const configured = RESEND_API_KEY && JOKBO_FROM_EMAIL && allowed.size &&
  notion?.protocol === "https:" && !notion.username && !notion.password &&
  (notion.hostname === "www.notion.so" || notion.hostname === "notion.so" ||
    notion.hostname.endsWith(".notion.site"));

const minute = 60_000;
const challenges = new Map();
const emailCooldowns = new Map();
const requestLimits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const records of [challenges, emailCooldowns, requestLimits]) {
    for (const [key, record] of records) {
      if (record.expiresAt <= now) records.delete(key);
    }
  }
}, minute).unref();

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function sendCode(email, code) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: JOKBO_FROM_EMAIL,
      to: [email],
      subject: "아치셈틀 족보 인증번호",
      text: `인증번호는 ${code}입니다. 10분 안에 입력해 주세요.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Email delivery failed");
}

async function authenticate(request, response, route) {
  if (request.method !== "POST" || request.headers["content-type"] !== "application/json") {
    request.resume();
    return json(response, 400, { message: "요청 형식이 올바르지 않아요." });
  }
  if (!configured) {
    request.resume();
    return json(response, 503, { message: "족보 이메일 인증 설정이 필요해요. 관리자에게 문의해 주세요." });
  }

  const now = Date.now();
  const address = request.socket.remoteAddress;
  let limit = requestLimits.get(address);
  if (!limit || limit.expiresAt <= now) {
    limit = { count: 0, expiresAt: now + minute };
    requestLimits.set(address, limit);
  }
  if (++limit.count > 30) {
    request.resume();
    return json(response, 429, { message: "잠시 후 다시 시도해 주세요." });
  }

  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    body += chunk;
    if (body.length > 1024) {
      request.resume();
      return json(response, 413, { message: "요청이 너무 커요." });
    }
  }

  let input;
  try {
    input = JSON.parse(body);
  } catch {
    return json(response, 400, { message: "요청 형식이 올바르지 않아요." });
  }

  if (route === "/api/jokbo/send") {
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(response, 400, { message: "이메일 주소를 확인해 주세요." });
    }
    const challengeId = randomBytes(24).toString("hex");
    if (!allowed.has(email)) return json(response, 200, { challengeId });
    const previous = emailCooldowns.get(email);
    if (previous?.nextSendAt > now) {
      return json(response, 429, { message: "인증번호는 1분 후 다시 받을 수 있어요." });
    }

    emailCooldowns.set(email, {
      nextSendAt: now + minute,
      expiresAt: now + 11 * minute,
      challengeId,
    });
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    try {
      await sendCode(email, code);
    } catch {
      if (previous) emailCooldowns.set(email, previous);
      else emailCooldowns.delete(email);
      return json(response, 502, { message: "인증 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요." });
    }
    challenges.delete(previous?.challengeId);
    challenges.set(challengeId, { code, attempts: 0, expiresAt: Date.now() + 10 * minute });
    return json(response, 200, { challengeId });
  }

  const challenge = challenges.get(input?.challengeId);
  const failure = { message: "인증번호를 확인해 주세요. 만료되었다면 번호를 다시 받아 주세요." };
  if (!challenge || challenge.expiresAt <= now || typeof input.code !== "string" ||
      !/^[0-9]{6}$/.test(input.code)) {
    return json(response, 400, failure);
  }
  if (!timingSafeEqual(Buffer.from(input.code), Buffer.from(challenge.code))) {
    if (++challenge.attempts >= 5) challenges.delete(input.challengeId);
    return json(response, 400, failure);
  }
  challenges.delete(input.challengeId);
  return json(response, 200, { notionUrl: notion.href });
}

const types = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/api/jokbo/send" || path === "/api/jokbo/verify") {
      return await authenticate(request, response, path);
    }
    const file = path === "/" ? "/index.html" : decodeURIComponent(path);
    const isPublic = /^\/(?:index\.html|html\/[\p{L}\d _-]+\.html|css\/[\p{L}\d _-]+\.css|js\/(?:jokbo|activity)\.js|img\/[\p{L}\d _-]+\.(?:png|jpe?g|webp))$/u;
    if (["GET", "HEAD"].includes(request.method) && isPublic.test(file)) {
      const content = await readFile(new URL("." + file, import.meta.url));
      response.writeHead(200, { "Content-Type": types[file.split(".").at(-1)] });
      return response.end(request.method === "HEAD" ? undefined : content);
    }
    return json(response, 404, { message: "페이지를 찾을 수 없어요." });
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof URIError) {
      return json(response, 404, { message: "페이지를 찾을 수 없어요." });
    }
    return json(response, 500, { message: "서버 오류가 발생했어요." });
  }
}).listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1", () => {
  console.log("아치셈틀 서버가 시작되었어요.");
});
