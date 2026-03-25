const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// uploadsディレクトリがなければ作成
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// multerストレージ設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // オリジナルファイル名を保持（重複時はタイムスタンプを付与）
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u3040-\u9FFF]/g, '_');
    const name = `${Date.now()}_${base}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB上限
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp3|aac|flac|wav|ogg|m4a)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('音声ファイル（mp3/aac/flac/wav/ogg/m4a）のみアップロード可能です'));
    }
  },
});

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// ヘルスチェック（Renderスリープ対策）
app.get('/ping', (req, res) => res.json({ status: 'ok' }));

// ルート → child.html
app.get('/', (req, res) => res.redirect('/child.html'));

// BGMファイル一覧取得
app.get('/api/bgm', (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return res.json([]);
    const list = files
      .filter(f => /\.(mp3|aac|flac|wav|ogg|m4a)$/i.test(f))
      .map(f => ({
        filename: f,
        displayName: f.replace(/^\d+_/, ''), // タイムスタンププレフィックスを除去して表示
        url: `/bgm/${encodeURIComponent(f)}`,
      }));
    res.json(list);
  });
});

// BGMファイルアップロード
app.post('/api/bgm/upload', upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'ファイルがありません' });
  }
  const uploaded = req.files.map(f => ({
    filename: f.filename,
    displayName: f.filename.replace(/^\d+_/, ''),
    url: `/bgm/${encodeURIComponent(f.filename)}`,
  }));
  res.json({ uploaded });
});

// BGMファイル削除
app.delete('/api/bgm/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, path.basename(filename));
  fs.unlink(filepath, err => {
    if (err) return res.status(404).json({ error: 'ファイルが見つかりません' });
    res.json({ ok: true });
  });
});

// BGMストリーミング（Range requestsサポート）
app.get('/bgm/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, path.basename(filename));

  if (!fs.existsSync(filepath)) {
    return res.status(404).send('Not found');
  }

  const stat = fs.statSync(filepath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  };
  const contentType = mimeMap[ext] || 'audio/mpeg';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filepath).pipe(res);
  }
});

// ============================================================
// Socket.io: WebRTCシグナリング + BGM制御中継
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
    if (childSocket) {
      childSocket.emit('webrtc-offer', data);
    }
  });

  // 子 → 親: answer
  socket.on('webrtc-answer', data => {
    if (parentSocket) {
      parentSocket.emit('webrtc-answer', data);
    }
  });

  // 双方向: ICE candidate
  socket.on('webrtc-ice', data => {
    if (socket === parentSocket && childSocket) {
      childSocket.emit('webrtc-ice', data);
    } else if (socket === childSocket && parentSocket) {
      parentSocket.emit('webrtc-ice', data);
    }
  });

  // ---- BGM制御コマンド（親 → 子） ----
  const bgmCommands = ['bgm-play', 'bgm-stop', 'bgm-volume', 'bgm-next', 'bgm-prev', 'bgm-seek', 'mode-change'];
  bgmCommands.forEach(cmd => {
    socket.on(cmd, data => {
      if (socket === parentSocket && childSocket) {
        childSocket.emit(cmd, data);
      }
    });
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
