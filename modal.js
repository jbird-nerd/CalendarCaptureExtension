// modal.js

(function() {
  const $ = (id) => document.getElementById(id);

  function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }

  function setStatus(text, isError = false) {
    const statusEl = $('status');
    if(statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = isError ? '#d93025' : '#1a73e8';
    }
  }

  function fillForm(details) {
    if (!details) return;
    $('title').value = details.title || '';
    $('location').value = details.location || '';
    if (details.start) {
      const start = new Date(details.start);
      $('start-date').value = start.toISOString().split('T')[0];
      $('start-time').value = start.toTimeString().split(' ')[0].substring(0, 5);
    }
    if (details.end) {
      const end = new Date(details.end);
      $('end-date').value = end.toISOString().split('T')[0];
      $('end-time').value = end.toTimeString().split(' ')[0].substring(0, 5);
    }
  }

  async function performOcrAndParse(imageDataUrl) {
    try {
      setStatus('Reading text from image...');
      const ocrResponse = await chrome.runtime.sendMessage({
        type: 'PERFORM_OCR',
        dataUrl: imageDataUrl,
      });

      if (!ocrResponse.ok) {
        throw new Error(`OCR failed: ${ocrResponse.error}`);
      }
      setStatus(`Parsing text with ${ocrResponse.debug.provider}...`);

      const parseResponse = await chrome.runtime.sendMessage({
        type: 'PERFORM_PARSE',
        text: ocrResponse.text,
      });

      if (!parseResponse.ok) {
        throw new Error(`Parsing failed: ${parseResponse.error}`);
      }
      setStatus('Successfully parsed event details.');
      fillForm(parseResponse.result);
      // On successful parse, make the "Add to Calendar" button blue
      $('add-to-calendar').classList.add('primary', 'btn-pulse');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function constructGoogleCalendarUrl() {
    const title = encodeURIComponent($('title').value);
    const location = encodeURIComponent($('location').value);

    const startDate = $('start-date').value;
    const startTime = $('start-time').value || '00:00';
    const endDate = $('end-date').value;
    const endTime = $('end-time').value || '00:00';

    if (!startDate || !endDate) {
        setStatus('Start and End dates are required.', true);
        return null;
    }

    const startDateTime = `${startDate.replace(/-/g, '')}T${startTime.replace(/:/g, '')}00`;
    const endDateTime = `${endDate.replace(/-/g, '')}T${endTime.replace(/:/g, '')}00`;

    const dates = `${startDateTime}/${endDateTime}`;

    return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&location=${location}`;
  }

  // Listen for the image data from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'POPUP_PROCESS_IMAGE') {
      performOcrAndParse(message.imageDataUrl);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    // Signal to the background script that the popup is ready to receive data
    chrome.runtime.sendMessage({ type: 'POPUP_READY' });

    $('add-to-calendar').addEventListener('click', () => {
      const url = constructGoogleCalendarUrl();
      if (url) {
        chrome.tabs.create({ url });
        window.close();
      }
    });

    $('re-capture-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'START_CAPTURE' });
      window.close();
    });

    $('exit-btn').addEventListener('click', () => {
      window.close();
    });
  });

})();
