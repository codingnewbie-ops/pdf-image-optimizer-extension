const ext = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_SETTINGS = {
  enabled: true,
  compressionLevel: 'medium',
  imageQuality: 0.6,
  showNotification: true,
  autoCompress: true,
  compressImages: true
};

ext.runtime.onInstalled.addListener(() => {
  ext.storage.sync.set(DEFAULT_SETTINGS);
});

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    ext.storage.sync.get(null, (settings) => {
      sendResponse({ success: true, settings: { ...DEFAULT_SETTINGS, ...settings } });
    });
    return true;
  }
  if (message.type === 'SAVE_SETTINGS') {
    ext.storage.sync.set(message.settings, () => sendResponse({ success: true }));
    return true;
  }
});
