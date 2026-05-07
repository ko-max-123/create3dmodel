export interface Env {
  CHALLENGES: KVNamespace;
  ALLOWED_ORIGIN: string;
}

type Point = [number, number, number, number];

const CHALLENGE_TTL_SEC = 300;
const ANSWER_LENGTH = 6;
/** I, O, Q, 0, 1 を除外（設計書） */
const CHARSET = "ABCDEFGHJKLMNPRSTUVWXYZ23456789";

const FONT_5X7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01111", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "11110"],
};

function allowedOrigin(env: Env, request: Request): string {
  const raw = typeof env.ALLOWED_ORIGIN === "string" ? env.ALLOWED_ORIGIN.trim() : "";
  if (!raw || raw === "*") return "*";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const reqOrigin = request.headers.get("Origin");
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  if (list.length === 1) return list[0]!;
  return list[0]!;
}

function corsHeaders(env: Env, request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(env, request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(env: Env, request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(env, request),
  });
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomAnswer(length: number): string {
  let answer = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    answer += CHARSET[bytes[i]! % CHARSET.length]!;
  }
  return answer;
}

function rotateY(x: number, y: number, z: number, angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, y, -x * s + z * c];
}

function rotateX(x: number, y: number, z: number, angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, y * c - z * s, y * s + z * c];
}

function rotateZ(x: number, y: number, z: number, angle: number): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c, z];
}

function jitter(amount: number): number {
  return (Math.random() - 0.5) * amount;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 入力順は問わず、同じ multiset かどうか（「ABC」と「BCA」は一致） */
function normalizeUnordered(s: string): string {
  return [...s].sort().join("");
}

function pointsForChar(
  ch: string,
  index: number,
  total: number,
  extraY: number,
  extraX: number,
  extraZ: number,
): Point[] {
  const glyph = FONT_5X7[ch];
  if (!glyph) return [];

  const points: Point[] = [];
  const cell = 0.18;
  const baseAngle = (index / total) * Math.PI * 2 + extraY;
  const radius = 2.4 + jitter(0.12);

  for (let row = 0; row < glyph.length; row++) {
    for (let col = 0; col < glyph[row]!.length; col++) {
      if (glyph[row]![col] !== "1") continue;

      for (let n = 0; n < 5; n++) {
        let x = (col - 2) * cell + jitter(0.04);
        let y = (3 - row) * cell + jitter(0.04);
        let z = 0 + jitter(0.04);

        z += radius;
        [x, y, z] = rotateY(x, y, z, baseAngle);
        [x, y, z] = rotateX(x, y, z, 0.15 * Math.sin(baseAngle) + extraX);
        [x, y, z] = rotateZ(x, y, z, extraZ);

        points.push([round3(x), round3(y), round3(z), 0]);
      }
    }
  }

  return points;
}

/** 背景・シェル付近・中心付近のノイズ（設計書の方針を簡易反映） */
function generateNoise(count: number): Point[] {
  const points: Point[] = [];
  const bg = Math.floor(count * 0.55);
  const shell = Math.floor(count * 0.28);
  const center = count - bg - shell;

  for (let i = 0; i < bg; i++) {
    const r = 3.3 * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    points.push([round3(x + jitter(0.08)), round3(y + jitter(0.08)), round3(z + jitter(0.08)), 1]);
  }

  const shellR = 2.2 + Math.random() * 0.6;
  for (let i = 0; i < shell; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = shellR * Math.sin(phi) * Math.cos(theta) + jitter(0.15);
    const y = shellR * Math.sin(phi) * Math.sin(theta) + jitter(0.15);
    const z = shellR * Math.cos(phi) + jitter(0.15);
    points.push([round3(x), round3(y), round3(z), 1]);
  }

  for (let i = 0; i < center; i++) {
    const r = 0.55 * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    points.push([round3(x + jitter(0.06)), round3(y + jitter(0.06)), round3(z + jitter(0.06)), 1]);
  }

  return points;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function generatePoints(answer: string): Point[] {
  const points: Point[] = [];
  const n = answer.length;

  for (let i = 0; i < n; i++) {
    const extraY = (Math.random() - 0.5) * 0.9;
    const extraX = (Math.random() - 0.5) * 0.7;
    const extraZ = (Math.random() - 0.5) * 0.7;
    points.push(...pointsForChar(answer[i]!, i, n, extraY, extraX, extraZ));
  }

  points.push(...generateNoise(900));
  shuffleInPlace(points);
  return points;
}

async function handleChallenge(request: Request, env: Env): Promise<Response> {
  const challengeId = `ch_${randomId()}`;
  const answer = randomAnswer(ANSWER_LENGTH);
  const points = generatePoints(answer);

  await env.CHALLENGES.put(
    `challenge:${challengeId}`,
    JSON.stringify({
      answer,
      createdAt: Date.now(),
      used: false,
    }),
    { expirationTtl: CHALLENGE_TTL_SEC },
  );

  return json(env, request, {
    challengeId,
    expiresInSec: CHALLENGE_TTL_SEC,
    length: ANSWER_LENGTH,
    points,
    render: {
      sphereRadius: 0.045,
      bounds: 8.0,
    },
  });
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  let body: { challengeId?: string; answer?: string };

  try {
    body = await request.json();
  } catch {
    return json(env, request, { ok: false, reason: "invalid_json" }, 400);
  }

  const challengeId = String(body.challengeId ?? "").trim();
  const answer = String(body.answer ?? "").trim().toUpperCase();

  if (!challengeId || !answer) {
    return json(env, request, { ok: false, reason: "missing_parameter" }, 400);
  }

  const key = `challenge:${challengeId}`;
  const storedRaw = await env.CHALLENGES.get(key);

  if (!storedRaw) {
    return json(env, request, { ok: false, reason: "expired" }, 400);
  }

  let stored: { answer: string; createdAt: number; used?: boolean };
  try {
    stored = JSON.parse(storedRaw) as typeof stored;
  } catch {
    await env.CHALLENGES.delete(key);
    return json(env, request, { ok: false, reason: "expired" }, 400);
  }

  const correct = stored.answer.toUpperCase();

  // 使い捨て（設計書: 検証後即削除）
  await env.CHALLENGES.delete(key);

  const ok =
    answer.length === correct.length &&
    normalizeUnordered(answer) === normalizeUnordered(correct);

  return json(env, request, {
    ok,
    reason: ok ? "correct" : "incorrect",
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    if (request.method === "GET" && url.pathname === "/api/challenge") {
      return handleChallenge(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/verify") {
      return handleVerify(request, env);
    }

    return json(env, request, { ok: false, reason: "not_found" }, 404);
  },
};
