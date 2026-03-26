/* =====================================================
   child.js — 子PC（プロジェクター）側ロジック
   ===================================================== */

// ---- DOM ----
const remoteVideo = document.getElementById('remote-video');
const overlay     = document.getElementById('child-overlay');
const statusText  = document.getElementById('child-status-text');

// ---- 状態 ----
let peerConnection = null;
let socket = null;

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
  });

  // WebRTC シグナリング
  socket.on('webrtc-offer', handleOffer);
  socket.on('webrtc-ice',   handleIce);

  // 音量制御
  socket.on('screen-volume', ({ volume }) => {
    remoteVideo.volume = Math.max(0, Math.min(1, volume));
  });

  // 親が切断
  socket.on('parent-disconnected', () => {
    setStatus('親デバイスが切断されました。待機中...');
    cleanupPeer();
    hideVideo();
    showOverlay();
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
      remoteVideo.volume = 1.0;
      // まず muted で再生開始（自動再生ポリシー対策）
      remoteVideo.muted = true;
      remoteVideo.play()
        .then(() => {
          // 再生開始後にアンミュート
          remoteVideo.muted = false;
        })
        .catch(() => {
          // 自動アンミュート失敗時はボタンを表示してユーザー操作を促す
          showUnmuteButton();
        });
      showVideo();
      hideOverlay();
    }
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc-ice', { candidate });
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
// UI ヘルパー
// =====================================================
function setStatus(msg) { statusText.textContent = msg; }

function showOverlay() { overlay.classList.remove('hidden'); }
function hideOverlay() { overlay.classList.add('hidden'); }

function showVideo() { remoteVideo.classList.add('active'); }
function hideVideo() { remoteVideo.classList.remove('active'); }

function showUnmuteButton() {
  const btn = document.getElementById('unmute-btn');
  if (btn) btn.style.display = 'flex';
}
function hideUnmuteButton() {
  const btn = document.getElementById('unmute-btn');
  if (btn) btn.style.display = 'none';
}

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

document.addEventListener('DOMContentLoaded', () => {
  tryFullscreen();
  connect();
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    setTimeout(tryFullscreen, 1500);
  }
});

document.addEventListener('click',      tryFullscreen);
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
