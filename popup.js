// popup.js v1.3 — Compatibile Firefox e Chrome
document.addEventListener('DOMContentLoaded', () => {
  const ext = typeof browser !== 'undefined' ? browser : chrome;

  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleAuto    = document.getElementById('toggle-auto');
  const toggleNotify  = document.getElementById('toggle-notify');
  const toggleImages  = document.getElementById('toggle-images');
  const qualitySlider = document.getElementById('quality-slider');
  const qualityVal    = document.getElementById('quality-val');
  const statusText    = document.getElementById('status-text');
  const levelBtns     = document.querySelectorAll('.level-btn');

  let currentSettings = {
    enabled: true,
    compressionLevel: 'medium',
    imageQuality: 0.6,
    showNotification: true,
    autoCompress: true,
    compressImages: true
  };

  // Carica impostazioni — supporta sia Promise (Firefox) che callback (Chrome)
  function loadSettings(cb) {
    try {
      const result = ext.storage.sync.get(null);
      if (result && typeof result.then === 'function') {
        result.then(s => cb(s)).catch(() => cb({}));
      } else {
        ext.storage.sync.get(null, cb);
      }
    } catch(e) { cb({}); }
  }

  loadSettings((saved) => {
    if (saved && Object.keys(saved).length > 0) {
      currentSettings = { ...currentSettings, ...saved };
    }
    applyToUI(currentSettings);
  });

  function applyToUI(s) {
    toggleEnabled.checked = s.enabled;
    toggleAuto.checked    = s.autoCompress;
    toggleNotify.checked  = s.showNotification;
    if (toggleImages) toggleImages.checked = s.compressImages;
    updateStatus(s.enabled);

    const qPct = Math.round((s.imageQuality || 0.6) * 100);
    if (qualitySlider) { qualitySlider.value = qPct; }
    if (qualityVal)    { qualityVal.textContent = qPct + '%'; }

    levelBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.level === s.compressionLevel));
  }

  function updateStatus(enabled) {
    if (statusText) statusText.textContent = enabled ? 'Attivo — PDF e immagini' : 'Disattivato';
    document.body.classList.toggle('disabled', !enabled);
  }

  function saveSettings() {
    try {
      const result = ext.storage.sync.set(currentSettings);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch(e) {}

    // Notifica content script nella tab attiva
    try {
      const tabsResult = ext.tabs.query({ active: true, currentWindow: true });
      const send = (tabs) => {
        if (tabs && tabs[0]) {
          ext.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings: currentSettings }).catch?.(() => {});
        }
      };
      if (tabsResult && typeof tabsResult.then === 'function') {
        tabsResult.then(send).catch(() => {});
      } else {
        ext.tabs.query({ active: true, currentWindow: true }, send);
      }
    } catch(e) {}
  }

  toggleEnabled.addEventListener('change', () => { currentSettings.enabled = toggleEnabled.checked; updateStatus(currentSettings.enabled); saveSettings(); });
  toggleAuto.addEventListener('change',    () => { currentSettings.autoCompress = toggleAuto.checked; saveSettings(); });
  toggleNotify.addEventListener('change',  () => { currentSettings.showNotification = toggleNotify.checked; saveSettings(); });
  if (toggleImages) toggleImages.addEventListener('change', () => { currentSettings.compressImages = toggleImages.checked; saveSettings(); });

  if (qualitySlider) {
    qualitySlider.addEventListener('input', () => {
      const pct = parseInt(qualitySlider.value);
      if (qualityVal) qualityVal.textContent = pct + '%';
      currentSettings.imageQuality = pct / 100;
      saveSettings();
    });
  }

  levelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      levelBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSettings.compressionLevel = btn.dataset.level;
      saveSettings();
    });
  });
});
