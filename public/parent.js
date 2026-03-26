/* =====================================================
   parent.js — 親デバイス側ロジック
   ===================================================== */

const socket = io({ transports: ['websocket', 'polling'] });

// ---- 状態 ----
let peerConnection = null;
let localStream = null;

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
  updateStatusUI(true);
});

socket.on('child-disconnected', () => {
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
// 画面共有
// =====================================================
async function startScreenShare() {
  const btnStart = document.getElementById('btn-start-share');
  const btnStop  = document.getElementById('btn-stop-share');

  if (!btnStart.disabled && !confirm('子PCが接続されていない場合でも開始しますか？\n（先に子PC側でページを開くことを推奨します）')) {
    // 子が接続済みなら確認不要
  }

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 44100,
      },
    });
  } catch (e) {
    setShareStatus('画面共有がキャンセルされました: ' + e.message);
    return;
  }

  // 音声トラックの有無を確認して警告表示
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) {
    setShareStatus('⚠ 音声トラックなし（Macではタブ共有を選択し「Share audio」にチェックを入れてください）');
  }

  // ユーザーが共有ダイアログを閉じた場合
  localStream.getVideoTracks()[0].addEventListener('ended', () => {
    stopScreenShare();
  });

  await createPeerConnection();
  // 映像・音声トラックを明示的に追加（親側では再生しない）
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc-offer', { sdp: offer.sdp });
    if (audioTracks.length > 0) setShareStatus('配信中...');
  } catch (e) {
    setShareStatus('接続エラー: ' + e.message);
    stopScreenShare();
    return;
  }

  btnStart.disabled = true;
  btnStop.disabled  = false;
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
  document.getElementById('btn-stop-share').disabled  = true;
  setShareStatus('');
}

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc-ice', { candidate });
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
// 音量コントロール
// =====================================================
function onVolumeInput(val) {
  document.getElementById('volume-label').textContent = val + '%';
  document.getElementById('volume-icon').textContent =
    val == 0 ? '🔇' : val < 50 ? '🔉' : '🔊';
  socket.emit('screen-volume', { volume: parseInt(val) / 100 });
}

function setVolume(val) {
  document.getElementById('volume-slider').value = val;
  onVolumeInput(val);
}

// =====================================================
// 初期化
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
  // Renderスリープ対策: 5分ごとに /ping を叩いてサーバーを起こし続ける
  const keepAliveInterval = setInterval(() => {
    fetch('/ping').catch(() => {});
  }, 5 * 60 * 1000);
  window.addEventListener('beforeunload', () => clearInterval(keepAliveInterval));
});
