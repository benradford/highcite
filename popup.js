const citationBox   = document.getElementById('citationBox');
const convertBtn    = document.getElementById('convertBtn');
const statusEl      = document.getElementById('status');
const resultSection = document.getElementById('resultSection');
const bibtexOutput  = document.getElementById('bibtexOutput');
const copyBtn       = document.getElementById('copyBtn');
const methodLabel   = document.getElementById('methodLabel');

const METHOD_LABELS = {
  'crossref':    'Via CrossRef',
  'regex':       'Local parse',
  'gemini-nano': 'Gemini Nano'
};

let currentBibTeX = '';
let activeTabId   = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;

  const { lastBibTeX, lastCitation, lastMethod } = await chrome.storage.local.get(['lastBibTeX', 'lastCitation', 'lastMethod']);

  if (activeTabId) {
    try {
      const response = await sendMessage({ action: 'getSelectedText', tabId: activeTabId });
      const text = response?.text?.trim();
      if (text) {
        setCitationText(text);
      } else if (lastCitation) {
        setCitationText(lastCitation);
        showResult(lastBibTeX, lastMethod, true);
      }
    } catch (_) {
      if (lastCitation) { setCitationText(lastCitation); showResult(lastBibTeX, lastMethod, true); }
    }
  }
}

function setCitationText(text) {
  citationBox.textContent = text;
  citationBox.classList.remove('placeholder');
  convertBtn.disabled = false;
}

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = `status show ${type}`;
}

function clearStatus() {
  statusEl.className = 'status';
}

function showResult(bibtex, method = null, fromCache = false) {
  if (!bibtex) return;
  currentBibTeX = bibtex;
  bibtexOutput.textContent = bibtex;
  resultSection.classList.add('show');
  methodLabel.textContent = fromCache
    ? 'Last result'
    : (METHOD_LABELS[method] ?? 'Local parse');
}

convertBtn.addEventListener('click', async () => {
  const text = citationBox.classList.contains('placeholder') ? '' : citationBox.textContent.trim();
  if (!text) {
    setStatus('No citation selected. Highlight text on the page first.', 'error');
    return;
  }

  convertBtn.disabled = true;
  convertBtn.innerHTML = '<span class="spinner"></span>Converting…';
  clearStatus();
  resultSection.classList.remove('show');
  methodLabel.textContent = '';

  try {
    const response = await sendMessage({ action: 'convertToBibTeX', text, tabId: activeTabId });
    if (!response.success) throw new Error(response.error);
    showResult(response.bibtex, response.method);
    setStatus('BibTeX copied to clipboard!', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = 'Convert to BibTeX';
  }
});

copyBtn.addEventListener('click', async () => {
  if (!currentBibTeX) return;
  try {
    await navigator.clipboard.writeText(currentBibTeX);
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1800);
  } catch (_) {
    setStatus('Clipboard write failed — try again.', 'error');
  }
});

document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

init();
