import { performOcrDebug, performLlmParse, performLlmParseDebug } from './api_calls.js';

console.log('[T2C] Background service worker loaded (module)');

let currentPopupWindowId = null;
let capturedImageDataUrl = null; // Store image data between capture and popup ready

// --- Helper: async sendResponse wrapper ---
function handle(promise, sendResponse) {
  promise.then(
    (res) => sendResponse(res),
    (err) => {
      console.error('[T2C] BG error:', err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  );
  return true; // keep message channel open
}

// --- sanitize debug so we don't spam base64 into logs/messages ---
function redactBase64InPlace(obj) {
  try {
    if (!obj) return obj;
    // Google Vision
    if (obj.payload?.requests?.[0]?.image?.content) obj.payload.requests[0].image.content = '<base64 omitted>';
    if (obj.payload?.requests?.[0]?.image?.source?.imageUri?.startsWith('data:')) {
      obj.payload.requests[0].image.source.imageUri = '<data-url omitted>';
    }
    // OpenAI Vision
    const msgs = obj.payload?.messages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c?.type === 'image_url' && typeof c.image_url?.url === 'string' && c.image_url.url.startsWith('data:')) {
              c.image_url.url = '<data-url omitted>';
            }
          }
        }
      }
    }
    // Gemini Vision
    const parts = obj.payload?.contents?.[0]?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p?.inline_data?.data) p.inline_data.data = '<base64 omitted>';
      }
    }
    // Claude Vision
    const msgs2 = obj.payload?.messages;
    if (Array.isArray(msgs2)) {
      for (const m of msgs2) {
        if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c?.type === 'image' && c?.source?.data) c.source.data = '<base64 omitted>';
          }
        }
      }
    }
    return obj;
  } catch { return obj; }
}

function truncatePromptInPlace(obj, max = 1600) {
  try {
    if (!obj || !obj.payload) return obj;
    // OpenAI / Claude: look in messages[0].content (string for these calls)
    if (Array.isArray(obj.payload.messages) && obj.payload.messages[0]?.content) {
      const c = obj.payload.messages[0].content;
      if (typeof c === 'string' && c.length > max) {
        obj.payload.messages[0].content = c.slice(0, max) + '… [truncated]';
      }
    }
    // Gemini: contents[0].parts[0].text
    if (obj.payload.contents?.[0]?.parts?.[0]?.text) {
      const t = obj.payload.contents[0].parts[0].text;
      if (t.length > max) obj.payload.contents[0].parts[0].text = t.slice(0, max) + '… [truncated]';
    }
    return obj;
  } catch { return obj; }
}

// --- Content script bootstrap (kept for area selection) ---
function isCapturableUrl(url) {
  if (!url) return false;
  return /^https?:|^file:|^ftp:/i.test(url);
}

async function ensureContent(tabId, url) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 't2c.ping' });
    console.log('[T2C] Content scripts already injected');
    return true;
  } catch {
    if (!isCapturableUrl(url)) {
      console.log('[T2C] URL not capturable:', url);
      return false;
    }
    try {
      console.log('[T2C] Injecting content scripts...');
      
      // Insert CSS first
      await chrome.scripting.insertCSS({ 
        target: { tabId }, 
        files: ['overlay.css'] 
      });
      console.log('[T2C] CSS injected successfully');
      
      // Inject content.js (no components.js needed anymore)
      await chrome.scripting.executeScript({ 
        target: { tabId }, 
        files: ['content.js'] 
      });
      console.log('[T2C] content.js injected successfully');
      
      return true;
    } catch (e) {
      console.error('[T2C] Failed to inject content scripts:', e);
      return false;
    }
  }
}

