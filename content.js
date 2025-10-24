/* content.js — capture rectangle + create popup window */

(() => {
  const NS = "t2c-cap";
  let overlay, guide, box, start, onMove, onUp;

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

    // tiny helper bubble
    guide = document.createElement("div");
    guide.textContent = "Drag to Capture; Release to End";
    Object.assign(guide.style, {
      position: "fixed",
      left: "20px",
      top: "20px",
      background: "rgba(0, 0, 0, 0.7)",
      color: "white",
      padding: "8px 12px",
      borderRadius: "8px",
      font: "13px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif",
      boxShadow: "0 8px 32px rgba(0,0,0,.3)",
      zIndex: "2147483647",
      pointerEvents: "none",
      backdropFilter: "blur(2px)"
    });

    overlay.appendChild(box);
    overlay.appendChild(guide);
  }

  function removeOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    box = null;
    guide = null;
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
      // Update guide position and text
      guide.style.left = (ev.clientX + 20) + "px";
      guide.style.top = (ev.clientY + 20) + "px";
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