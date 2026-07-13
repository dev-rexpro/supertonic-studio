/**
 * Supertonic3 Voice Clone Studio — Client-Side Logic
 */

// ===================================================================
//  UTILS
// ===================================================================

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatElapsed(seconds) {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}


// ===================================================================
//  TOAST
// ===================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}


// ===================================================================
//  THEME MANAGEMENT
// ===================================================================

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('st3-theme', theme);

  // Update active button
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function loadTheme() {
  const saved = localStorage.getItem('st3-theme') || 'dark';
  setTheme(saved);
}


// ===================================================================
//  SIDEBAR TOGGLE
// ===================================================================

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('st3-sidebar', sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded');
}

function loadSidebarState() {
  const saved = localStorage.getItem('st3-sidebar');
  if (saved === 'collapsed') {
    document.getElementById('sidebar').classList.add('collapsed');
  }
}


// ===================================================================
//  API
// ===================================================================

function getApiBaseUrl() {
  const mode = localStorage.getItem('st3-backend-mode') || 'local';
  if (mode === 'local') {
    return '';
  } else {
    const url = localStorage.getItem('st3-backend-endpoint') || 'http://localhost:8000';
    return url.replace(/\/$/, '');
  }
}

const API = {
  async get(url) {
    const fullUrl = getApiBaseUrl() + url;
    const res = await fetch(fullUrl);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },

  async post(url, body) {
    const fullUrl = getApiBaseUrl() + url;
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },

  async upload(url, file) {
    const form = new FormData();
    form.append('file', file);
    const fullUrl = getApiBaseUrl() + url;
    const res = await fetch(fullUrl, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },

  async del(url) {
    const fullUrl = getApiBaseUrl() + url;
    const res = await fetch(fullUrl, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },
};


// ===================================================================
//  SECTION NAVIGATION
// ===================================================================

function switchSection(name) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `section-${name}`);
  });

  // Update header title dynamically
  const titles = {
    voices: 'Voice Files',
    training: 'Training',
    generate: 'Generate Speech',
    samples: 'Samples',
    docs: 'Documentation',
    settings: 'Settings'
  };
  const titleEl = document.getElementById('main-header-title');
  if (titleEl && titles[name]) {
    titleEl.textContent = titles[name];
  }

  if (name === 'voices') loadVoices();
  if (name === 'training') { loadVoicesForTraining(); loadStylesForTraining(); }
  if (name === 'generate') loadStylesForGenerate();
  if (name === 'samples') loadSamples();
  if (name === 'settings') loadBackendSettingsUI();
}


// ===================================================================
//  AUDIO PLAYER
// ===================================================================

let currentAudio = null;
let currentPlayBtn = null;

function createAudioPlayer(audioUrl) {
  const playIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

  return `
    <div class="audio-player" data-src="${audioUrl}">
      <button class="play-btn" onclick="toggleAudio(this)" data-play='${playIcon}' data-pause='${pauseIcon}'>
        ${playIcon}
      </button>
      <div class="progress-wrap" onclick="seekAudio(event, this)">
        <div class="progress-fill"></div>
      </div>
      <span class="time">0:00</span>
    </div>`;
}

function toggleAudio(btn) {
  const player = btn.closest('.audio-player');
  const src = getApiBaseUrl() + player.dataset.src;

  if (currentAudio && currentPlayBtn && currentPlayBtn !== btn) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentPlayBtn.innerHTML = currentPlayBtn.dataset.play;
    const prev = currentPlayBtn.closest('.audio-player');
    if (prev) { prev.querySelector('.progress-fill').style.width = '0%'; prev.querySelector('.time').textContent = '0:00'; }
  }

  if (currentAudio && currentPlayBtn === btn) {
    if (currentAudio.paused) { currentAudio.play(); btn.innerHTML = btn.dataset.pause; }
    else { currentAudio.pause(); btn.innerHTML = btn.dataset.play; }
    return;
  }

  const audio = new Audio(src);
  currentAudio = audio;
  currentPlayBtn = btn;

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      player.querySelector('.progress-fill').style.width = (audio.currentTime / audio.duration * 100) + '%';
      player.querySelector('.time').textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
    }
  });

  audio.addEventListener('ended', () => {
    btn.innerHTML = btn.dataset.play;
    player.querySelector('.progress-fill').style.width = '0%';
    player.querySelector('.time').textContent = formatTime(audio.duration);
    currentAudio = null;
    currentPlayBtn = null;
  });

  audio.addEventListener('loadedmetadata', () => {
    player.querySelector('.time').textContent = '0:00 / ' + formatTime(audio.duration);
  });

  audio.play();
  btn.innerHTML = btn.dataset.pause;
}