// New function to encapsulate config checks
async function checkConfiguredModelsAndKeys() {
  const settings = await chrome.storage.sync.get([
    'openaiKey', 'claudeKey', 'geminiKey', 'googleKey',
    'ocrMethod', 'parseMethod', 'ocrModel', 'parseModel'
  ]);

  // 1. Check if user has ANY API keys configured.
  const hasAnyKey = settings.openaiKey || settings.claudeKey || settings.geminiKey || settings.googleKey;
  if (!hasAnyKey) {
    console.log('[T2C] Config check failed: No API keys found at all.');
    return false; // No keys, so cannot proceed
  }

  // 2. Check if keys and models are configured for their *selected* methods
  const ocrMethod = settings.ocrMethod;
  const parseMethod = settings.parseMethod;

  let ocrKeyOk = true;
  let ocrModelOk = true;
  let parseKeyOk = true;
  let parseModelOk = true;

  // OCR method checks
  if (!ocrMethod) {
    console.log('[T2C] Config check failed: No OCR method selected.');
    return false;
  }
  if (ocrMethod === 'openai-vision') {
    ocrKeyOk = !!settings.openaiKey;
    ocrModelOk = !!settings.ocrModel;
  } else if (ocrMethod === 'gemini-vision') {
    ocrKeyOk = !!settings.geminiKey;
    ocrModelOk = !!settings.ocrModel;
  } else if (ocrMethod === 'claude-vision') {
    ocrKeyOk = !!settings.claudeKey;
    ocrModelOk = !!settings.ocrModel;
  } else if (ocrMethod === 'google-vision') {
    ocrKeyOk = !!settings.googleKey;
    // Google Vision doesn't typically use a selectable model string in the same way as OpenAI/Gemini/Claude
    // If a model was ever added for it, this would need adjustment. For now, no model check.
  }

  // Parse method checks
  if (!parseMethod) {
    console.log('[T2C] Config check failed: No Parse method selected.');
    return false;
  }
  if (parseMethod === 'openai') {
    parseKeyOk = !!settings.openaiKey;
    parseModelOk = !!settings.parseModel;
  } else if (parseMethod === 'gemini') {
    parseKeyOk = !!settings.geminiKey;
    parseModelOk = !!settings.parseModel;
  } else if (parseMethod === 'claude') {
    parseKeyOk = !!settings.claudeKey;
    parseModelOk = !!settings.parseModel;
  }

  const overallConfigOk = ocrKeyOk && ocrModelOk && parseKeyOk && parseModelOk;

  console.log('[T2C] Detailed Config validation:', {
    ocrMethod, ocrKeyOk, ocrModelOk, parseMethod, parseKeyOk, parseModelOk, overallConfigOk
  });
  return overallConfigOk;
}

async function startCapture(tab) {
  if (!(await checkConfiguredModelsAndKeys())) {
    chrome.runtime.openOptionsPage();
    return;
  }
  
  // The rest of the startCapture function remains the same
  if (!tab?.id) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }
  if (!tab?.id) return;
  
  const ok = await ensureContent(tab.id, tab.url || '');
  if (!ok) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 't2c.beginCapture' });
  } catch (e) {
    console.error('[T2C] Failed to send beginCapture:', e);
  }
}

// Create popup window for processing
async function createPopupWindow(imageDataUrl) {
  try {
    // Close existing popup if open
    if (currentPopupWindowId) {
      try {
        await chrome.windows.remove(currentPopupWindowId);
      } catch {}
      currentPopupWindowId = null;
    }

    // Store the image data URL to be sent when the popup is ready
    capturedImageDataUrl = imageDataUrl;

    // Create new popup window
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL('modal.html'),
      type: 'popup',
      width: 720,
      height: 600,
      focused: true
    });

    currentPopupWindowId = window.id;
    console.log(`[T2C] Created popup window ${currentPopupWindowId} and stored image data.`);

    return { ok: true };
  } catch (e) {
    console.error('[T2C] Failed to create popup window:', e);
    return { ok: false, error: e.message };
  }
}

// Track when popup window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === currentPopupWindowId) {
    console.log(`[T2C] Popup window ${windowId} closed.`);
    currentPopupWindowId = null;
  }
});

// Toolbar button / keyboard (kept)
chrome.action?.onClicked.addListener(async (tab) => {
  startCapture(tab);
});
chrome.commands?.onCommand.addListener(async (cmd) => { if (cmd === 'start-capture') {
  startCapture();
} });

