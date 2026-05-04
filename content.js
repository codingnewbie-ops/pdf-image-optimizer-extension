(function () {
  'use strict';

  const ext = typeof browser !== 'undefined' ? browser : chrome;

  let settings = {
    enabled: true,
    compressionLevel: 'medium',
    imageQuality: 0.6,
    showNotification: true,
    autoCompress: true,
    compressImages: true
  };

  const IMAGE_TYPES = ['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/bmp','image/tiff','image/avif'];
  const IMAGE_EXTS  = ['.jpg','.jpeg','.png','.webp','.gif','.bmp','.tiff','.tif','.avif'];

  function isImage(f) { return IMAGE_TYPES.includes(f.type) || IMAGE_EXTS.some(e => f.name.toLowerCase().endsWith(e)); }
  function isPDF(f)   { return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'); }
  function formatBytes(b) { return b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(2)+' MB'; }

  function loadSettings() {
    try {
      const r = ext.storage.sync.get(null);
      if (r && typeof r.then === 'function') r.then(s => { if (s) settings = { ...settings, ...s }; }).catch(() => {});
      else ext.storage.sync.get(null, s => { if (s) settings = { ...settings, ...s }; });
    } catch(e) {}
  }
  loadSettings();

  ext.runtime.onMessage.addListener(msg => {
    if (msg.type === 'SETTINGS_UPDATED') settings = { ...settings, ...msg.settings };
  });

  function attachToInputs() { document.querySelectorAll('input[type="file"]').forEach(attachListener); }

  function attachListener(input) {
    if (input.dataset.pdfOptimizerAttached) return;
    input.dataset.pdfOptimizerAttached = 'true';
    input.addEventListener('change', async (e) => {
      if (!settings.enabled) return;
      const files = Array.from(e.target.files);
      const toProcess = files.filter(f => isPDF(f) || (settings.compressImages && isImage(f)));
      if (!toProcess.length) return;
      if (settings.autoCompress) await processFiles(input, files, toProcess);
      else showConfirmBanner(toProcess, () => processFiles(input, files, toProcess));
    });
  }

  async function processFiles(input, allFiles, toProcess) {
    const overlay = showLoadingOverlay();
    try {
      const optimizedFiles = [];
      let totalOrig = 0, totalComp = 0;
      for (const file of allFiles) {
        if (!toProcess.includes(file)) { optimizedFiles.push(file); continue; }
        overlay.updateText('Ottimizzazione: ' + file.name + '…');
        const result = isPDF(file) ? await optimizePDF(file) : await optimizeImage(file);
        optimizedFiles.push(result.file);
        totalOrig += result.originalSize;
        totalComp += result.compressedSize;
      }
      const dt = new DataTransfer();
      optimizedFiles.forEach(f => dt.items.add(f));
      try { input.files = dt.files; } catch(_) {}
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        if (desc && desc.set) desc.set.call(input, dt.files);
      } catch(_) {}
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      overlay.hide();
      if (settings.showNotification) showSuccessBanner(totalOrig, totalComp, toProcess.length);
    } catch (err) {
      overlay.hide();
      showErrorBanner(err.message);
    }
  }

  async function optimizePDF(file) {
    const originalSize = file.size;
    if (typeof PDFLib === 'undefined') return { file, originalSize, compressedSize: originalSize };
    try {
      const ab = await file.arrayBuffer();
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(ab, { ignoreEncryption: true, updateMetadata: false });
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
      const opts = ({ low: { useObjectStreams: false, objectsPerTick: 100 }, medium: { useObjectStreams: true, objectsPerTick: 50 }, high: { useObjectStreams: true, objectsPerTick: 20 } })[settings.compressionLevel] || { useObjectStreams: true, objectsPerTick: 50 };
      const bytes = await doc.save({ ...opts, addDefaultPage: false });
      const ok = bytes.byteLength < originalSize;
      const blob = new Blob([ok ? bytes : ab], { type: 'application/pdf' });
      return { file: new File([blob], file.name, { type: 'application/pdf', lastModified: file.lastModified }), originalSize, compressedSize: ok ? bytes.byteLength : originalSize };
    } catch(e) { return { file, originalSize, compressedSize: originalSize }; }
  }

  function optimizeImage(file) {
    const originalSize = file.size;
    if (file.type === 'image/gif') return Promise.resolve({ file, originalSize, compressedSize: originalSize });
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const maxDim = ({ low: 4000, medium: 2560, high: 1920 })[settings.compressionLevel] || 2560;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const r = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * r); height = Math.round(height * r);
          }
          canvas.width = width; canvas.height = height;
          const outType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
          if (outType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob || blob.size >= originalSize) { resolve({ file, originalSize, compressedSize: originalSize }); return; }
            const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
            const name = file.name.replace(/\.[^.]+$/, '') + (extMap[outType] || '.jpg');
            resolve({ file: new File([blob], name, { type: outType, lastModified: file.lastModified }), originalSize, compressedSize: blob.size });
          }, outType, settings.imageQuality || 0.6);
        } catch(e) { resolve({ file, originalSize, compressedSize: originalSize }); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ file, originalSize, compressedSize: originalSize }); };
      img.src = url;
    });
  }

  // ── UI con DOM API (niente innerHTML) ────────────────────────────────────

  function removeBanner() { document.getElementById('pdf-optimizer-banner')?.remove(); }

  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  function makeCloseBtn() {
    const btn = makeEl('button', 'pdf-opt-close', '✕');
    btn.addEventListener('click', removeBanner);
    return btn;
  }

  function showLoadingOverlay() {
    const overlay = makeEl('div'); overlay.id = 'pdf-optimizer-overlay';
    const box     = makeEl('div', 'pdf-opt-box');
    const spinner = makeEl('div', 'pdf-opt-spinner');
    const title   = makeEl('div', 'pdf-opt-title', 'File Optimizer');
    const msg     = makeEl('div', 'pdf-opt-msg', 'Compressione in corso…'); msg.id = 'pdf-opt-msg';
    box.appendChild(spinner); box.appendChild(title); box.appendChild(msg);
    overlay.appendChild(box); document.body.appendChild(overlay);
    return {
      updateText: t => { const m = document.getElementById('pdf-opt-msg'); if (m) m.textContent = t; },
      hide: () => { try { overlay.remove(); } catch(_){} }
    };
  }

  function showSuccessBanner(orig, comp, count) {
    removeBanner();
    const saved = orig - comp;
    const pct = Math.round((saved / orig) * 100);
    const improved = saved > 512;
    const banner = makeEl('div'); banner.id = 'pdf-optimizer-banner';
    const inner  = makeEl('div', 'pdf-opt-banner-inner');
    const icon   = makeEl('span', 'pdf-opt-icon', improved ? '✅' : 'ℹ️');
    const info   = makeEl('div');
    const strong = makeEl('strong', null, 'File ottimizzat' + (count > 1 ? 'i (' + count + ')' : 'o'));
    const span   = makeEl('span', null, formatBytes(orig) + ' → ' + formatBytes(comp) + ' ');
    const em     = makeEl('em', null, improved ? '(-' + pct + '%)' : '(già ottimizzato)');
    span.appendChild(em);
    info.appendChild(strong); info.appendChild(span);
    inner.appendChild(icon); inner.appendChild(info); inner.appendChild(makeCloseBtn());
    banner.appendChild(inner); document.body.appendChild(banner);
    setTimeout(() => { try { banner.remove(); } catch(_){} }, 6000);
  }

  function showErrorBanner(msg) {
    removeBanner();
    const banner = makeEl('div'); banner.id = 'pdf-optimizer-banner'; banner.className = 'error';
    const inner  = makeEl('div', 'pdf-opt-banner-inner');
    const icon   = makeEl('span', 'pdf-opt-icon', '⚠️');
    const info   = makeEl('div');
    info.appendChild(makeEl('strong', null, 'Errore ottimizzazione'));
    info.appendChild(makeEl('span', null, msg || 'File originale in uso.'));
    inner.appendChild(icon); inner.appendChild(info); inner.appendChild(makeCloseBtn());
    banner.appendChild(inner); document.body.appendChild(banner);
    setTimeout(() => { try { banner.remove(); } catch(_){} }, 5000);
  }

  function showConfirmBanner(files, onConfirm) {
    removeBanner();
    const pdfs = files.filter(isPDF).length, imgs = files.filter(isImage).length;
    const parts = [];
    if (pdfs) parts.push(pdfs + ' PDF');
    if (imgs) parts.push(imgs + ' immagini');
    const banner = makeEl('div'); banner.id = 'pdf-optimizer-banner'; banner.className = 'confirm';
    const inner  = makeEl('div', 'pdf-opt-banner-inner');
    const icon   = makeEl('span', 'pdf-opt-icon', '🗜️');
    const info   = makeEl('div');
    info.appendChild(makeEl('strong', null, 'Ottimizzare ' + parts.join(' e ') + '?'));
    info.appendChild(makeEl('span', null, files.map(f => f.name).join(', ')));
    const yesBtn = makeEl('button', 'pdf-opt-btn-yes', 'Ottimizza');
    yesBtn.addEventListener('click', () => { banner.remove(); onConfirm(); });
    inner.appendChild(icon); inner.appendChild(info); inner.appendChild(yesBtn); inner.appendChild(makeCloseBtn());
    banner.appendChild(inner); document.body.appendChild(banner);
  }

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = [
      '#pdf-optimizer-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}',
      '.pdf-opt-box{background:#fff;border-radius:16px;padding:32px 40px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);min-width:260px}',
      '.pdf-opt-spinner{width:40px;height:40px;margin:0 auto 16px;border:3px solid #e5e7eb;border-top-color:#6366f1;border-radius:50%;animation:pdf-spin 0.8s linear infinite}',
      '@keyframes pdf-spin{to{transform:rotate(360deg)}}',
      '.pdf-opt-title{font-size:15px;font-weight:700;color:#1e1b4b;margin-bottom:8px}',
      '.pdf-opt-msg{font-size:13px;color:#6b7280}',
      '#pdf-optimizer-banner{position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);animation:pdf-slide-in 0.3s ease;font-family:system-ui,sans-serif;max-width:400px}',
      '#pdf-optimizer-banner.error{background:#fef2f2;border-color:#fca5a5}',
      '#pdf-optimizer-banner.confirm{background:#eff6ff;border-color:#93c5fd}',
      '@keyframes pdf-slide-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}',
      '.pdf-opt-banner-inner{display:flex;align-items:center;gap:12px;padding:14px 16px}',
      '.pdf-opt-icon{font-size:22px;flex-shrink:0}',
      '.pdf-opt-banner-inner>div{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
      '.pdf-opt-banner-inner strong{font-size:13px;color:#111827;display:block}',
      '.pdf-opt-banner-inner span{font-size:12px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}',
      '.pdf-opt-banner-inner em{color:#16a34a;font-style:normal;font-weight:600}',
      '.pdf-opt-close{background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;padding:4px;border-radius:6px;flex-shrink:0}',
      '.pdf-opt-close:hover{color:#374151;background:rgba(0,0,0,0.06)}',
      '.pdf-opt-btn-yes{background:#6366f1;color:#fff;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0}',
      '.pdf-opt-btn-yes:hover{background:#4f46e5}'
    ].join('');
    document.head.appendChild(s);
  }

  injectStyles();
  attachToInputs();
  new MutationObserver(ms => {
    for (const m of ms)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.('input[type="file"]')) attachListener(n);
        n.querySelectorAll?.('input[type="file"]').forEach(attachListener);
      }
  }).observe(document.body, { childList: true, subtree: true });

})();
