// modal.js - Popup window logic

console.log('[T2C Modal][DEBUG] modal.js script loaded (top-level)');
window.addEventListener('unload', () => {
  console.log('[T2C Modal][DEBUG] Popup window unloading (unload event)');
});

let capturedImageData = null;
let logVisible = false;

// DOM elements
const elements = {
  status: document.getElementById('status'),
  methods: document.getElementById('methods'),
  image: document.getElementById('captured-image'),
  title: document.getElementById('event-title'),
  startDate: document.getElementById('start-date'),
  startTime: document.getElementById('start-time'),
  endDate: document.getElementById('end-date'),
  endTime: document.getElementById('end-time'),
  allDay: document.getElementById('all-day'),
  location: document.getElementById('location'),
  ocrText: document.getElementById('ocr-text'),
  logText: document.getElementById('log-text'),
  logSection: document.getElementById('log-section'),
  addBtn: document.getElementById('add-to-calendar'),
  showLogBtn: document.getElementById('show-log'),
  configBtn: document.getElementById('config'),
  cancelBtn: document.getElementById('cancel'),
  errorMsg: document.getElementById('modal-error'),
  apiStatus: document.getElementById('api-status')
};

// Utilities
const z2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${z2(d.getMonth()+1)}-${z2(d.getDate())}`;
const fmtTime = d => `${z2(d.getHours())}:${z2(d.getMinutes())}`;
const rid = () => (crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));

function logMessage(msg) {
  try {
    const now = new Date().toLocaleTimeString();
    const line = `[${now}] ${msg}`;
    console.log('[T2C Modal]', line);
    if (elements.logText) {
      elements.logText.value = (line + '\n' + elements.logText.value).slice(0, 200000);
    }
  } catch {}
}

// Settings
async function getSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EC_GET_SETTINGS' });
    if (res?.ok) {
      logMessage(`Settings loaded: OCR=${res.settings.ocrMethod}, Parse=${res.settings.parseMethod}`);
      if (elements.methods) {
        elements.methods.textContent = `OCR: ${res.settings.ocrMethod} • Parse: ${res.settings.parseMethod}`;
      }
      return res.settings;
    }
  } catch (e) {
    logMessage(`Failed to get settings: ${e.message}`);
  }
  const fallback = { ocrMethod: 'tesseract', parseMethod: 'local' };
  if (elements.methods) {
    elements.methods.textContent = `OCR: ${fallback.ocrMethod} • Parse: ${fallback.parseMethod}`;
  }
  logMessage(`Using default settings: OCR=${fallback.ocrMethod}, Parse=${fallback.parseMethod}`);
  return fallback;
}

// API calls
async function runOcr(provider, dataUrl) {
  const requestId = rid();
  const res = await chrome.runtime.sendMessage({ type: 'EC_RUN_OCR', provider, dataUrl, requestId });
  if (!res?.ok) throw new Error(res?.error || 'OCR failed');
  if (res.requestId && res.requestId !== requestId) throw new Error('Stale OCR response');
  return res.text || '';
}

async function runParse(provider, text) {
  const requestId = rid();
  const res = await chrome.runtime.sendMessage({ type: 'EC_RUN_PARSE', provider, text, requestId });
  if (!res?.ok) throw new Error(res?.error || 'Parse failed');
  if (res.requestId && res.requestId !== requestId) throw new Error('Stale parse response');
  return res.result;
}

// Event handlers
elements.allDay.addEventListener('change', () => {
  const allDay = elements.allDay.checked;
  elements.startTime.disabled = allDay;
  elements.endTime.disabled = allDay;
  if (allDay) {
    elements.startTime.value = '';
    elements.endTime.value = '';
  }
});

elements.showLogBtn.addEventListener('click', () => {
  try {
    // toggle based on current computed display value to avoid mismatch
    const computed = window.getComputedStyle(elements.logSection).display;
    if (computed === 'none') {
      elements.logSection.style.display = 'block';
      elements.showLogBtn.textContent = 'Hide Log';
      logVisible = true;
    } else {
      elements.logSection.style.display = 'none';
      elements.showLogBtn.textContent = 'Show Log';
      logVisible = false;
    }
  } catch (e) {
    // fallback toggle
    logVisible = !logVisible;
    elements.logSection.style.display = logVisible ? 'block' : 'none';
    elements.showLogBtn.textContent = logVisible ? 'Hide Log' : 'Show Log';
  }
});

elements.configBtn?.addEventListener('click', () => {
  logMessage('Config button clicked, opening options page.');
  chrome.runtime.sendMessage({ type: 't2c.openOptions' });
});

elements.cancelBtn?.addEventListener('click', () => {
  logMessage('Cancel button clicked, closing window.');
  window.close();
});

elements.addBtn.addEventListener('click', () => {
  const title = elements.title.value || 'New Event';
  const location = elements.location.value || '';
  const allDay = elements.allDay.checked;
  const ocrText = elements.ocrText.value || '';
  
  // Create details with OCR text
  let details = 'Created by EventCapture';
  if (ocrText.trim()) {
    details += '\n' + ocrText;
  }

  let url = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  url += `&text=${encodeURIComponent(title)}&location=${encodeURIComponent(location)}&details=${encodeURIComponent(details)}`;

  if (allDay) {
    const s = elements.startDate.value;
    const e = elements.endDate.value || s;
    if (!s) {
      alert('Please set a start date for an all-day event');
      return;
    }
    const ed = new Date(e);
    ed.setDate(ed.getDate() + 1);
    const sd = s.replace(/-/g, '');
    const ee = `${ed.getFullYear()}${z2(ed.getMonth()+1)}${z2(ed.getDate())}`;
    url += `&dates=${sd}/${ee}`;
  } else {
    
    const sD = elements.startDate.value;
    const sT = elements.startTime.value;
    const eD = elements.endDate.value || sD;
    const eT = elements.endTime.value || sT;
    if (!sD || !sT) {
      alert('Please set start time, end date, and end time, or check "All-day"');
      return;
    }
    url += `&dates=${sD.replace(/-/g,'')}T${sT.replace(':','')}00/${eD.replace(/-/g,'')}T${eT.replace(':','')}00`;
  }
  
  window.open(url, '_blank');
});

// Main processing function
async function processImage(imageDataUrl) {
  logMessage('[DEBUG] processImage called');
  capturedImageData = imageDataUrl;
  logMessage(`[DEBUG] Received imageDataUrl: ${imageDataUrl ? imageDataUrl.substring(0, 40) + '...' : 'null'}`);
  if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
    logMessage('[ERROR] No valid image data provided to modal.');
    elements.status.textContent = 'No captured image found.';
    console.error('[T2C Modal][ERROR] processImage called with invalid imageDataUrl:', imageDataUrl);
    if (elements.errorMsg) elements.errorMsg.textContent = 'Error: No captured image found. Please try again.';
    return;
  }
  elements.image.src = imageDataUrl;
  logMessage('[DEBUG] Image src set.');
  elements.status.textContent = 'Processing…';
  if (elements.errorMsg) elements.errorMsg.textContent = '';
  logMessage('=== PROCESSING START ===');
  try {
    logMessage('[DEBUG] Retrieving settings...');
    const settings = await getSettings();
    logMessage(`[DEBUG] Settings: ${JSON.stringify(settings)}`);
    logMessage(`[DEBUG] Selected OCR method: ${settings.ocrMethod}`);
    logMessage(`[DEBUG] Selected parsing method: ${settings.parseMethod}`);

    // Style "Add to Calendar" button for processing state
    elements.addBtn.classList.remove('primary', 'btn-pulse');
    elements.addBtn.style.backgroundColor = '#ffffff';
    elements.addBtn.style.color = '#5f6368'; // Grey text

    // Show OCR status with model
    const ocrModelName = settings.ocrModel || 'default model';
    if (elements.apiStatus) elements.apiStatus.textContent = `OCRing with ${ocrModelName}...`;
    logMessage(`[DEBUG] Calling runOcr... (Provider: ${settings.ocrMethod}, Model: ${settings.ocrModel || 'default'})`);
    const text = await runOcr(settings.ocrMethod, imageDataUrl);
    logMessage(`[DEBUG] OCR result: ${text ? text.substring(0, 80) + '...' : 'null'}`);
    elements.ocrText.value = text;
    elements.ocrText.dispatchEvent(new Event('input')); // Trigger input event for button visibility
    logMessage(`[DEBUG] OCR completed. Extracted ${text.length} characters`);

    // Show Parse status with model
    const parseModelName = settings.parseModel || 'default model';
    if (elements.apiStatus) elements.apiStatus.textContent = `Parsing with ${parseModelName}...`;
    logMessage(`[DEBUG] Calling runParse... (Provider: ${settings.parseMethod}, Model: ${settings.parseModel || 'default'})`);
    const parsed = await runParse(settings.parseMethod, text);
    logMessage(`[DEBUG] Parsed result: ${JSON.stringify(parsed, null, 2)}`);

    // Clear API status
    if (elements.apiStatus) elements.apiStatus.textContent = '';

    // Use requestAnimationFrame to ensure the DOM is ready for updates, preventing race conditions.
    requestAnimationFrame(() => {
      elements.title.value = parsed.title || '';
      elements.location.value = (parsed.location || '').replace(/\r?\n/g, ', ');
      const sd = parsed.start ? new Date(parsed.start) : (parsed.startDate ? new Date(parsed.startDate) : null);
      const ed = parsed.end ? new Date(parsed.end) : (parsed.endDate ? new Date(parsed.endDate) : null);
      if (sd) {
        elements.startDate.value = fmtDate(sd);
        elements.startTime.value = fmtTime(sd);
      }
      if (ed) {
        elements.endDate.value = fmtDate(ed);
        elements.endTime.value = fmtTime(ed);
      }
      const allDay = parsed.hasTime === false;
      elements.allDay.checked = !!allDay;
      elements.allDay.dispatchEvent(new Event('change'));
      logMessage('[DEBUG] Form fields populated with parsed data.');
    });

    logMessage('=== PROCESSING COMPLETE ===');
    elements.status.textContent = 'Ready - review and click Add to Calendar';

    // Style "Add to Calendar" button for completion
    elements.addBtn.classList.add('primary', 'btn-pulse');
    elements.addBtn.style.backgroundColor = ''; // Revert to CSS default
    elements.addBtn.style.color = ''; // Revert to CSS default
  } catch (e) {
    logMessage('=== PROCESSING ERROR ===');
    logMessage(`[ERROR] ${e.message}`);
    elements.status.textContent = 'Processing failed - check log for details';
    if (elements.errorMsg) elements.errorMsg.textContent = `Error: ${e.message}`;
    if (elements.apiStatus) elements.apiStatus.textContent = '';
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[T2C Modal][DEBUG] onMessage received:', msg);
  if (msg.type === 'POPUP_PROCESS_IMAGE' && msg.imageDataUrl) {
    console.log('[T2C Modal][DEBUG] Received POPUP_PROCESS_IMAGE:', msg.imageDataUrl ? msg.imageDataUrl.substring(0, 80) + '...' : 'null');
    processImage(msg.imageDataUrl);
    // It's good practice to send a response to confirm receipt
    sendResponse({ ok: true });
  }
  return false;
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Add listeners for the new Log utility buttons
  const logClearBtn = document.getElementById('log-clear-btn');
  const logCopyBtn = document.getElementById('log-copy-btn');
  const logUtils = document.getElementById('log-utils');

  elements.logText.addEventListener('input', () => {
    if (logUtils) logUtils.style.visibility = elements.logText.value ? 'visible' : 'hidden';
  });
  logClearBtn?.addEventListener('click', () => {
    elements.logText.value = '';
    elements.logText.dispatchEvent(new Event('input'));
  });
  logCopyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.logText.value);
  });

  (async () => {
    const settings = await getSettings();
    console.log('[T2C Modal][DEBUG] Settings at DOMContentLoaded:', settings);
    // Debug log: show selected models and methods
    console.log('[T2C Modal][DEBUG] OCR method:', settings.ocrMethod, 'OCR model:', settings.ocrModel);
    console.log('[T2C Modal][DEBUG] Parse method:', settings.parseMethod, 'Parse model:', settings.parseModel);
    logMessage(`[DEBUG] OCR method: ${settings.ocrMethod}, OCR model: ${settings.ocrModel || '(none)'}`);
    logMessage(`[DEBUG] Parse method: ${settings.parseMethod}, Parse model: ${settings.parseModel || '(none)'}`);
    // If no API keys are present, open options so user can configure
    if (!settings.openaiKey && !settings.claudeKey && !settings.geminiKey && !settings.googleKey) {
      logMessage('No API keys found, opening options page.');
      elements.status.textContent = 'Configuration needed';
      if (elements.errorMsg) {
        elements.errorMsg.textContent = 'No API keys found. Please open settings to add a key.';
      }
      //chrome.runtime.sendMessage({ type: 't2c.openOptions' });
      return;
    }
    // Show selected methods and models
    const ocrModelStr = settings.ocrModel ? ` (${settings.ocrModel})` : '';
    const parseModelStr = settings.parseModel ? ` (${settings.parseModel})` : '';
    elements.methods.textContent = `OCR: ${settings.ocrMethod}${ocrModelStr} • Parse: ${settings.parseMethod}${parseModelStr}`;

    // Signal to background script that the modal is ready to receive the image
    logMessage('Modal is ready, signaling to background script.');
    chrome.runtime.sendMessage({ type: 'POPUP_READY' });
  })();
});