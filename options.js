// options.js – no aesthetic changes. Test screen auto-loads from URL

(function () {
  const $ = (id) => document.getElementById(id);

  // --- Defaults & constants (UI unchanged) ---
  const TEST_IMAGE_URL = 'https://politics-prose.com/sites/default/files/2024-12/06-adams-miller.png';
  const FALLBACK_INLINE_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yf3iK4AAAAASUVORK5CYII=';
  const DEFAULT_TEST_TEXT =
    "Let's meet to review the launch plan tomorrow at 2:30 PM in Conference Room 4.";

  // Provider → required key element id (disables radios if missing)
  const API_REQUIREMENTS = {
    // OCR
    'openai-vision': 'openai-key',
    'gemini-vision': 'gemini-key',
    'google-vision': 'google-key',
    'claude-vision': 'claude-key',
    // Parser
    'openai': 'openai-key',
    'gemini': 'gemini-key',
    'claude': 'claude-key',
  };

  // --- Key validation status ---
  let keyValidationStatus = {
    openai: false,
    gemini: false,
    claude: false,
    google: false,
  };
  // --- Local state ---
  let testImageDataUrl = null;
  // cached model choices saved to storage (filled when user selects providers)
  let cachedModels = {
    openaiModel: '',
    geminiModel: ''
  };

  // --- Logger (prepend latest) ---
  function log(msg, isError = false) {
    const el = $('diagLog');
    if (!el) return;
    const timestamp = new Date().toLocaleTimeString();
    const prefix = isError ? '❌ ERROR:' : '✅';
    el.textContent = `[${timestamp}] ${prefix} ${msg}\n` + el.textContent;
  }

  // --- Check if NO keys are present ---
  function hasNoKeys() {
    const keys = {
      'openai-key': $('openai-key')?.value || '',
      'claude-key': $('claude-key')?.value || '',
      'gemini-key': $('gemini-key')?.value || '',
      'google-key': $('google-key')?.value || '',
    };
    return !keys['openai-key'] && !keys['claude-key'] && !keys['gemini-key'] && !keys['google-key'];
  }

  // --- Update key hints visibility ---
  function updateKeyHints() {
    const noKeys = hasNoKeys();
    const topHint = $('api-key-hint');
    if (topHint) topHint.style.display = noKeys ? 'block' : 'none';
  }

  // --- Update helper text for OCR and Parse sections ---
  function updateHelperText() {
    const validKeyCount = Object.values(keyValidationStatus).filter(v => v).length;
    const ocrHelper = $('ocr-helper-text');
    const parseHelper = $('parse-helper-text');

    if (validKeyCount === 0) {
      if (ocrHelper) ocrHelper.textContent = 'Fill in at least one API key above to enable OCR providers';
      if (parseHelper) parseHelper.textContent = 'Fill in at least one API key above to enable parsing providers';
      return;
    }

    // Helper for OCR section
    if (ocrHelper) {
      const enabledRows = document.querySelectorAll('#ocr-method-options .provider-row:not(.disabled)');
      const unpopulated = Array.from(enabledRows).some(row => row.querySelector('.model-select')?.options.length <= 1);

      let text = '';
      if (enabledRows.length > 1) {
        text += 'Choose a provider';
      }
      if (unpopulated) {
        text += (text ? ', then ' : '') + 'click Load Models';
      } else {
        text += (text ? ' and ' : '') + 'choose a model';
      }
      ocrHelper.textContent = text;
    }

    // Helper for Parse section
    if (parseHelper) {
      const enabledRows = document.querySelectorAll('#parse-method-options .provider-row:not(.disabled)');
      const unpopulated = Array.from(enabledRows).some(row => row.querySelector('.model-select')?.options.length <= 1);

      let text = '';
      if (enabledRows.length > 1) {
        text += 'Choose a provider';
      }
      if (unpopulated) {
        text += (text ? ', then ' : '') + 'click Load Models';
      } else {
        text += (text ? ' and ' : '') + 'choose a model';
      }
      parseHelper.textContent = text;
    }
  }

  // Helper to create a model select dropdown next to each provider group
  function ensureModelSelect(containerId, providerKey) {
    const container = $(containerId);
    if (!container) return null;
    // create wrapper area if not present
    let sel = container.querySelector('.model-select');
    if (!sel) {
      sel = document.createElement('select');
      sel.className = 'model-select';
      sel.style.marginLeft = '8px';
      sel.disabled = true;
      container.append(sel);
    }
    return sel;
  }

  // Small test payloads for verifying models per provider category
  const VERIFY_PAYLOADS = {
    'openai-vision': (dataUrl) => ({ model: 'placeholder', messages: [{ role: 'user', content: [{ type: 'text', text: 'Test' }, { type: 'image_url', image_url: { url: dataUrl } }] }], max_tokens: 10 }),
    'openai': (text) => ({ model: 'placeholder', messages: [{ role: 'user', content: 'Test' }], max_tokens: 10 }),
    'gemini-vision': (dataUrl) => ({ contents: [{ parts: [{ text: 'Test' }, { inline_data: { mime_type: 'image/png', data: dataUrl.split(',')[1] } }] }] }),
    'gemini': (text) => ({ contents: [{ parts: [{ text: 'Test' }] }], generationConfig: { response_mime_type: 'text/plain' } }),
  };

  // Verify a candidate model for a given provider by doing a minimal call (returns true if call succeeds)
  // verifyModelCandidate now returns an object { ok: bool, reason?: string, detail?: any }
  async function verifyModelCandidate(provider, modelName, credentials) {
    try {
      if (provider === 'openai' || provider === 'openai-vision') {
        const endpoint = 'https://api.openai.com/v1/chat/completions';
        // Use the loaded test image if available; otherwise fall back to the inline tiny PNG
        const imageData = testImageDataUrl || FALLBACK_INLINE_PNG;
        log(`Using ${testImageDataUrl ? 'loaded test image' : 'fallback image'} for OpenAI verification (size ${imageData.length} chars)`);
        const body = VERIFY_PAYLOADS[provider](imageData);
        body.model = modelName;
        log(`Verifying OpenAI model ${modelName} via ${endpoint}`);
        const resp = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${credentials.openaiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let data;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (resp.ok && data && data.choices && data.choices.length > 0) {
          return { ok: true, detail: data };
        }
        // include server message if present
        const reason = data && data.error ? JSON.stringify(data.error) : `HTTP ${resp.status}`;
        return { ok: false, reason, detail: data };
      }

      if (provider === 'gemini' || provider === 'gemini-vision') {
        const endpointBase = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent`;
        if (!modelName.startsWith('models/')) modelName = 'models/' + modelName; // Add prefix for API call
        const imageData = testImageDataUrl || FALLBACK_INLINE_PNG;
        log(`Using ${testImageDataUrl ? 'loaded test image' : 'fallback image'} for Gemini verification (size ${imageData.length} chars)`);
        const body = VERIFY_PAYLOADS[provider](imageData);
        log(`Verifying Gemini model ${modelName} via ${endpointBase}`);
        const resp = await fetch(`${endpointBase}?key=${encodeURIComponent(credentials.geminiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let data, rawText;
        try { rawText = await resp.text(); data = JSON.parse(rawText); } catch (e) { data = null; }
        log(`[GEMINI DEBUG] Response status: ${resp.status}`);
        log(`[GEMINI DEBUG] Response body: ${rawText}`);
        if (resp.ok && data && (data.candidates && data.candidates.length > 0 || data.output)) {
          return { ok: true, detail: data };
        }
        const reason = data && data.error ? JSON.stringify(data.error) : `HTTP ${resp.status}`;
        return { ok: false, reason, detail: data };
      }

      return { ok: false, reason: 'Unknown provider' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // --- Fetch and store model id for a given provider when user selects it ---
  async function fetchAndStoreModelForProvider(provider) {
    // provider values: 'openai', 'openai-vision', 'gemini', 'gemini-vision'
    try {
      if (provider.startsWith('openai')) {
        const key = ($('openai-key')?.value || '').trim();
        if (!key) {
          log('OpenAI key not present; cannot fetch models.', true);
          return;
        }
        log('Fetching OpenAI models list...');
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` }
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(JSON.stringify(data));
        const ids = Array.isArray(data.data) ? data.data.map(m => m.id) : [];
        // filter out preview/audio/tts/whisper/transcribe
        const filtered = ids.filter(id => !/(preview|audio|tts|whisper|transcribe)/i.test(id));
        const preferred = ['gpt-4o-mini', 'gpt-4o', 'gpt-4o-mini-2024', 'gpt-4o-mini-2025'];
        let chosen = filtered.find(id => preferred.includes(id)) || filtered[0] || '';
        if (!chosen) log('No suitable OpenAI model found from API response.', true);
        else log('Selected OpenAI model: ' + chosen);
        cachedModels.openaiModel = chosen;
        await chrome.storage.sync.set({ openaiModel: chosen });
        return chosen;
      }

      if (provider.startsWith('gemini')) {
        const key = ($('gemini-key')?.value || '').trim();
        if (!key) {
          log('Gemini key not present; cannot fetch models.', true);
          return;
        }
        log('Scraping Gemini model codes from https://ai.google.dev/gemini-api/docs/models ...');
        try {
          const resp = await fetch('https://ai.google.dev/gemini-api/docs/models');
          const html = await resp.text();
          // Extract model codes like gemini-2.5-pro, gemini-2.5-flash, etc.
          const modelRegex = /gemini-[\d.]+-(pro|flash|flash-lite)/g;
          const found = Array.from(new Set([...html.matchAll(modelRegex)].map(m => m[0])));
          const items = found.map(m => `models/${m}`);
          log(`Gemini models scraped: ${items.join(', ')}`);
          const preferred = ['models/gemini-2.5-flash', 'models/gemini-2.5-pro', 'models/gemini-2.5-flash-lite', 'models/gemini-2.0-flash', 'models/gemini-2.0-flash-lite'];
          let chosen = items.find(n => preferred.includes(n)) || items[0] || '';
          if (!chosen) log('No suitable Gemini model found from scraping.', true);
          else log('Selected Gemini model: ' + chosen);
          cachedModels.geminiModel = chosen;
          await chrome.storage.sync.set({ geminiModel: chosen });
          return chosen;
        } catch (e) {
          log('Failed to scrape Gemini models: ' + e.message, true);
        }
      }
    } catch (e) {
      log('Failed to fetch models for ' + provider + ': ' + e.message, true);
    }
  }

  // --- Enable/disable provider radios based on keys present ---
  function updateAllOptionStates() {
    const keys = {
      'openai-key': $('openai-key')?.value.trim() || '',
      'claude-key': $('claude-key')?.value.trim() || '',
      'gemini-key': $('gemini-key')?.value.trim() || '',
      'google-key': $('google-key')?.value.trim() || '',
    };

    // For each provider row, enable/disable radio, load button, dropdown based on key validity
    document.querySelectorAll('.provider-row').forEach((row) => {
      const radio = row.querySelector('input[type="radio"]');
      const loadBtn = row.querySelector('.load-btn');
      const modelSel = row.querySelector('.model-select');
      if (!radio || !loadBtn || !modelSel) return;

      const requiredKeyId = API_REQUIREMENTS[radio.value];
      // If key is present, check if it passes validation
      const providerName = radio.value.split('-')[0]; // 'openai', 'gemini', etc.
      const hasKey = keyValidationStatus[providerName];

      radio.disabled = !hasKey;
      loadBtn.disabled = radio.disabled; // Match the radio button's enabled state
      modelSel.disabled = radio.disabled || modelSel.options.length <= 1;

      row.classList.toggle('disabled', !hasKey);
      radio.parentElement?.classList.toggle('disabled', !hasKey);
    });
    updateKeyHints();
    updateHelperText();
    autoSelectSingleProvider();
  }

  // --- Auto-select provider if only one is available ---
  function autoSelectSingleProvider() {
    // Auto-select for OCR if only one provider is enabled
    const ocrRadios = document.querySelectorAll('input[name="ocrMethod"]:not(:disabled)');
    if (ocrRadios.length === 1 && !ocrRadios[0].checked) {
      ocrRadios[0].checked = true;
    }

    // Auto-select for Parse if only one provider is enabled
    const parseRadios = document.querySelectorAll('input[name="parseMethod"]:not(:disabled)');
    if (parseRadios.length === 1 && !parseRadios[0].checked) {
      parseRadios[0].checked = true;
    }

    // Update selection info display
    updateCurrentSelectionInfo();
  }

  // --- Update current selection info display ---
  function updateCurrentSelectionInfo() {
    const ocrInfoEl = $('current-ocr-info');
    const parseInfoEl = $('current-parse-info');

    if (!ocrInfoEl || !parseInfoEl) return;

    // Get selected OCR provider and model
    const selectedOcrRadio = document.querySelector('input[name="ocrMethod"]:checked');
    if (selectedOcrRadio) {
      const ocrRow = selectedOcrRadio.closest('.provider-row');
      const ocrModelSelect = ocrRow?.querySelector('.model-select');
      const providerName = selectedOcrRadio.parentElement.textContent.trim();
      const modelName = ocrModelSelect?.value || 'No model selected';

      if (modelName && modelName !== '' && modelName !== '- Select -') {
        ocrInfoEl.textContent = `${providerName} - ${modelName}`;
        ocrInfoEl.style.color = 'var(--success)';
      } else {
        ocrInfoEl.textContent = `${providerName} (select a model)`;
        ocrInfoEl.style.color = 'var(--warning)';
      }
    } else {
      ocrInfoEl.textContent = 'None selected';
      ocrInfoEl.style.color = 'var(--text-secondary)';
    }

    // Get selected Parse provider and model
    const selectedParseRadio = document.querySelector('input[name="parseMethod"]:checked');
    if (selectedParseRadio) {
      const parseRow = selectedParseRadio.closest('.provider-row');
      const parseModelSelect = parseRow?.querySelector('.model-select');
      const providerName = selectedParseRadio.parentElement.textContent.trim();
      const modelName = parseModelSelect?.value || 'No model selected';

      if (modelName && modelName !== '' && modelName !== '- Select -') {
        parseInfoEl.textContent = `${providerName} - ${modelName}`;
        parseInfoEl.style.color = 'var(--success)';
      } else {
        parseInfoEl.textContent = `${providerName} (select a model)`;
        parseInfoEl.style.color = 'var(--warning)';
      }
    } else {
      parseInfoEl.textContent = 'None selected';
      parseInfoEl.style.color = 'var(--text-secondary)';
    }
  }

  // --- Build option/test radio groups without changing aesthetics ---
  function createOptions(containerId, groupName, options, onChoose) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = '';
    options.forEach((opt) => {
      const label = document.createElement('label');
      label.className = 'provider-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = opt.value;
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.append(input, span);
      // attach a model select placeholder next to each option label
      const modelSel = document.createElement('select');
      modelSel.className = 'model-select';
      modelSel.style.marginLeft = '8px';
      modelSel.disabled = true;
      label.append(modelSel);
      container.append(label);

      if (onChoose) {
        label.addEventListener('click', async (e) => {
          if (input.disabled) {
            e.preventDefault();
            return;
          }
          // Run onChoose and then attempt to lookup/store model if provider is an AI one
          onChoose(opt.value);
          // Trigger model discovery and verification for AI providers so we cache usable model ids
          if (opt.value.startsWith('openai') || opt.value.startsWith('gemini')) {
            // fetch list and then verify each candidate, populate the model-select with passing ones
            await discoverAndPopulateModels(opt.value, label.querySelector('.model-select'));
          }
        });
      }
    });
  }

  // --- Build per-provider rows: radio, Load Models button, model select, Test button ---
  function createProviderRows(containerId, groupName, options, onChoose, isOcr) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = '';
    // force stacked rows (not grid) for clear readable rows
    container.style.display = 'block';
    container.style.padding = '6px 0';
    options.forEach((opt) => {
      const row = document.createElement('div');
      row.className = 'provider-row';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.margin = '8px 0';

      const label = document.createElement('label');
      label.className = 'provider-option';
      label.style.flex = '0 0 auto';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = opt.value;
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.append(input, span);

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-outline btn-small load-btn';
      loadBtn.textContent = 'Load Models';
      loadBtn.style.minWidth = '110px';
      loadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        loadBtn.disabled = true;
        let origLabel = loadBtn.textContent;
        loadBtn.textContent = 'Loading...';
        await discoverAndPopulateModels(opt.value, row.querySelector('.model-select'));
        loadBtn.disabled = false;
        loadBtn.textContent = origLabel;
      });

  const modelSel = document.createElement('select');
  modelSel.className = 'model-select';
  modelSel.disabled = true;
  modelSel.style.minWidth = '340px';
  // placeholder option until models are loaded
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '- Select -';
  placeholderOpt.selected = true;
  placeholderOpt.disabled = true;
  modelSel.append(placeholderOpt);

      const testBtn = document.createElement('button');
      testBtn.className = 'btn btn-outline btn-small test-btn';
      testBtn.style.minWidth = '110px';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const modelSel = row.querySelector('.model-select');
        const modelName = modelSel ? modelSel.value : '';
        if (!modelName) {
          log(`No model selected for ${opt.label}. Please select a model before testing.`, true);
          return;
        }

        const btn = e.target;
        btn.disabled = true;
        btn.classList.add('flashing');
        btn.textContent = 'Testing...';
        btn.classList.remove('success', 'error');

        if (isOcr) {
          await runOcrTest(opt.value, modelName, btn);
        } else {
          await runParserTest(opt.value, modelName, btn);
        }

        // The run*Test functions now handle the button state updates
      });

      // clicking label checks radio and triggers onChoose
      label.addEventListener('click', (e) => {
        if (input.disabled) { e.preventDefault(); return; }
        input.checked = true;
        if (onChoose) onChoose(opt.value);
      });

      row.append(label, loadBtn, modelSel, testBtn);
      container.append(row);
    });
  }

  // Discover candidate models and populate the select with only verified ones
  async function discoverAndPopulateModels(provider, selectEl, progressEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    selectEl.disabled = true;
    if (progressEl) progressEl.textContent = 'Discovering models...';
    log(`Discovering models for ${provider}...`);
    try {
      const creds = {
        openaiKey: $('openai-key')?.value || '',
        geminiKey: $('gemini-key')?.value || ''
      };
      let candidates = [];
      if (provider.startsWith('openai')) {
        if (progressEl) progressEl.textContent = 'Fetching OpenAI models...';
        const resp = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${creds.openaiKey}` } });
        const data = await resp.json();
        if (!resp.ok) {
          log(`OpenAI model-list fetch failed: HTTP ${resp.status} - ${JSON.stringify(data)}`, true);
          if (progressEl) progressEl.textContent = 'Error fetching models';
        }
        const ids = Array.isArray(data.data) ? data.data.map(m => m.id) : [];
        // Filter out models not suitable for text/vision generation.
        const openAiFilter = /(^o\d-|-instruct|whisper|tts|audio|transcribe|realtime|dall-e|babbage|moderation|embed|codex|sora|davinci|search|image)/i;
        candidates = ids.filter(id => !openAiFilter.test(id));
        log(`OpenAI models fetched: ${ids.length} total, ${candidates.length} candidate(s) after filtering`);
        if (candidates.length > 0) log(`Sample candidates: ${candidates.slice(0,5).join(', ')}`);
        if (progressEl) progressEl.textContent = `Found ${candidates.length} models`;
      }

      if (provider.startsWith('claude')) {
        if (progressEl) progressEl.textContent = 'Fetching Claude models...';
        log('[T2C DEBUG] Calling Anthropic /v1/models endpoint.');
        try {
          const claudeKey = ($('claude-key')?.value || '').trim();
          if (!claudeKey) throw new Error('Claude API key not provided.');

          const resp = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': claudeKey,
              'anthropic-version': '2023-06-01',
            },
          });

          const data = await resp.json();
          log(`[T2C DEBUG] Anthropic /v1/models response: ${JSON.stringify(data, null, 2)}`);

          if (!resp.ok) {
            const err = data.error || { message: `HTTP ${resp.status}` };
            throw new Error(err.message);
          }

          candidates = data.data.map(model => model.id);
          log(`Found ${candidates.length} Claude models.`);
          if (progressEl) progressEl.textContent = `Found ${candidates.length} models`;

        } catch (e) {
          log(`Failed to fetch Claude models: ${e.message}`, true);
          if (progressEl) progressEl.textContent = 'Error fetching models';
          candidates = []; // Ensure no models are shown on failure
        }
      }

      if (provider.startsWith('gemini')) {
        if (progressEl) progressEl.textContent = 'Fetching Gemini models...';
        log('Scraping Gemini models from https://ai.google.dev/gemini-api/docs/models ...');
        try {
          const resp = await fetch('https://ai.google.dev/gemini-api/docs/models');
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const html = await resp.text();
          // This regex finds 'gemini-...' model names. It handles names inside `<code>` tags
          // and also finds them inside text content, which is useful for <pre><code> blocks.
          // It correctly captures models like 'gemini-pro' and 'gemini-1.5-pro-latest'.
          const modelRegex = /gemini-[\d.]+-[\w-]+|gemini-pro-vision|gemini-pro/g;
          const found = [...new Set(html.match(modelRegex) || [])];

          // Apply context-specific filters
          if (provider === 'gemini-vision') {
            // For vision, filter out text-only 'gemma' models and other non-vision types
            candidates = found.filter(m => !/(^gemma|embed|audio|tts|live)/.test(m));
            candidates = found.filter(m => !/(^gemma|embed|audio|tts|live|image-generation)/.test(m));
          } else { // 'gemini' (text parsing)
            candidates = found.filter(m => !/(-vision|embed|audio|tts|live)/.test(m));
            candidates = found.filter(m => !/(-vision|embed|audio|tts|live|image-generation)/.test(m));
          }
          log(`Gemini models scraped: ${candidates.length} found. Samples: ${candidates.slice(0, 5).join(', ')}`);
          if (progressEl) progressEl.textContent = `Found ${candidates.length} models`;
        } catch (e) {
          log('Failed to scrape Gemini models: ' + e.message, true);
          // Fallback to a small, known list if scraping fails
          candidates = ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];
          log(`Using fallback Gemini models: ${candidates.join(', ')}`);
          if (progressEl) progressEl.textContent = `Using ${candidates.length} fallback models`;
        }
      }

      // ensure test image is available for vision verifications to avoid empty-base64 errors
      if (provider.includes('vision') && !testImageDataUrl) {
        log('No test image loaded yet – loading the test image now for verification...');
        try {
          await loadImageFromUrl(TEST_IMAGE_URL);
        } catch (e) {
          log('Failed to load test image before verification: ' + e.message, true);
        }
      }

      // verify each candidate and populate select with passing ones; log detailed reasons for failures
      // Save the full model list for this provider (for restore)
      // We will now skip verification and just populate the list. The "Test" button can be used for verification.
      const modelListKey = provider + 'ModelList';
      const modelList = candidates.map(c => c.startsWith('models/') ? c.substring(7) : c); // Strip 'models/' for storage consistency
      await chrome.storage.sync.set({ [modelListKey]: modelList });

      for (const c of candidates) {
        const opt = document.createElement('option');
        // For Gemini, the scraped value is what we use. For others, it might have a prefix.
        const modelValue = c.startsWith('models/') ? c.substring(7) : c;
        opt.value = modelValue;
        opt.textContent = modelValue;
        selectEl.append(opt);
      }
      if (selectEl.options.length > 0) {
        selectEl.disabled = false;
        // set previously saved model as selected if present
        // Save and restore selected model for OCR and Parse
        let modelKey;
        if (provider.includes('vision')) {
          modelKey = 'ocrModel';
        } else {
          modelKey = 'parseModel';
        }
        const stored = await chrome.storage.sync.get([modelKey]);
        const savedModel = stored[modelKey];
        if (savedModel) {
          const opt = Array.from(selectEl.options).find(o => o.value === savedModel);
          if (opt) selectEl.value = savedModel;
        }
        log(`Models loaded for ${provider}.`);
        if (progressEl) progressEl.textContent = 'Select model and test';
      } else {
        log(`No models found for ${provider}.`, true);
        if (progressEl) progressEl.textContent = 'No models found';
      }
      // Update helper text after models are loaded
      updateHelperText();
    } catch (e) {
      log(`Model discovery failed for ${provider}: ${e.message}`, true);
      if (progressEl) progressEl.textContent = 'Error: ' + e.message;
      updateHelperText();
    }
  }

  // --- Image handling for the OCR test panel ---
  function setTestImage(dataUrl) {
    testImageDataUrl = dataUrl;
    const preview = $('ocr-image-preview');
    const placeholder = $('ocr-image-placeholder');
    if (preview && placeholder) {
      preview.src = dataUrl;
      placeholder.style.display = 'none';
      preview.style.display = 'block';
    }
  }

  async function handlePastedImage(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => {
          setTestImage(event.target.result);
          log('Image pasted successfully.');
        };
        reader.onerror = () => log('Failed to read pasted image.', true);
        reader.readAsDataURL(blob);
        return;
      }
    }
  }

  // --- Local Tesseract helpers (unchanged features) ---
  async function testLocalOCR() {
    log('Checking local Tesseract OCR assets...');
    const requiredFiles = [
      'tesseract/worker.min.js',
      'tesseract/eng.traineddata.gz',
      'tesseract/tesseract-core.wasm.js',
    ];
    let allGood = true;
    for (const file of requiredFiles) {
      try {
        const response = await fetch(chrome.runtime.getURL(file), { method: 'HEAD' });
        if (response.ok) log(`✓ ${file} - OK`);
        else {
          log(`✗ ${file} - ${response.status}`, true);
          allGood = false;
        }
      } catch (error) {
        log(`✗ ${file} - ERROR: ${error.message}`, true);
        allGood = false;
      }
    }
    if (allGood) log('All critical Tesseract files seem to be present.');
  }

  async function downloadTesseractBundle() {
    log('Sending download requests for Tesseract bundle...');
    if (!chrome.downloads) {
      log('chrome.downloads API not available.', true);
      return;
    }
    const assets = [
      { url: 'https://unpkg.com/tesseract.js@4.0.4/dist/tesseract.min.js', filename: 'tesseract/tesseract.min.js' },
      { url: 'https://unpkg.com/tesseract.js@4.0.4/dist/worker.min.js', filename: 'tesseract/worker.min.js' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core.wasm.js', filename: 'tesseract/tesseract-core.wasm.js' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core-simd.wasm.js', filename: 'tesseract/tesseract-core-simd.wasm.js' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core.wasm', filename: 'tesseract/tesseract-core.wasm' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core-simd.wasm', filename: 'tesseract/tesseract-core-simd.wasm' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/eng.traineddata.gz', filename: 'tesseract/eng.traineddata.gz' },
    ];
    for (const asset of assets) {
      try {
        await chrome.downloads.download({ url: asset.url, filename: asset.filename });
        log(`Downloading: ${asset.filename}`);
      } catch (error) {
        log(`Failed to download ${asset.filename}: ${error.message}`, true);
      }
    }
  }

  // --- Test runners talk to background (centralized API is there) ---
  async function runOcrTest(provider, modelName, btn) {
    if (!testImageDataUrl) {
      log('No image loaded for the OCR test.', true);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Testing...';
      btn.classList.remove('success', 'error');
    }

    const resultBox = document.getElementById('ocr-result');
    if (resultBox) {
      resultBox.value = '';
      resultBox.disabled = true;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DIAG_TEST_OCR',
        provider,
        model: modelName,
        dataUrl: testImageDataUrl,
      });

      log(`Requesting background script to test OCR with: ${provider} (model: ${modelName || 'none'})`);

      if (response && response.ok) {
        if (response.debug) {
          const { payload, ...restOfDebug } = response.debug;
          log('OCR request debug: ' + JSON.stringify(restOfDebug, null, 2));
        }
        log(`OCR test success for ${provider} (model: ${modelName}). Extracted ${response.text.length} chars.`);
        if (resultBox) resultBox.value = response.text;
        if (btn) {
          btn.textContent = 'Success';
          btn.classList.add('success');
        }
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (e) {
      log(`OCR test FAILED for ${provider} (model: ${modelName}): ${e.message}`, true);
      if (resultBox) resultBox.value = 'ERROR: ' + e.message;
      if (btn) {
        btn.textContent = 'Error';
        btn.classList.add('error');
      }
    } finally {
      if (resultBox) {
        resultBox.disabled = false;
      }
      if (btn) {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Test';
          btn.classList.remove('success', 'error');
        }, 3000);
      }
    }
  }

  async function runParserTest(provider, modelName, btn) {
    const textToParse = document.getElementById('parser-input')?.value || '';
    const resultBox = document.getElementById('parser-result');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Testing...';
      btn.classList.remove('success', 'error');
    }

    if (resultBox) {
      resultBox.value = '';
      resultBox.disabled = true;
    }

    if (!textToParse) {
      log('No text in the input box to parse.', true);
      if (resultBox) resultBox.value = 'ERROR: No text to parse.';
      if (btn) {
        btn.textContent = 'Error';
        btn.classList.add('error');
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Test';
          btn.classList.remove('success', 'error');
        }, 3000);
      }
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DIAG_TEST_PARSE',
        provider,
        model: modelName,
        text: textToParse,
      });

      if (response && response.ok) {
        log(`Parser test success for ${provider} (model: ${modelName}):`);
        if (response.debug) {
          const { payload, ...restOfDebug } = response.debug;
          log('Parser request debug: ' + JSON.stringify(restOfDebug, null, 2));
        }
        log(JSON.stringify(response.result, null, 2));
        if (resultBox) resultBox.value = JSON.stringify(response.result, null, 2);
        if (btn) {
          btn.textContent = 'Success';
          btn.classList.add('success');
        }
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (e) {
      log(`Parser test FAILED for ${provider} (model: ${modelName}): ${e.message}`, true);
      if (resultBox) resultBox.value = 'ERROR: ' + e.message;
      if (btn) {
        btn.textContent = 'Error';
        btn.classList.add('error');
      }
    } finally {
      if (resultBox) {
        resultBox.disabled = false;
      }
      if (btn) {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Test';
          btn.classList.remove('success', 'error');
        }, 3000);
      }
    }
  }


  // --- Save/load configuration (unchanged behavior) ---
  // --- Key validation helpers ---
  function validateKey(key, value) {
    if (!value) return { valid: false, error: 'Required' };
    if (key === 'openai-key' && !/^sk-/.test(value)) return { valid: false, error: 'Must start with sk-' };
    if (key === 'gemini-key' && !/^AIza/.test(value)) return { valid: false, error: 'Must start with AIza' };
    if (key === 'claude-key' && !/^sk-ant-/.test(value)) return { valid: false, error: 'Must start with sk-ant-' };
    if (key === 'google-key' && !/^AIza/.test(value)) return { valid: false, error: 'Must start with AIza' };
    return { valid: true };
  }

  function showKeyError(key, msg) {
    let err = document.getElementById(key + '-error');
    if (!err) {
      const input = $(key);
      err = document.createElement('span');
      err.id = key + '-error';
      err.className = 'key-hint';
      err.style.marginLeft = '8px';
      input?.parentElement?.appendChild(err);
    }
    err.textContent = msg;
    err.style.display = 'inline';
  }
  function clearKeyError(key) {
    const err = document.getElementById(key + '-error');
    if (err) err.style.display = 'none';
  }

  async function validateApiKeys() {
    const saveBtn = $('save-config-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Validating...';
    saveBtn.disabled = true;

    const keys = {
      openai: $('openai-key')?.value.trim(),
      claude: $('claude-key')?.value.trim(),
      gemini: $('gemini-key')?.value.trim(),
      google: $('google-key')?.value.trim(),
    };

    // Reset status
    keyValidationStatus = { openai: false, gemini: false, claude: false, google: false };

    // OpenAI
    if (keys.openai) {
      try {
        const resp = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${keys.openai}` } });
        if (resp.ok) {
          keyValidationStatus.openai = true;
          log('OpenAI key is valid.');
          clearKeyError('openai-key');
        } else {
          const err = await resp.json();
          throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
      } catch (e) {
        showKeyError('openai-key', `Validation failed: ${e.message}`);
      }
    }

    // Gemini
    if (keys.gemini) {
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keys.gemini}`);
        if (resp.ok) {
          keyValidationStatus.gemini = true;
          log('Gemini key is valid.');
          clearKeyError('gemini-key');
        } else {
          const err = await resp.json();
          throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
      } catch (e) {
        showKeyError('gemini-key', `Validation failed: ${e.message}`);
      }
    }

    // Claude
    if (keys.claude) {
      try {
        // A successful call to the /v1/models endpoint is the most reliable way to validate a key.
        const resp = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': keys.claude, 'anthropic-version': '2023-06-01' },
        });
        if (resp.ok) {
          keyValidationStatus.claude = true;
          log('Claude key is valid.');
          clearKeyError('claude-key');
        } else {
          const err = await resp.json();
          throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
      } catch (e) {
        showKeyError('claude-key', `Validation failed: ${e.message}`);
      }
    }

    // Google Vision
    if (keys.google) {
      try {
        const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${keys.google}`);
        // Google Vision returns 400 for empty request, but 403 for bad key.
        if (resp.status !== 403) {
          keyValidationStatus.google = true;
          log('Google Cloud Vision key appears valid.');
          clearKeyError('google-key');
        } else {
          throw new Error('Invalid API key');
        }
      } catch (e) {
        showKeyError('google-key', `Validation failed: ${e.message}`);
      }
    }

    updateAllOptionStates();
    saveBtn.textContent = originalText;
    // The button remains enabled for further changes.
  }

  async function saveMethodSelections() {
    const ocrMethod = document.querySelector('input[name="ocrMethod"]:checked')?.value;
    const parseMethod = document.querySelector('input[name="parseMethod"]:checked')?.value;
    const ocrRow = document.querySelector(`.provider-row input[value="${ocrMethod}"]`)?.closest('.provider-row');
    const ocrModel = ocrRow?.querySelector('.model-select')?.value || '';
    const parseRow = document.querySelector(`.provider-row input[value="${parseMethod}"]`)?.closest('.provider-row');
    const parseModel = parseRow?.querySelector('.model-select')?.value || '';

    await chrome.storage.sync.set({
      ocrMethod,
      parseMethod,
      ocrModel,
      parseModel,
    });
    log(`Saved method selections: OCR=${ocrMethod} (${ocrModel}), Parse=${parseMethod} (${parseModel})`);
    const statusEl = $('methodSaveStatus');
    if (statusEl) {
      statusEl.textContent = '✅ Methods Saved!';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }
  }

  async function saveConfiguration() {
    // Validate all keys
    const keys = ['openai-key', 'gemini-key', 'claude-key', 'google-key'];
    let hasError = false;
    for (const key of keys) {
      const val = $(key)?.value.trim() || '';
      const v = validateKey(key, val);
      if (!v.valid && val) {
        showKeyError(key, v.error);
        hasError = true;
      } else {
        clearKeyError(key);
      }
    }
    if (hasError) {
      const statusEl = $('saveStatus');
      if (statusEl) {
        statusEl.textContent = '❌ Please fix errors above.';
        setTimeout(() => { statusEl.textContent = ''; }, 4000);
      }
      log('Validation failed: fix API key errors.', true);
      return;
    }

    try {
      const ocrMethod = document.querySelector('input[name="ocrMethod"]:checked')?.value;
      const parseMethod = document.querySelector('input[name="parseMethod"]:checked')?.value;
      // Get selected models from dropdowns
      const ocrRow = document.querySelector(`.provider-row input[value="${ocrMethod}"]`)?.closest('.provider-row');
      const ocrModel = ocrRow?.querySelector('.model-select')?.value || '';
      const parseRow = document.querySelector(`.provider-row input[value="${parseMethod}"]`)?.closest('.provider-row');
      const parseModel = parseRow?.querySelector('.model-select')?.value || '';
      log(`[SAVE] OCR: method=${ocrMethod}, model=${ocrModel}`);
      log(`[SAVE] Parse: method=${parseMethod}, model=${parseModel}`);
      const config = {
        ocrMethod,
        parseMethod,
        openaiKey: $('openai-key')?.value.trim() || '',
        claudeKey: $('claude-key')?.value.trim() || '',
        geminiKey: $('gemini-key')?.value.trim() || '',
        googleKey: $('google-key')?.value.trim() || '',
      };
      await chrome.storage.sync.set(config);
      // Also save selected models for OCR and Parse
      await validateApiKeys();

      await chrome.storage.sync.set({ ocrModel, parseModel });
      const statusEl = $('saveStatus');
      if (statusEl) {
        statusEl.textContent = '✅ Configuration Saved!';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      }
      log('Configuration saved successfully.');
    } catch (e) {
      log(`Failed to save configuration: ${e.message}`, true);
    }
  }

  async function loadConfiguration() {
    try {
      const config = await chrome.storage.sync.get([
        'ocrMethod', 'parseMethod',
        'openaiKey', 'claudeKey', 'geminiKey', 'googleKey'
      ]);
      log('Loading saved configuration from storage...');

      if ($('openai-key')) $('openai-key').value = config.openaiKey || '';
      if ($('claude-key')) $('claude-key').value = config.claudeKey || '';
      if ($('gemini-key')) $('gemini-key').value = config.geminiKey || '';
      if ($('google-key')) $('google-key').value = config.googleKey || '';

      // Assume any pre-existing keys are valid to enable the UI immediately for returning users.
      if (config.openaiKey) keyValidationStatus.openai = true;
      if (config.geminiKey) keyValidationStatus.gemini = true;
      if (config.claudeKey) keyValidationStatus.claude = true;
      if (config.googleKey) keyValidationStatus.google = true;
      if (Object.values(keyValidationStatus).some(v => v)) {
        log('Pre-existing keys found. Assuming valid and enabling options.');
      }

      // Select saved radio buttons
      const ocrRadio = document.querySelector(`input[name="ocrMethod"][value="${config.ocrMethod}"]`);
      if (ocrRadio && !ocrRadio.disabled) ocrRadio.checked = true;

      const parseRadio = document.querySelector(`input[name="parseMethod"][value="${config.parseMethod}"]`);
      if (parseRadio && !parseRadio.disabled) parseRadio.checked = true;

      const modelConfig = await chrome.storage.sync.get(['ocrModel', 'parseModel']);
      const ocrModel = modelConfig.ocrModel;
      const parseModel = modelConfig.parseModel;


      // Restore model lists and selections for all providers
      const allProviders = ['openai-vision', 'gemini-vision', 'claude-vision', 'openai', 'gemini', 'claude'];
      for (const provider of allProviders) {
        const modelListKey = provider + 'ModelList';
        const stored = await chrome.storage.sync.get([modelListKey]);
        const modelList = stored[modelListKey] || [];

        const row = document.querySelector(`.provider-row input[value="${provider}"]`)?.closest('.provider-row');
        const sel = row?.querySelector('.model-select');

        if (sel && modelList.length > 0) {
          sel.innerHTML = ''; // Clear placeholder
          modelList.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            sel.append(opt);
          });
          sel.disabled = false;

          // If this is the selected provider, set its model value
          if (provider === config.ocrMethod && ocrModel) {
            sel.value = ocrModel;
          } else if (provider === config.parseMethod && parseModel) {
            sel.value = parseModel;
          }
        }
      }
      log('Configuration loaded and UI restored.');
      // Update current selection info display
      updateCurrentSelectionInfo();
    } catch (e) {
      log(`Failed to load configuration: ${e.message}`, true);
    }
  }

  // --- Load image from URL ---
  async function loadImageFromUrl(url) {
    try {
      log(`Loading test image from URL: ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      
      const reader = new FileReader();
      reader.onload = () => {
        setTestImage(reader.result);
        log('Successfully loaded test image from URL.');
      };
      reader.onerror = (e) => log('Failed to read image from URL: ' + e.message, true);
      reader.readAsDataURL(blob);
    } catch (e) {
      setTestImage(FALLBACK_INLINE_PNG);
      log('Could not load image from URL. Using fallback. Error: ' + e.message, true);
    }
  }

  // --- Listeners (keep existing behavior) ---
  function setupEventListeners() {
    const saveBtn = $('save-config-btn');
    saveBtn?.addEventListener('click', saveConfiguration);

    ['openai-key', 'claude-key', 'gemini-key', 'google-key'].forEach((id) => {
      $(id)?.addEventListener('input', () => {
        clearKeyError(id);
        if (saveBtn) {
          saveBtn.disabled = false;
        }
      });
    });
    $('check-files-btn')?.addEventListener('click', testLocalOCR);
    $('save-methods-btn')?.addEventListener('click', saveMethodSelections);
    $('download-files-btn')?.addEventListener('click', downloadTesseractBundle);
    $('ocr-image-dropzone')?.addEventListener('paste', handlePastedImage);
    $('clear-log-btn')?.addEventListener('click', () => {
      const logEl = $('diagLog');
      if (logEl) logEl.textContent = '';
    });
    $('copy-log-btn')?.addEventListener('click', () => {
      const logEl = $('diagLog');
      if (!logEl) return;
      navigator.clipboard
        .writeText(logEl.textContent)
        .then(() => log('Log copied to clipboard.'))
        .catch((err) => log('Failed to copy log: ' + err, true));
    });

    // OCR Test button wiring
    $('ocr-test-btn')?.addEventListener('click', async (e) => {
      const btn = e.target;
      // Find selected OCR provider and model
      const ocrRadio = document.querySelector('input[name="ocrMethod"]:checked');
      if (!ocrRadio) {
        log('No OCR provider selected.', true);
        return;
      }
      // Always get the model from the dropdown for the selected provider
      const row = ocrRadio.closest('.provider-row');
      let modelName = '';
      if (row) {
        const modelSel = row.querySelector('.model-select');
        if (modelSel) modelName = modelSel.value || '';
      }
      log(`[DEBUG] OCR test: provider=${ocrRadio.value}, model=${modelName}`);
      // Clear result box
      const resultBox = $('ocr-result');
      if (resultBox) resultBox.value = '';
      // Run test
      await runOcrTest(ocrRadio.value, modelName, btn);
    });

    // Parser Test button wiring
    $('parser-test-btn')?.addEventListener('click', async (e) => {
      const btn = e.target;
      // Find selected Parser provider and model
      const parserRadio = document.querySelector('input[name="parseMethod"]:checked');
      if (!parserRadio) {
        log('No Parser provider selected.', true);
        return;
      }
      // Find model from dropdown in same row
      const row = parserRadio.closest('.provider-row');
      const modelSel = row?.querySelector('.model-select');
      const modelName = modelSel?.value || '';
      // Clear result box
      const resultBox = $('parser-result');
      if (resultBox) resultBox.value = '';
      // Run test
      await runParserTest(parserRadio.value, modelName, btn);
    });

    // Exit Options button
    $('exit-options-btn')?.addEventListener('click', () => {
      window.close();
    });
  }

  // --- Boot ---
  async function initialize() {
    // Main provider choices rendered as rows with load/test controls (no Test buttons)
    function createProviderRowsNoTest(containerId, groupName, options, onChoose, isOcr) {
      const container = $(containerId);
      if (!container) return;
      container.innerHTML = '';
      container.style.display = 'block';
      container.style.padding = '6px 0';
      options.forEach((opt) => {
        const row = document.createElement('div');
        row.className = 'provider-row';

        const label = document.createElement('label');
        label.className = 'provider-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = opt.value;
        const span = document.createElement('span');
        span.textContent = opt.label;
        label.append(input, span);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn btn-secondary load-btn';
        loadBtn.textContent = 'Load Models';
        loadBtn.disabled = true; // Start as disabled
        loadBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const progressEl = row.querySelector('.progress-indicator');
          loadBtn.disabled = true;
          let origLabel = loadBtn.textContent;
          loadBtn.textContent = 'Loading...';
          if (progressEl) progressEl.textContent = 'Fetching models...';
          await discoverAndPopulateModels(opt.value, row.querySelector('.model-select'), progressEl);
          loadBtn.disabled = false;
          loadBtn.textContent = origLabel;
        });

        const modelSel = document.createElement('select');
        modelSel.className = 'model-select';
        modelSel.disabled = true;
        const placeholderOpt = document.createElement('option');
        placeholderOpt.value = '';
        placeholderOpt.textContent = '- Select -';
        placeholderOpt.selected = true;
        placeholderOpt.disabled = true;
        modelSel.append(placeholderOpt);

        // Update selection info when model changes
        modelSel.addEventListener('change', () => {
          updateCurrentSelectionInfo();
        });

        // Progress indicator
        const progressEl = document.createElement('span');
        progressEl.className = 'progress-indicator';
        progressEl.textContent = '';

        // clicking label checks radio and triggers onChoose
        label.addEventListener('click', (e) => {
          if (input.disabled) { e.preventDefault(); return; }
          input.checked = true;
          updateAllOptionStates(); // Re-evaluate button states when a radio is clicked
          updateCurrentSelectionInfo(); // Update selection info
          if (onChoose) onChoose(opt.value);
        });

        row.append(label, loadBtn, modelSel, progressEl);
        container.append(row);
      });
    }

    const saveBtn = $('save-config-btn');
    saveBtn.textContent = 'Save & Validate Keys';
    saveBtn.disabled = true;

    createProviderRowsNoTest('ocr-method-options', 'ocrMethod', [
      { value: 'openai-vision', label: 'OpenAI Vision' },
      { value: 'gemini-vision', label: 'Gemini Vision' },
      { value: 'claude-vision', label: 'Claude Vision' },
    ], null, true);
    createProviderRowsNoTest('parse-method-options', 'parseMethod', [
      { value: 'openai', label: 'OpenAI' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'claude', label: 'Claude' },
    ], null, false);

    setupEventListeners();
    await loadConfiguration();

    // Initially, all provider rows should be disabled until keys are validated.
    updateAllOptionStates();

    // Load test image from URL
    await loadImageFromUrl(TEST_IMAGE_URL);

    // Ensure parser test is ready immediately
    const parserInput = $('parser-input');
    if (parserInput && !parserInput.value) parserInput.value = DEFAULT_TEST_TEXT;
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