function seekAudio(event, progressWrap) {
  if (!currentAudio) return;
  const player = progressWrap.closest('.audio-player');
  const playerSrc = new URL(getApiBaseUrl() + player.dataset.src, window.location.origin).href;
  const audioSrc = new URL(currentAudio.src, window.location.origin).href;
  if (playerSrc !== audioSrc) return;

  const rect = progressWrap.getBoundingClientRect();
  const pct = (event.clientX - rect.left) / rect.width;
  currentAudio.currentTime = pct * currentAudio.duration;
}


// ===================================================================
//  VOICES
// ===================================================================

async function loadVoices() {
  try {
    const data = await API.get('/api/voices');
    const container = document.getElementById('voices-list');

    if (data.voices.length === 0) {
      container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg><p>No voice files uploaded yet</p></div>`;
      return;
    }

    container.innerHTML = data.voices.map(v => `
      <div class="list-item">
        <div class="list-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></div>
        <div class="list-item-info">
          <div class="list-item-name">${v.filename}</div>
          <div class="list-item-meta">${formatBytes(v.size)}</div>
        </div>
        ${createAudioPlayer(`/api/voices/${v.filename}/audio`)}
        <div class="list-item-actions">
          <button class="btn btn-ghost btn-icon" title="Delete" onclick="deleteVoice('${v.filename}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      </div>`).join('');
  } catch (e) { showToast('Failed to load voices: ' + e.message, 'error'); }
}

async function uploadVoice(file) {
  try {
    await API.upload('/api/voices/upload', file);
    showToast(`Uploaded ${file.name}`, 'success');
    loadVoices();
  } catch (e) { showToast('Upload failed: ' + e.message, 'error'); }
}

async function deleteVoice(filename) {
  if (!confirm(`Delete "${filename}"?`)) return;
  try {
    await API.del(`/api/voices/${filename}`);
    showToast(`Deleted ${filename}`, 'success');
    loadVoices();
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

function setupUploadZone() {
  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('voice-file-input');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) uploadVoice(file);
  });
  input.addEventListener('change', () => {
    for (const file of input.files) uploadVoice(file);
    input.value = '';
  });
}


// ===================================================================
//  TRAINING
// ===================================================================

let trainingGender = 'M';
let pollInterval = null;
let logOffset = 0;

function setGender(btn) {
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  trainingGender = btn.dataset.value;
}

async function loadVoicesForTraining() {
  try {
    const data = await API.get('/api/voices');
    const select = document.getElementById('train-target');
    const cur = select.value;
    select.innerHTML = data.voices.map(v => `<option value="voices/${v.filename}">${v.filename}</option>`).join('');
    if (cur) select.value = cur;
  } catch (e) { /* silent */ }
}

async function loadStylesForTraining() {
  try {
    const data = await API.get('/api/styles');
    const select = document.getElementById('train-reference');
    let html = `<option value="auto">Auto (find best match)</option><option value="none">None (random init)</option>`;
    data.styles.forEach(s => { html += `<option value="${s.path}">${s.type === 'built-in' ? '🔹' : '✅'} ${s.name}</option>`; });
    select.innerHTML = html;
  } catch (e) { /* silent */ }
}

function getTrainConfig() {
  return {
    name: document.getElementById('train-name').value,
    gender: trainingGender,
    target_wav_path: document.getElementById('train-target').value,
    reference_style: document.getElementById('train-reference').value,
    seed: parseInt(document.getElementById('train-seed').value),
    speed: parseFloat(document.getElementById('train-speed').value),
    num_steps: parseInt(document.getElementById('train-steps').value),
    learning_rate: parseFloat(document.getElementById('train-lr').value),
    vocoder_steps: parseInt(document.getElementById('train-vocoder').value),
    save_steps: parseInt(document.getElementById('train-save').value),
    early_stop_loss_threshold: parseFloat(document.getElementById('train-threshold').value),
  };
}