// --- Message router ----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Diagnostics: OCR (options page test)
  if (msg?.type === 'DIAG_TEST_OCR') {
    return handle((async () => {
      // Get all keys and pass the selected model if present
      const settings = await chrome.storage.sync.get(['openaiKey', 'claudeKey', 'geminiKey', 'googleKey']);
      // For tests, pass the model from the UI directly to the API call settings
      if (msg.model) settings.model = msg.model;

      const { text, debug } = await performOcrDebug(msg.provider, msg.dataUrl, settings);
      return { ok: true, text, debug: redactBase64InPlace(debug) };
    })(), sendResponse);
  }

  // Diagnostics: Parse (options page test)
  if (msg?.type === 'DIAG_TEST_PARSE') {
    return handle((async () => {
      const settings = await chrome.storage.sync.get(['openaiKey', 'claudeKey', 'geminiKey']);
      // For tests, pass the model from the UI directly to the API call settings
      if (msg.model) settings.model = msg.model;

      const { result, debug } = await performLlmParseDebug(msg.provider, msg.text || '', settings);
      return { ok: true, result, debug: truncatePromptInPlace(debug) };
    })(), sendResponse);
  }

  // Settings for modal
  if (msg?.type === 'EC_GET_SETTINGS') {
    return handle((async () => {
      const s = await chrome.storage.sync.get([
        'ocrMethod', 'parseMethod', 'ocrModel', 'parseModel',
        'openaiKey', 'claudeKey', 'geminiKey', 'googleKey'
      ]);
      const settings = {
        ocrMethod: s.ocrMethod || '',
        parseMethod: s.parseMethod || '',
        ocrModel: s.ocrModel || '',
        parseModel: s.parseModel || '',
        openaiKey: s.openaiKey || '',
        claudeKey: s.claudeKey || '',
        geminiKey: s.geminiKey || '',
        googleKey: s.googleKey || ''
      };
      return { ok: true, settings };
    })(), sendResponse);
  }

  // Centralized OCR for modal — with debug
  if (msg?.type === 'EC_RUN_OCR') {
    return handle((async () => {
      const s = await chrome.storage.sync.get(['openaiKey', 'claudeKey', 'geminiKey', 'googleKey', 'ocrModel']);
      const settings = {
        openaiKey: s.openaiKey || '',
        claudeKey: s.claudeKey || '',
        geminiKey: s.geminiKey || '',
        googleKey: s.googleKey || '',
        model: s.ocrModel || '', // Use the specific model for OCR
      };
      const { text, debug } = await performOcrDebug(msg.provider, msg.dataUrl, settings);
      return { ok: true, text, debug: redactBase64InPlace(debug), requestId: msg.requestId || null };
    })(), sendResponse);
  }

  // Centralized Parse for modal — with debug
  if (msg?.type === 'EC_RUN_PARSE') {
    return handle((async () => {
      const s = await chrome.storage.sync.get(['openaiKey', 'claudeKey', 'geminiKey', 'parseModel']);
      const settings = {
        openaiKey: s.openaiKey || '',
        claudeKey: s.claudeKey || '',
        geminiKey: s.geminiKey || '',
        model: s.parseModel || '', // Use the specific model for Parse
      };
      const { result, debug } = await performLlmParseDebug(msg.provider, msg.text || '', settings);
      return { ok: true, result, debug: truncatePromptInPlace(debug), requestId: msg.requestId || null };
    })(), sendResponse);
  }

  // Screenshot - FIXED: explicit async handling
  if (msg?.type === 't2c.screenshot') {
    return handle((async () => {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender?.tab?.windowId, { format: 'png' });
      return { ok: true, dataUrl };
    })(), sendResponse);
  }

  // NEW: Create popup window with image data
  if (msg?.type === 't2c.createPopup') {
    return handle(createPopupWindow(msg.imageDataUrl), sendResponse);
  }

  // NEW: Popup is ready, now send it the image data
  if (msg?.type === 'POPUP_READY') {
    return handle((async () => {
      if (!currentPopupWindowId) {
        throw new Error('Popup ready signal received, but no popup window is tracked. It may have been closed.');
      }
      const window = await chrome.windows.get(currentPopupWindowId, { populate: true });
      const tabId = window?.tabs?.[0]?.id;
      if (!tabId) {
        throw new Error('Could not find tab ID for the popup window.');
      }
      if (!capturedImageDataUrl) {
        throw new Error('Popup is ready, but there is no captured image data to send.');
      }

      console.log(`[T2C] Popup is ready. Sending image data to tab ${tabId}.`);
      await chrome.tabs.sendMessage(tabId, {
        type: 'POPUP_PROCESS_IMAGE',
        imageDataUrl: capturedImageDataUrl
      });
      capturedImageDataUrl = null; // Clear data after sending
    })(), sendResponse);
  }

  // Open options page
  if (msg?.type === 't2c.openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  // Redraw - FIXED: synchronous response
  if (msg?.type === 't2c.redraw') {
    startCapture(sender?.tab);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});