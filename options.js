const emailInput = document.getElementById('crossrefEmail');
const llmToggle  = document.getElementById('llmToggle');
const saveBtn    = document.getElementById('saveBtn');
const clearBtn   = document.getElementById('clearBtn');
const toast      = document.getElementById('toast');

async function load() {
  const { crossrefEmail = '', llmEnabled = true } = await chrome.storage.sync.get(['crossrefEmail', 'llmEnabled']);
  emailInput.value  = crossrefEmail;
  llmToggle.checked = llmEnabled;
}

function showToast(msg, type = 'ok') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

llmToggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ llmEnabled: llmToggle.checked });
  showToast(llmToggle.checked ? 'Gemini Nano enabled.' : 'Gemini Nano disabled.');
});

saveBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (email && !email.includes('@')) {
    showToast('Enter a valid email address.', 'error');
    return;
  }
  await chrome.storage.sync.set({ crossrefEmail: email });
  showToast(email ? 'Email saved.' : 'Settings cleared.');
});

clearBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['lastBibTeX', 'lastCitation']);
  showToast('Cleared last result.');
});

load();
