/* =====================================================
   parent.js — 親デバイス側ロジック
   ===================================================== */

const socket = io({ transports: ['websocket', 'polling'] });

// ---- 状態 ----
let peerConnection = null;
let localStream = null;
let currentMode = 'screen';
let isPlaying = false;
let currentTrackIndex = -1;
let playlist = [];
let isChildConnected = false;

// ---- WebRTC 設定 ----
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// =====================================================
// Socket.io イベント
// =====================================================
socket.on('connect', () => {
  socket.emit('register', 'parent');
});

socket.on('registered', () => {
  console.log('[socket] registered as parent');
});

socket.on('child-connected', () => {
  isChildConnected = true;
  updateStatusUI(true);
});

socket.on('child-disconnected', () => {
  isChildConnected = false;
  updateStatusUI(false);
  stopScreenShare();
});

socket.on('parent-disconnected', () => {});

// WebRTC シグナリング受信
socket.on('webrtc-answer', async ({ sdp }) => {
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    console.log('[WebRTC] remote description set');
  } catch (e) {
    console.error('[WebRTC] setRemoteDescription error', e);
  }
});

socket.on('webrtc-ice', async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.warn('[WebRTC] addIceCandidate error', e);
  }
});

// =====================================================
// UI ヘルパー
// =====================================================
function updateStatusUI(connected) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.classList.toggle('connected', connected);
  text.textContent = connected ? '子PC: 接続中' : '子PC: 未接続';
}

function setShareStatus(msg) {
  document.getElementById('share-status').textContent = msg;
}

// =====================================================
// モード切替
// =====================================================
function switchMode(mode) {
  currentMode = mode;

  document.getElementById('tab-screen').classList.toggle('active', mode === 'screen');
  document.getElementById('tab-bgm').classList.toggle('active', mode === 'bgm');
  document.getElementById('section-screen').classList.toggle('active', mode === 'screen');
  document.getElementById('section-bgm').classList.toggle('active', mode === 'bgm');

  // BGMモードへ切替時にプレイリストを取得
  if (mode === 'bgm') {
    fetchPlaylist();
  }

  // 子へモード変更を通知
  socket.emit('mode-change', { mode });
}

// =====================================================
// 画面共有
// =====================================================
async function startScreenShare() {
  if (!isChildConnected) {
    alert('子PCが接続されていません。先に子PCでページを開いてください。');
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true,
    });
  } catch (e) {
    setShareStatus('画面共有がキャンセルされました: ' + e.message);
    return;
  }

  // ユーザーが共有ダイアログを閉じた場合
  localStream.getVideoTracks()[0].addEventListener('ended', () => {
    stopScreenShare();
  });

  await createPeerConnection();
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc-offer', { sdp: offer.sdp });
    setShareStatus('配信中...');
  } catch (e) {
    setShareStatus('接続エラー: ' + e.message);
    stopScreenShare();
    return;
  }

  document.getElementById('btn-start-share').disabled = true;
  document.getElementById('btn-stop-share').disabled = false;
}

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  document.getElementById('btn-start-share').disabled = false;
  document.getElementById('btn-stop-share').disabled = true;
  setShareStatus('');
}

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc-ice', { candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log('[WebRTC] connection state:', state);
    if (state === 'connected') {
      setShareStatus('配信中（WebRTC接続確立）');
    } else if (state === 'failed' || state === 'disconnected') {
      setShareStatus('接続が切れました');
      stopScreenShare();
    }
  };
}

// =====================================================
// BGM — ファイルアップロード
// =====================================================
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('bgm-file-input');

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadFiles(fileInput.files);
  fileInput.value = '';
});

