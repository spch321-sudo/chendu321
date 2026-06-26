/**
 * 雲哲語音代理 · azure-tts-worker.js
 * ------------------------------------------------------------
 * 用途：把 app 的朗讀請求安全地轉發到 Azure 文字轉語音服務。
 * 金鑰（AZURE_TTS_KEY）與區域（AZURE_TTS_REGION）存在 Worker 的環境變數裡，
 * 絕不會出現在前端 HTML，避免被人看到、盜用。
 *
 * 部署後請把 app（index.html）裡的：
 *     var TTS_ENDPOINT = "https://azure-tts.spch321.workers.dev";
 * 改成這個 Worker 的實際網址。
 * ------------------------------------------------------------
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function xmlEscape(s) {
  return String(s || "")
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    const REGION = env.AZURE_TTS_REGION; // 例如 "eastasia"
    const KEY = env.AZURE_TTS_KEY;
    if (!REGION || !KEY) {
      return new Response("Worker 尚未設定 AZURE_TTS_REGION / AZURE_TTS_KEY", {
        status: 500, headers: CORS,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return new Response("Bad JSON", { status: 400, headers: CORS });
    }

    // 只允許白名單聲音，避免被亂用
    const ALLOW = ["zh-TW-YunJheNeural", "zh-TW-HsiaoChenNeural", "zh-TW-HsiaoYuNeural", "zh-CN-YunzheNeural"];
    const voice = ALLOW.includes(body.voice) ? body.voice : "zh-TW-YunJheNeural";
    const rate = /^[+-]?\d{1,3}%$/.test(body.rate || "") ? body.rate : "+0%";
    // 三段式停頓（毫秒），各自限制在 0~5000：
    const clamp = (v, d) => { let n = parseInt(v, 10); if (isNaN(n)) n = d; return Math.max(0, Math.min(5000, n)); };
    const silS = clamp(body.sil, 140);   // 句號/問號/驚嘆號（。？！）
    const silC = clamp(body.silc, 140);  // 逗號（，）
    const silE = clamp(body.sile, 260);  // 頓號（、）— 標題「一、二、三」聽得清楚
    // 每段音檔頭尾各補一半句末停頓，讓「換段處的句號」和「段內的句號」聽起來一致
    const edge = Math.round(silS / 2);
    const text = xmlEscape(body.text || "");
    if (!text.trim()) {
      return new Response("Empty text", { status: 400, headers: CORS });
    }

    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-TW">` +
      `<voice name="${voice}">` +
      `<mstts:silence type="Leading-exact" value="${edge}ms"/>` +
      `<mstts:silence type="Tailing-exact" value="${edge}ms"/>` +
      `<mstts:silence type="Sentenceboundary-exact" value="${silS}ms"/>` +
      `<mstts:silence type="Comma-exact" value="${silC}ms"/>` +
      `<mstts:silence type="Enumerationcomma-exact" value="${silE}ms"/>` +
      `<prosody rate="${rate}">${text}</prosody>` +
      `</voice></speak>`;

    const endpoint = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const azure = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "chendu321",
      },
      body: ssml,
    });

    if (!azure.ok) {
      const detail = await azure.text();
      return new Response("Azure TTS 失敗：" + azure.status + " " + detail, {
        status: 502, headers: CORS,
      });
    }

    const audio = await azure.arrayBuffer();
    return new Response(audio, {
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