async function startTraining() {
  const config = getTrainConfig();
  if (!config.target_wav_path) { showToast('Please select a target voice file', 'error'); return; }
  try {
    document.getElementById('start-train-btn').disabled = true;
    document.getElementById('stop-train-btn').disabled = false;
    await API.post('/api/train/start', config);
    showToast('Training started!', 'success');
    logOffset = 0;
    document.getElementById('training-logs').innerHTML = '';
    startLogPolling();
  } catch (e) {
    document.getElementById('start-train-btn').disabled = false;
    document.getElementById('stop-train-btn').disabled = true;
    showToast('Failed to start: ' + e.message, 'error');
  }
}

async function stopTraining() {
  try { await API.post('/api/train/stop', {}); showToast('Training stopped', 'info'); }
  catch (e) { showToast('Failed to stop: ' + e.message, 'error'); }
}

function startLogPolling() { if (pollInterval) clearInterval(pollInterval); pollInterval = setInterval(pollTrainingStatus, 1000); }
function stopLogPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

async function pollTrainingStatus() {
  try {
    const data = await API.get(`/api/train/status?since=${logOffset}`);
    updateTrainingBadge(data.status, data.elapsed);

    if (data.logs.length > 0) {
      const el = document.getElementById('training-logs');
      data.logs.forEach(line => {
        const div = document.createElement('div');
        div.className = 'log-line';
        if (line.includes('Loss:') || line.includes('Best:')) div.className += ' highlight';
        if (line.includes('[ERROR]') || line.includes('Error')) div.className += ' error';
        if (line.includes('>>') || line.includes('✅')) div.className += ' info';
        div.textContent = line;
        el.appendChild(div);
      });
      logOffset = data.total_logs;
      el.scrollTop = el.scrollHeight;
    }

    const downloadBtn = document.getElementById('download-train-btn');
    if (downloadBtn) {
      downloadBtn.style.display = data.has_output ? 'inline-flex' : 'none';
    }

    if (['completed', 'error', 'stopped', 'idle'].includes(data.status)) {
      stopLogPolling();
      document.getElementById('start-train-btn').disabled = false;
      document.getElementById('stop-train-btn').disabled = true;
      if (data.status === 'completed') showToast('Training completed! 🎉', 'success');
      else if (data.status === 'error') showToast('Training ended with errors', 'error');
    }
  } catch (e) { /* silent */ }
}

function downloadTrainedStyle() {
  const name = document.getElementById('train-name').value.trim();
  if (!name) return;
  const url = getApiBaseUrl() + `/api/styles/${name}/download`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function updateTrainingBadge(status, elapsed) {
  const badge = document.getElementById('training-badge');
  const text = document.getElementById('training-badge-text');
  badge.className = `badge badge-${status}`;
  const labels = { idle: 'Idle', running: `Running ${elapsed ? '(' + formatElapsed(elapsed) + ')' : ''}`, completed: 'Completed', error: 'Error', stopped: 'Stopped' };
  text.textContent = labels[status] || status;
}


// ===================================================================
//  GENERATE
// ===================================================================

async function loadStylesForGenerate() {
  try {
    const data = await API.get('/api/styles');
    const select = document.getElementById('gen-style');
    const cur = select.value;
    select.innerHTML = data.styles.map(s => `<option value="${s.path}">${s.type === 'built-in' ? '🔹' : '✅'} ${s.name}</option>`).join('');
    if (cur) select.value = cur;
  } catch (e) { showToast('Failed to load styles', 'error'); }
}

async function generateSpeech() {
  const text = document.getElementById('gen-text').value.trim();
  const lang = document.getElementById('gen-lang').value;
  const style = document.getElementById('gen-style').value;
  const speed = parseFloat(document.getElementById('gen-speed').value);
  const totalStep = parseInt(document.getElementById('gen-steps').value);

  if (!text) { showToast('Please enter some text', 'error'); return; }
  if (!style) { showToast('Please select a voice style', 'error'); return; }

  const btn = document.getElementById('generate-btn');
  const result = document.getElementById('generate-result');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating...';
  result.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted-foreground)"><div class="spinner" style="width:24px;height:24px;margin:0 auto .75rem;border-width:2.5px"></div><p style="font-size:.875rem">Generating speech...</p><p style="font-size:.75rem;margin-top:.25rem;opacity:.7">First generation may take longer (loading model)</p></div>`;

  try {
    const data = await API.post('/api/generate', { text, lang, style, total_step: totalStep, speed });
    result.innerHTML = `<div style="margin-bottom:.75rem"><div style="font-size:.875rem;font-weight:500;margin-bottom:.5rem">🎵 ${data.filename}</div>${createAudioPlayer(data.audio_url)}</div><p style="font-size:.75rem;color:var(--muted-foreground)">Audio saved to samples/${data.filename}</p>`;
    showToast('Speech generated!', 'success');
  } catch (e) {
    result.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><p style="color:var(--destructive)">Failed: ${e.message}</p></div>`;
    showToast('Generation failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Generate`;
  }
}


