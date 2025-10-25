/* content.js — capture rectangle + create popup window */

(() => {
  const NS = "t2c-cap";
  let overlay, guide, box, start, onMove, onUp;
  let guideFollowMode = false;
  let currentMousePos = { x: 0, y: 0 };

  // --- small utilities -------------------------------------------------------
  const dpr = () => (window.devicePixelRatio || 1);

  function ensureOverlay() {
    if (overlay) return;

    // container (no greying, clicks only while capturing)
    overlay = document.createElement("div");
    overlay.id = `${NS}-overlay`;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      background: "transparent"
    });

    // dashed rectangle (the selection)
    box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      border: "3px dashed #3b82f6",
      background: "rgba(59, 130, 246, 0.1)",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      borderRadius: "4px"
    });

    // helper bubble - starts large and center-right
    guide = document.createElement("div");
    guide.textContent = "Drag to capture • Esc to cancel";
    Object.assign(guide.style, {
      position: "fixed",
      right: "20%",
      top: "20%",
      background: "#1f2937",
      color: "#f3f4f6",
      padding: "12px 20px",
      borderRadius: "12px",
      font: "16px/1.4 'Google Sans','Roboto',-apple-system,BlinkMacSystemFont,sans-serif",
      fontWeight: "500",
      boxShadow: "0 8px 32px rgba(0,0,0,.4)",
      zIndex: "2147483647",
      transition: "opacity 0.3s ease, font-size 0.3s ease, padding 0.3s ease",
      opacity: "1"
    });

    overlay.appendChild(box);
    overlay.appendChild(guide);

    // After 1 second, switch to cursor-following mode
    setTimeout(() => {
      guideFollowMode = true;
      // Make it smaller, more transparent, and position near cursor
      Object.assign(guide.style, {
        font: "13px/1.2 'Google Sans','Roboto',-apple-system,BlinkMacSystemFont,sans-serif",
        padding: "8px 12px",
        opacity: "0.85",
        transition: "none"
      });
      updateGuidePosition(currentMousePos.x, currentMousePos.y);
    }, 1000);
  }

  function updateGuidePosition(x, y) {
    if (!guide || !guideFollowMode) return;
    // Position 96px (roughly "an inch") away from cursor
    // Place it to the bottom-right to avoid blocking the selection area
    const offset = 96;
    guide.style.left = `${x + offset}px`;
    guide.style.top = `${y + offset}px`;
    guide.style.right = "auto";
  }

  function removeOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    box = null;
    guide = null;
    guideFollowMode = false;
    document.removeEventListener("keydown", onEsc, true);
  }

  function onEsc(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      removeOverlay();
    }
  }

  // --- capture flow ----------------------------------------------------------
  function beginCapture() {
    ensureOverlay();
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onEsc, true);

    start = null;

    // Track all mouse movements for guide following
    const trackMouse = (ev) => {
      currentMousePos = { x: ev.clientX, y: ev.clientY };
      if (guideFollowMode) {
        updateGuidePosition(ev.clientX, ev.clientY);
      }
    };
    overlay.addEventListener("mousemove", trackMouse);

    onMove = (ev) => {
      if (!start) return;
      const x = Math.min(ev.clientX, start.x);
      const y = Math.min(ev.clientY, start.y);
      const w = Math.abs(ev.clientX - start.x);
      const h = Math.abs(ev.clientY - start.y);
      Object.assign(box.style, {
        left: x + "px",
        top: y + "px",
        width: w + "px",
        height: h + "px"
      });
    };
    
    onUp = async (ev) => {
      overlay.removeEventListener("mousemove", onMove);
      overlay.removeEventListener("mouseup", onUp);
      
      if (!start) { 
        removeOverlay(); 
        return; 
      }

      const rect = {
        x: Math.min(ev.clientX, start.x),
        y: Math.min(ev.clientY, start.y),
        w: Math.abs(ev.clientX - start.x),
        h: Math.abs(ev.clientY - start.y),
        dpr: dpr()
      };

      // Minimum size check
      if (rect.w < 10 || rect.h < 10) {
        removeOverlay();
        return;
      }

      removeOverlay();
      
      try {
        const imageDataUrl = await screenshotAndCrop(rect);
        await createPopupWithImage(imageDataUrl);
      } catch (err) {
        console.error("[T2C] Capture error:", err);
        alert("Capture Error: " + (err?.message || err));
      }
    };

    overlay.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      start = { x: ev.clientX, y: ev.clientY };
      overlay.addEventListener("mousemove", onMove);
      overlay.addEventListener("mouseup", onUp);
      ev.preventDefault();
    }, { once: true });
  }

  async function screenshotAndCrop(rect) {
    // 1) ask background for a full-tab PNG
    const response = await chrome.runtime.sendMessage({ type: "t2c.screenshot" });
    
    if (!response?.ok || !response?.dataUrl) {
      throw new Error(response?.err || "screenshot failed");
    }

    // 2) crop it locally in the content world
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = response.dataUrl;
    });

    const sx = Math.max(0, Math.floor(rect.x * rect.dpr));
    const sy = Math.max(0, Math.floor(rect.y * rect.dpr));
    const sw = Math.max(1, Math.floor(rect.w * rect.dpr));
    const sh = Math.max(1, Math.floor(rect.h * rect.dpr));

    const canvas = document.createElement("canvas");
    canvas.width = sw; 
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    
    return canvas.toDataURL("image/png");
  }

  // --- popup creator ----------------------------------------------------------
  async function createPopupWithImage(imageDataUrl) {
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 't2c.createPopup', 
        imageDataUrl: imageDataUrl 
      });
      
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to create popup window');
      }
      
      console.log('[T2C] Popup window created successfully');
    } catch (err) {
      console.error("[T2C] Popup creation error:", err);
      alert("Text2Cal: Failed to create popup window - " + (err?.message || err));
    }
  }

  // --- runtime wiring --------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "t2c.ping") { 
      sendResponse({ ok: true }); 
      return false;
    }
    if (msg?.type === "t2c.beginCapture") { 
      beginCapture(); 
      sendResponse({ ok: true }); 
      return false;
    }
    if (msg?.type === "t2c.redraw") { 
      beginCapture(); 
      sendResponse({ ok: true }); 
      return false;
    }
    
    return false;
  });

  console.log("[T2C] Content script loaded (popup mode)");
})();