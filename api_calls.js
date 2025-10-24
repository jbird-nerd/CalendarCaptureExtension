// api_calls.js – Centralized OCR + Parse calls with debug helpers
// NOTE: no UI or CSS changes here.

// --------------------------- OCR (with debug) ---------------------------

async function callGoogleVisionOCRDebug(dataUrlOrHttpUrl, settings = {}) {
  if (!settings.googleKey) throw new Error('Google Cloud API key is missing.');

  const isDataUrl = typeof dataUrlOrHttpUrl === 'string' && dataUrlOrHttpUrl.startsWith('data:');
  const image = isDataUrl
    ? { content: dataUrlOrHttpUrl.split(',')[1] }
    : { source: { imageUri: dataUrlOrHttpUrl } };

  const payload = {
    requests: [
      {
        image,
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['en'] },
      },
    ],
  };

  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${settings.googleKey}`;
  console.log(`[T2C DEBUG] Calling Google Vision OCR: ${endpoint}`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  const err = data?.responses?.[0]?.error?.message || (!response.ok && `HTTP ${response.status}`);
  if (err) throw new Error(`Google Vision API error: ${err}`);

  const r = data?.responses?.[0] || {};
  const text =
    r.fullTextAnnotation?.text ||
    (Array.isArray(r.textAnnotations) && r.textAnnotations[0]?.description) ||
    '';

  return { text, debug: { provider: 'google-vision', endpoint, payload } };
}

async function callOpenAIVisionOCRDebug(dataUrl, settings = {}) {
  if (!settings.openaiKey) throw new Error('OpenAI API key is missing.');
  // Prefer model from settings, then storage, then fallback.
  const chosenModel = settings.model || (await chrome.storage.sync.get(['ocrModel'])).ocrModel || 'gpt-4o-mini';

  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: chosenModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text from this image exactly as it appears.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  console.log(`[T2C DEBUG] Calling OpenAI Vision OCR: ${endpoint} (model: ${chosenModel})`);
  
  const makeRequest = async (payload) => {
    return await fetch(endpoint, {
      method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  };

  let response = await makeRequest(body);
  let data = await response.json();

  // If the first attempt fails because of a token parameter issue, adapt and retry.
  if (!response.ok && data.error?.message?.includes('max_tokens')) {
    console.log('[T2C DEBUG] Retrying OpenAI call with max_tokens parameter.');
    const newBody = { ...body, max_tokens: 2000 };
    response = await makeRequest(newBody);
    data = await response.json();
  }

  if (!response.ok) throw new Error(data.error?.message || `API Error ${response.status}`);

  const text = data.choices?.[0]?.message?.content || '';
  return { text, debug: { provider: 'openai-vision', model: chosenModel, endpoint, payload: body } };
}

async function callClaudeVisionOCRDebug(dataUrl, settings = {}) {
  if (!settings.claudeKey) throw new Error('Claude API key is missing.');

  const base64 = dataUrl.split(',')[1];
  const endpoint = 'https://api.anthropic.com/v1/messages';
  // Prefer model from settings (for tests), then storage, then fallback.
  const chosenModel = settings.model || (await chrome.storage.sync.get(['ocrModel'])).ocrModel || 'claude-3-haiku-20240307';
  const body = {
    model: chosenModel,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: 'Extract text from this image.' },
        ],
      },
    ],
  };

  console.log(`[T2C DEBUG] Calling Claude Vision OCR: ${endpoint} (model: ${body.model})`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': settings.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `API Error ${response.status}`);

  const text = data.content?.[0]?.text || '';
  return { text, debug: { provider: 'claude-vision', model: body.model, endpoint, payload: body } };
}

async function callGeminiVisionOCRDebug(dataUrl, settings = {}) {
  if (!settings.geminiKey) throw new Error('Gemini API key is missing.');

  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
  const mime = (match && match[1]) || 'image/png';
  const b64 = (match && match[2]) || (dataUrl.split(',')[1] || '');

  // Prefer model from settings, then storage, then fallback.
  let modelName = settings.model || (await chrome.storage.sync.get(['ocrModel'])).ocrModel || 'gemini-1.5-flash';
  // Ensure the model name has the 'models/' prefix for the API call.
  if (!modelName.startsWith('models/')) modelName = 'models/' + modelName;

  const endpointBase = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent`;
  const payload = {
    contents: [
      {
        parts: [
          { text: 'Extract all text from this image exactly as it appears.' },
          { inline_data: { mime_type: mime, data: b64 } },
        ],
      },
    ],
  };

  console.log(`[T2C DEBUG] Calling Gemini Vision OCR: ${endpointBase}`);
  const response = await fetch(`${endpointBase}?key=${settings.geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini Vision API ${response.status}`);

  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

  return { text, debug: { provider: 'gemini-vision', model: modelName, endpoint: endpointBase, payload } };
}

