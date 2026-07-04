chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== 'number') return;

  chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
});
