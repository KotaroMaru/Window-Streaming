/* =====================================================
   child.js — 子PC（プロジェクター）側ロジック
   ===================================================== */

// ---- DOM ----
const remoteVideo   = document.getElementById('remote-video');
const childAudio    = document.getElementById('child-audio');
const overlay       = document.getElementById('child-overlay');
const statusText    = document.getElementById('child-status-text');
const spinner       = document.getElementById('child-spinner');
const bgmVisualizer = document.getElementById('bgm-visualizer');

// ---- 状態 ----
let peerConnection = null;
let currentMode = 'screen';
let socket = null;
let reconnectTimer = null;

// WebRTC 設定
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// =====================================================
// Socket.io 接続（自動再接続）
// =====================================================
function connect() {
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('[socket] connected');
    socket.emit('register', 'child');
    setStatus('親デバイスの接続を待機中...');
  });

  socket.on('registered', () => {
    console.log('[socket] registered as child');
  });

  socket.on('disconnect', () => {
    console.log('[socket] disconnected — retrying...');
    setStatus('サーバーから切断されました。再接続中...');
    cleanupPeer();
    showOverlay();
    hideVideo();
    hideBgmVisualizer();
  });

  // WebRTC シグナリング
  socket.on('webrtc-offer', handleOffer);
  socket.on('webrtc-ice',   handleIce);

  // BGM 制御コマンド
  socket.on('bgm-play',   handleBgmPlay);
  socket.on('bgm-stop',   handleBgmStop);
  socket.on('bgm-volume', handleBgmVolume);
  socket.on('bgm-next',   handleBgmNext);
  socket.on('bgm-prev',   handleBgmPrev);
  socket.on('bgm-seek',   handleBgmSeek);

  // モード変更
  socket.on('mode-change', ({ mode }) => {
    currentMode = mode;
    if (mode === 'screen') {
      hideBgmVisualizer();
    } else if (mode === 'bgm') {
      hideVideo();
    }
  });

  // 親が切断
  socket.on('parent-disconnected', () => {
    setStatus('親デバイスが切断されました。待機中...');
    cleanupPeer();
    hideVideo();
    hideBgmVisualizer();
    showOverlay();
    childAudio.src = '';
    childAudio.pause();
  });
}

// =====================================================
// WebRTC — offer 受信 → answer 送信
// =====================================================
async function handleOffer({ sdp }) {
  cleanupPeer();
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.ontrack = ({ streams }) => {
    if (streams && streams[0]) {
      remoteVideo.srcObject = streams[0];
      remoteVideo.play().catch(() => {});
      showVideo();
      hideOverlay();
    }
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('webrtc-ice', { candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log('[WebRTC] state:', state);
    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      cleanupPeer();
      hideVideo();
      showOverlay();
      setStatus('映像接続が切断されました。待機中...');
    }
  };

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc-answer', { sdp: answer.sdp });
  } catch (e) {
    console.error('[WebRTC] handleOffer error', e);
  }
}

async function handleIce({ candidate }) {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.warn('[WebRTC] addIceCandidate error', e);
  }
}

function cleanupPeer() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
}

// =====================================================
// BGM 制御
// =====================================================
function handleBgmPlay({ url }) {
  hideVideo();
  childAudio.src = url;
  childAudio.load();
  childAudio.play().catch(e => console.warn('audio play error', e));
  showBgmVisualizer();
  hideOverlay();
}

function handleBgmStop() {
  childAudio.pause();
  hideBgmVisualizer();
  showOverlay();
  setStatus('親デバイスの接続を待機中...');
}

function handleBgmVolume({ volume }) {
  childAudio.volume = Math.max(0, Math.min(1, volume));
}

function handleBgmNext() {}
function handleBgmPrev() {}
function handleBgmSeek({ time }) {
  if (!isNaN(time)) childAudio.currentTime = time;
}

// =====================================================
// UI ヘルパー
// =====================================================
function setStatus(msg) { statusText.textContent = msg; }

function showOverlay() { overlay.classList.remove('hidden'); }
function hideOverlay() { overlay.classList.add('hidden'); }

function showVideo() {
  remoteVideo.classList.add('active');
  hideBgmVisualizer();
}
function hideVideo() { remoteVideo.classList.remove('active'); }

function showBgmVisualizer() { bgmVisualizer.classList.add('active'); }
function hideBgmVisualizer() { bgmVisualizer.classList.remove('active'); }

// =====================================================
// フルスクリーン（自動・再試行付き）
// =====================================================
function tryFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(e => {
      console.warn('fullscreen denied:', e.message);
    });
  }
}

// ページ読み込み直後にフルスクリーン試行
// ブラウザポリシーでブロックされる場合はクリックで再試行
document.addEventListener('DOMContentLoaded', () => {
  tryFullscreen();
  connect();
});

// ユーザー操作でフルスクリーンが外れた場合に再度要求
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    // 少し待ってから再試行（ユーザー操作なしの場合はブラウザに拒否される可能性あり）
    setTimeout(tryFullscreen, 1500);
  }
});

// タッチ・クリックでフルスクリーン回復
document.addEventListener('click',     tryFullscreen);
document.addEventListener('touchstart', tryFullscreen);

// キープアライブ: 画面スリープ防止（Wake Lock API）
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
      console.log('[WakeLock] acquired');
    } catch (e) {
      console.warn('[WakeLock]', e.message);
    }
  }
}
document.addEventListener('DOMContentLoaded', requestWakeLock);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