// Centralized OCR entry points
export async function performOcrDebug(provider, dataUrl, settings) {
  switch (provider) {
    case 'google-vision':
      return await callGoogleVisionOCRDebug(dataUrl, settings);
    case 'openai-vision':
      return await callOpenAIVisionOCRDebug(dataUrl, settings);
    case 'claude-vision':
      return await callClaudeVisionOCRDebug(dataUrl, settings);
    case 'gemini-vision':
      return await callGeminiVisionOCRDebug(dataUrl, settings);
    default:
      throw new Error(`Unknown OCR provider: ${provider}`);
  }
}

export async function performOcr(provider, dataUrl, settings) {
  const { text } = await performOcrDebug(provider, dataUrl, settings);
  return text;
}

// --------------------------- Parsing (with debug) ---------------------------

function buildParsePrompt(text) {
  return `Your task is to analyze ONLY the text provided below and extract event details into a single raw JSON object with keys: "title", "start", "end", "location", "hasTime". The current date is ${new Date().toString()}.

IMPORTANT: All relative and recurring date references MUST point to UPCOMING/FUTURE dates, never past dates:
- "First Tuesday of the month" means the NEXT occurrence (if today is late October, use November's first Tuesday)
- "Second Wednesday" means the upcoming second Wednesday, not a past one
- "Every Monday" or "Every Other Friday" should use the next occurrence
- Any day-of-week reference (e.g., "Monday", "this Friday") should be the upcoming occurrence

Format dates as local ISO 8601 strings (e.g., "2025-09-23T17:30:00"). If info is missing, use null. --- ${text} ---`;
}

async function callOpenAIParseDebug(text, settings = {}) {
  if (!settings.openaiKey) throw new Error('OpenAI key missing.');
  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const chosenModel = settings.model || (await chrome.storage.sync.get(['parseModel'])).parseModel || 'gpt-4o-mini';
  const body = {
    model: chosenModel,
    messages: [{ role: 'user', content: buildParsePrompt(text) }],
    response_format: { type: 'json_object' },
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `OpenAI API ${resp.status}`);
  const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  return { result, debug: { provider: 'openai', model: body.model, endpoint, payload: body } };
}

async function callGeminiParseDebug(text, settings = {}) {
  if (!settings.geminiKey) throw new Error('Gemini key missing.');
  // Prefer model from settings, then storage, then fallback.
  let modelName = settings.model || (await chrome.storage.sync.get(['parseModel'])).parseModel || 'gemini-1.5-flash';
  // Ensure the model name has the 'models/' prefix for the API call.
  if (!modelName.startsWith('models/')) modelName = 'models/' + modelName;

  const endpointBase = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: buildParsePrompt(text) }] }],
    generationConfig: { response_mime_type: 'application/json' },
  };

  console.log(`[T2C DEBUG] Calling Gemini Parse: ${endpointBase}`);
  const resp = await fetch(`${endpointBase}?key=${settings.geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const rawResponse = await resp.text();
  if (!resp.ok) {
    console.error(`[T2C DEBUG] Gemini Parse Error Response (status ${resp.status}):`, rawResponse);
    throw new Error(`Gemini API Error ${resp.status}: ${rawResponse}`);
  }

  try {
    const data = JSON.parse(rawResponse);
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const result = JSON.parse(rawJson);
    return { result, debug: { provider: 'gemini', model: modelName, endpoint: endpointBase, payload } };
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON response: ${e.message}. Raw response: ${rawResponse}`);
  }
}

async function callClaudeParseDebug(text, settings = {}) {
  if (!settings.claudeKey) throw new Error('Claude key missing.');
  const endpoint = 'https://api.anthropic.com/v1/messages';
  const chosenModel = settings.model || (await chrome.storage.sync.get(['parseModel'])).parseModel || 'claude-3-haiku-20240307';
  const body = {
    model: chosenModel,
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildParsePrompt(text) + '\n\nReturn JSON inside <json> tags.' }],
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': settings.claudeKey, 
      'anthropic-version': '2023-06-01', 
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Claude API ${resp.status}`);
  const match = data.content?.[0]?.text?.match(/<json>([\s\S]*?)<\/json>/);
  if (!match) throw new Error('Valid JSON not found in Claude response.');
  const result = JSON.parse(match[1]);
  return { result, debug: { provider: 'claude', model: body.model, endpoint, payload: body } };
}

export async function performLlmParseDebug(provider, text, settings) {
  switch (provider) {
    case 'openai': return await callOpenAIParseDebug(text, settings);
    case 'gemini': return await callGeminiParseDebug(text, settings);
    case 'claude': return await callClaudeParseDebug(text, settings);
    default: throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

// Back-compat
export async function performLlmParse(provider, text, settings) {
  const { result } = await performLlmParseDebug(provider, text, settings);
  return result;
}