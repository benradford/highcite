import { convertToBibTeX } from './parser.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'convert-to-bibtex',
    title: 'Convert to BibTeX',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'convert-to-bibtex') return;
  const text = info.selectionText?.trim();
  if (!text) return;
  await runConversion(text, tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'convertToBibTeX') {
    runConversion(message.text, message.tabId)
      .then(bibtex => sendResponse({ success: true, bibtex }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'getSelectedText') {
    chrome.tabs.sendMessage(message.tabId, { action: 'getSelectedText' }, response => {
      sendResponse(chrome.runtime.lastError ? { text: '' } : response);
    });
    return true;
  }
});

async function runConversion(citationText, tabId) {
  const processingId = `hc-processing-${Date.now()}`;
  notify('Converting…', 'Looking up citation…', processingId);

  let bibtex;
  try {
    bibtex = await convertToBibTeX(citationText);
  } catch (err) {
    chrome.notifications.clear(processingId);
    notify('Conversion failed', err.message);
    throw err;
  }

  chrome.notifications.clear(processingId);

  try {
    await writeClipboard(tabId, bibtex);
    notify('Copied!', 'BibTeX entry copied to clipboard.');
  } catch (_) {
    notify('Converted', 'Open the popup to copy the result manually.');
  }

  await chrome.storage.local.set({ lastBibTeX: bibtex, lastCitation: citationText });
  return bibtex;
}

async function writeClipboard(tabId, text) {
  if (!tabId) throw new Error('No active tab');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (t) => {
      try {
        await navigator.clipboard.writeText(t);
        return true;
      } catch (_) {
        const el = document.createElement('textarea');
        el.value = t;
        el.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        return ok;
      }
    },
    args: [text]
  });
  if (!results?.[0]?.result) throw new Error('Clipboard write failed');
}

function notify(title, message, id) {
  chrome.notifications.create(id ?? `hc-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: `HighCite — ${title}`,
    message
  });
}
