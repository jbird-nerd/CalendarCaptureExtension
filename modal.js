/* modal.js — handles logic for the popup window */

// --- DOM elements ------------------------------------------------------------
const closeModalButton = document.getElementById('closeModal');
const addToCalendarButton = document.getElementById('addToCalendar');
const redrawButton = document.getElementById('redraw');
const screenshotImg = document.getElementById('screenshot');
const statusText = document.getElementById('statusText');
const titleInput = document.getElementById('title');
const startDateInput = document.getElementById('startDate');
const startTimeInput = document.getElementById('startTime');
const endDateInput = document.getElementById('endDate');
const endTimeInput = document.getElementById('endTime');
const descriptionInput = document.getElementById('description');
const locationInput = document.getElementById('location');

let imageDataUrl = null; // Store the initial image data URL

// --- initial setup -----------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 't2c.getScreenshot' });
    if (response && response.imageDataUrl) {
      imageDataUrl = response.imageDataUrl;
      screenshotImg.src = imageDataUrl;
      await processImageWithAI(imageDataUrl);
    } else {
      updateStatus('Error: No screenshot data received.', true);
      console.error("No image data URL received from background script");
    }
  } catch (err) {
    updateStatus('Error retrieving screenshot.', true);
    console.error("Error getting screenshot from background:", err);
  }
});

// --- AI processing ----------------------------------------------------------
async function processImageWithAI(dataUrl) {
  try {
    const settings = await chrome.storage.local.get(['ocrModel', 'parseModel', 'anthropicApiKey', 'openAiApiKey']);

    if (!settings.ocrModel || !settings.parseModel) {
      updateStatus('Error: OCR/Parse models not configured.', true);
      return;
    }

    // OCR Step
    const ocrProvider = settings.ocrModel.startsWith('claude') ? 'Anthropic' : 'OpenAI';
    updateStatus(`OCRing with ${ocrProvider} (${settings.ocrModel})...`);
    const ocrResult = await chrome.runtime.sendMessage({
      type: 't2c.callApi',
      provider: 'ocr',
      model: settings.ocrModel,
      imageDataUrl: dataUrl
    });

    if (!ocrResult.ok || !ocrResult.data || !ocrResult.data.text) {
      throw new Error(ocrResult.error || 'OCR process failed to extract text.');
    }
    const extractedText = ocrResult.data.text;
    console.log("[T2C] OCR Result:", extractedText);

    // Parse Step
    const parseProvider = settings.parseModel.startsWith('claude') ? 'Anthropic' : 'OpenAI';
    updateStatus(`Parsing with ${parseProvider} (${settings.parseModel})...`);
    const parseResult = await chrome.runtime.sendMessage({
      type: 't2c.callApi',
      provider: 'parser',
      model: settings.parseModel,
      text: extractedText
    });

    if (!parseResult.ok || !parseResult.data) {
      throw new Error(parseResult.error || 'Parsing process failed.');
    }

    updateStatus('AI processing complete.', false, 2000);
    populateForm(parseResult.data);

  } catch (err) {
    console.error("[T2C] AI Processing Error:", err);
    updateStatus(`Error: ${err.message}`, true);
  }
}

// --- form & UI helpers -------------------------------------------------------
function updateStatus(message, isError = false, clearAfter = 0) {
  statusText.textContent = message;
  statusText.className = isError ? 'status-text status-error' : 'status-text status-active';

  if (clearAfter > 0) {
    setTimeout(() => {
      statusText.textContent = 'Please review the event details below.';
      statusText.className = 'status-text';
    }, clearAfter);
  }
}

function populateForm(data) {
  console.log("[T2C] Populating form with:", data);
  titleInput.value = data.title || '';
  descriptionInput.value = data.description || '';
  locationInput.value = data.location || '';

  try {
    // Attempt to parse dates and times
    const startDateTime = data.start_time ? new Date(data.start_time) : null;
    const endDateTime = data.end_time ? new Date(data.end_time) : null;

    if (startDateTime && !isNaN(startDateTime)) {
      startDateInput.value = startDateTime.toISOString().split('T')[0];
      startTimeInput.value = startDateTime.toTimeString().substring(0, 5);
    } else {
      startDateInput.value = '';
      startTimeInput.value = '';
    }

    if (endDateTime && !isNaN(endDateTime)) {
      endDateInput.value = endDateTime.toISOString().split('T')[0];
      endTimeInput.value = endDateTime.toTimeString().substring(0, 5);
    } else {
      endDateInput.value = '';
      endTimeInput.value = '';
    }
  } catch (e) {
      console.error("Error parsing date/time data:", e);
      updateStatus('Error populating date/time fields.', true);
      // Clear fields on error
      startDateInput.value = '';
      startTimeInput.value = '';
      endDateInput.value = '';
      endTimeInput.value = '';
  }
}

// --- event listeners ---------------------------------------------------------
closeModalButton.addEventListener('click', () => {
  window.close();
});

redrawButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 't2c.redrawCapture' });
    window.close();
  } catch (err) {
    console.error("Error signaling redraw:", err);
  }
});

addToCalendarButton.addEventListener('click', async () => {
  const startDateTime = `${startDateInput.value}T${startTimeInput.value}`;
  const endDateTime = `${endDateInput.value}T${endTimeInput.value}`;

  const eventData = {
    title: titleInput.value,
    startDate: startDateTime,
    endDate: endDateTime,
    description: descriptionInput.value,
    location: locationInput.value,
  };

  try {
    const response = await chrome.runtime.sendMessage({ type: 't2c.createGoogleEvent', eventData });
    if (response.ok) {
      updateStatus('Event created successfully!', false);
      addToCalendarButton.classList.add('success');
      addToCalendarButton.textContent = 'Added to Calendar!';

      // Auto-close after a short delay
      setTimeout(() => {
        window.close();
      }, 1500);

    } else {
      throw new Error(response.error || 'Unknown error creating event.');
    }
  } catch (err) {
    console.error("Error creating Google Calendar event:", err);
    updateStatus(`Error: ${err.message}`, true);
    addToCalendarButton.classList.remove('success'); // Ensure success style is removed on error
  }
});