// ===================================================================
//  SAMPLES
// ===================================================================

async function loadSamples() {
  try {
    const data = await API.get('/api/samples');
    const container = document.getElementById('samples-list');

    if (data.samples.length === 0) {
      container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><p>No generated samples yet</p></div>`;
      return;
    }

    container.innerHTML = data.samples.map(s => `
      <div class="list-item">
        <div class="list-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></div>
        <div class="list-item-info">
          <div class="list-item-name">${s.filename}</div>
          <div class="list-item-meta">${formatBytes(s.size)}</div>
        </div>
        ${createAudioPlayer(`/api/samples/${s.filename}/audio`)}
        <div class="list-item-actions">
          <button class="btn btn-ghost btn-icon" title="Delete" onclick="deleteSample('${s.filename}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      </div>`).join('');
  } catch (e) { showToast('Failed to load samples: ' + e.message, 'error'); }
}

async function deleteSample(filename) {
  if (!confirm(`Delete "${filename}"?`)) return;
  try {
    await API.del(`/api/samples/${filename}`);
    showToast(`Deleted ${filename}`, 'success');
    loadSamples();
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}


// ===================================================================
//  SETTINGS
// ===================================================================

let selectedBackendMode = 'local';

function selectBackendMode(mode) {
  selectedBackendMode = mode;
  document.getElementById('btn-backend-local').classList.toggle('active', mode === 'local');
  document.getElementById('btn-backend-cloud').classList.toggle('active', mode === 'cloud');

  const endpointInput = document.getElementById('setting-endpoint');
  
  if (mode === 'local') {
    endpointInput.disabled = true;
    endpointInput.value = window.location.origin;
  } else {
    endpointInput.disabled = false;
    endpointInput.value = localStorage.getItem('st3-backend-endpoint') || 'http://localhost:8000';
  }
}

function loadBackendSettingsUI() {
  const mode = localStorage.getItem('st3-backend-mode') || 'local';
  selectBackendMode(mode);
}

function saveBackendSettings() {
  const endpointInput = document.getElementById('setting-endpoint');
  let endpoint = endpointInput.value.trim();

  if (selectedBackendMode === 'cloud') {
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      showToast('Endpoint URL must start with http:// or https://', 'error');
      return;
    }
    localStorage.setItem('st3-backend-endpoint', endpoint);
  }
  
  localStorage.setItem('st3-backend-mode', selectedBackendMode);
  showToast('Backend settings saved successfully!', 'success');
}

async function testBackendConnection() {
  const btn = event.currentTarget;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Testing...';

  const mode = selectedBackendMode;
  let endpoint = document.getElementById('setting-endpoint').value.trim();
  if (mode === 'local') {
    endpoint = window.location.origin;
  }
  
  endpoint = endpoint.replace(/\/$/, '');

  try {
    const res = await fetch(endpoint + '/api/voices', { method: 'GET' });
    if (res.ok) {
      showToast('Connection successful! Backend is reachable.', 'success');
    } else {
      showToast('Connection failed: server returned status ' + res.status, 'error');
    }
  } catch (e) {
    showToast('Connection failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}


function handleLogoClick() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('collapsed')) {
    toggleSidebar();
  }
}


// ===================================================================
//  INIT
// ===================================================================

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadSidebarState();
  setupUploadZone();
  loadBackendSettingsUI();
  loadVoices();

  // Resume polling if training was already running
  pollTrainingStatus().then(() => {
    const badge = document.getElementById('training-badge');
    if (badge.classList.contains('badge-running')) {
      document.getElementById('start-train-btn').disabled = true;
      document.getElementById('stop-train-btn').disabled = false;
      startLogPolling();
    }
  });
});