async function uploadFiles(files) {
  const progress = document.getElementById('upload-progress');
  const formData = new FormData();
  for (const f of files) formData.append('files', f);

  progress.textContent = 'アップロード中...';
  try {
    const res = await fetch('/api/bgm/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    progress.textContent = `${data.uploaded.length}曲をアップロードしました`;
    await fetchPlaylist();
  } catch (e) {
    progress.textContent = 'エラー: ' + e.message;
  }
}

// =====================================================
// BGM — プレイリスト
// =====================================================
async function fetchPlaylist() {
  try {
    const res = await fetch('/api/bgm');
    playlist = await res.json();
    renderPlaylist();
  } catch (e) {
    console.error('fetchPlaylist error', e);
  }
}

function renderPlaylist() {
  const ul = document.getElementById('playlist');
  const empty = document.getElementById('playlist-empty');
  ul.innerHTML = '';

  if (playlist.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  playlist.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (i === currentTrackIndex ? ' playing' : '');
    li.dataset.index = i;
    li.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <span class="track-name" title="${escHtml(track.displayName)}">${escHtml(track.displayName)}</span>
      <button class="del-btn" title="削除" onclick="deleteTrack(event, ${i})">✕</button>
    `;
    li.addEventListener('click', () => selectAndPlay(i));
    ul.appendChild(li);
  });
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function deleteTrack(e, index) {
  e.stopPropagation();
  const track = playlist[index];
  if (!confirm(`「${track.displayName}」を削除しますか？`)) return;
  try {
    await fetch(`/api/bgm/${encodeURIComponent(track.filename)}`, { method: 'DELETE' });
    if (currentTrackIndex === index) {
      stopBgm();
    } else if (currentTrackIndex > index) {
      currentTrackIndex--;
    }
    await fetchPlaylist();
  } catch (e) {
    console.error('deleteTrack error', e);
  }
}

// =====================================================
// BGM — 再生制御
// =====================================================
function selectAndPlay(index) {
  currentTrackIndex = index;
  isPlaying = true;
  renderPlaylist();
  updateNowPlaying();
  sendBgmPlay();
}

function togglePlayPause() {
  if (playlist.length === 0) return;
  if (currentTrackIndex < 0) {
    selectAndPlay(0);
    return;
  }
  isPlaying = !isPlaying;
  document.getElementById('btn-play-pause').textContent = isPlaying ? '⏸' : '▶';
  if (isPlaying) {
    sendBgmPlay();
  } else {
    socket.emit('bgm-stop', {});
  }
}

function prevTrack() {
  if (playlist.length === 0) return;
  currentTrackIndex = currentTrackIndex <= 0 ? playlist.length - 1 : currentTrackIndex - 1;
  isPlaying = true;
  renderPlaylist();
  updateNowPlaying();
  sendBgmPlay();
}

function nextTrack() {
  if (playlist.length === 0) return;
  currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
  isPlaying = true;
  renderPlaylist();
  updateNowPlaying();
  sendBgmPlay();
}

function stopBgm() {
  isPlaying = false;
  document.getElementById('btn-play-pause').textContent = '▶';
  socket.emit('bgm-stop', {});
}

function sendBgmPlay() {
  if (currentTrackIndex < 0 || currentTrackIndex >= playlist.length) return;
  const track = playlist[currentTrackIndex];
  document.getElementById('btn-play-pause').textContent = '⏸';
  socket.emit('bgm-play', {
    url: track.url,
    filename: track.filename,
    displayName: track.displayName,
    index: currentTrackIndex,
  });
}

function setVolume(val) {
  document.getElementById('volume-label').textContent = val + '%';
  socket.emit('bgm-volume', { volume: parseInt(val) / 100 });
}

function updateNowPlaying() {
  const name = currentTrackIndex >= 0 && playlist[currentTrackIndex]
    ? playlist[currentTrackIndex].displayName
    : '— 選択なし —';
  document.getElementById('now-playing-name').textContent = name;
}

// =====================================================
// 初期化
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
  // BGMセクションが先に選ばれていてもプレイリストを遅延ロード
  if (currentMode === 'bgm') fetchPlaylist();

  // Renderスリープ対策: 5分ごとに /ping を叩いてサーバーを起こし続ける
  const keepAliveInterval = setInterval(() => {
    fetch('/ping').catch(() => {});
  }, 5 * 60 * 1000);
  window.addEventListener('beforeunload', () => clearInterval(keepAliveInterval));
});
