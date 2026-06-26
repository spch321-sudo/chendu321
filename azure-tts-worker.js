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
    // 句號之間的停頓（毫秒）；越小越順。預設 200ms，限制在 0~1000。
    let sil = parseInt(body.sil, 10);
    if (isNaN(sil)) sil = 200;
    sil = Math.max(0, Math.min(1000, sil));
    const text = xmlEscape(body.text || "");
    if (!text.trim()) {
      return new Response("Empty text", { status: 400, headers: CORS });
    }

    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-TW">` +
      `<voice name="${voice}">` +
      `<mstts:silence type="Sentenceboundary-exact" value="${sil}ms"/>` +
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
