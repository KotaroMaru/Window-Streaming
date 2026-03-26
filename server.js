const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

const PORT = process.env.PORT || 3000;

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// ヘルスチェック（Renderスリープ対策）
app.get('/ping', (req, res) => res.json({ status: 'ok' }));

// ルート → child.html
app.get('/', (req, res) => res.redirect('/child.html'));

// ============================================================
// Socket.io: WebRTCシグナリング + 音量制御中継
// ============================================================
let parentSocket = null;
let childSocket = null;

io.on('connection', socket => {
  console.log(`[connect] ${socket.id}`);

  // ロール登録
  socket.on('register', role => {
    if (role === 'parent') {
      parentSocket = socket;
      console.log('[register] parent:', socket.id);
      socket.emit('registered', { role: 'parent' });
      // 子が既に接続中なら親へ通知
      if (childSocket) {
        socket.emit('child-connected');
      }
    } else if (role === 'child') {
      childSocket = socket;
      console.log('[register] child:', socket.id);
      socket.emit('registered', { role: 'child' });
      // 親へ子の接続を通知
      if (parentSocket) {
        parentSocket.emit('child-connected');
      }
    }
  });

  // ---- WebRTC シグナリング ----

  // 親 → 子: offer
  socket.on('webrtc-offer', data => {
    if (childSocket) childSocket.emit('webrtc-offer', data);
  });

  // 子 → 親: answer
  socket.on('webrtc-answer', data => {
    if (parentSocket) parentSocket.emit('webrtc-answer', data);
  });

  // 双方向: ICE candidate
  socket.on('webrtc-ice', data => {
    if (socket === parentSocket && childSocket) {
      childSocket.emit('webrtc-ice', data);
    } else if (socket === childSocket && parentSocket) {
      parentSocket.emit('webrtc-ice', data);
    }
  });

  // ---- 音量制御（親 → 子） ----
  socket.on('screen-volume', data => {
    if (socket === parentSocket && childSocket) {
      childSocket.emit('screen-volume', data);
    }
  });

  // ---- 切断処理 ----
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    if (socket === parentSocket) {
      parentSocket = null;
      if (childSocket) childSocket.emit('parent-disconnected');
    } else if (socket === childSocket) {
      childSocket = null;
      if (parentSocket) parentSocket.emit('child-disconnected');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`  Parent: http://localhost:${PORT}/parent.html`);
  console.log(`  Child:  http://localhost:${PORT}/child.html`);
});
