# Vibe Tool Video

Công cụ tạo video tự động từ chủ đề hoặc kịch bản JSON. Pipeline đầy đủ: tạo kịch bản (AI) → tạo ảnh (AI) → tạo giọng đọc (TTS) → tạo phụ đề → render video từng cảnh → ghép video cuối với nhạc nền và logo.

---

## Yêu cầu hệ thống

| Phần mềm | Phiên bản tối thiểu | Ghi chú |
|----------|---------------------|---------|
| Node.js | v18+ | Môi trường chạy server |
| ffmpeg | v5+ | Xử lý video/audio |
| Google Chrome | Bất kỳ | Puppeteer render frame |

### API Keys cần có

| Service | Mục đích | Lấy ở đâu |
|---------|----------|-----------|
| **Chato1** | Tạo kịch bản + tạo ảnh AI | [chat01.ai](https://chat01.ai) |
| **LucyLab Vivibe** | Tạo giọng đọc (TTS) | [lucylab.io](https://lucylab.io) |

---

## Cài đặt trên macOS

### Bước 1 — Cài Homebrew (nếu chưa có)

Mở Terminal và chạy:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Bước 2 — Cài Node.js

```bash
brew install node
```

Kiểm tra:

```bash
node --version   # v18.x.x trở lên
npm --version
```

### Bước 3 — Cài ffmpeg

```bash
brew install ffmpeg
```

Kiểm tra:

```bash
ffmpeg -version
ffprobe -version
```

### Bước 4 — Cài Google Chrome

Tải về tại [google.com/chrome](https://www.google.com/chrome/) và cài đặt bình thường.

### Bước 5 — Tải source code

```bash
git clone https://github.com/chauanhdung995/vibe-tool-video.git
cd vibe-tool-video
```

> Nếu repo là **private**, Git sẽ hỏi username và password.
> - Username: địa chỉ email GitHub của bạn
> - Password: **Personal Access Token** (xem hướng dẫn tạo token bên dưới)

### Bước 6 — Cài dependencies

```bash
npm install
```

### Bước 7 — Khởi động

```bash
node server.js
```

Truy cập: [http://127.0.0.1:3000](http://127.0.0.1:3000)

---

## Cài đặt trên Windows

### Bước 1 — Cài Node.js

1. Vào [nodejs.org](https://nodejs.org) → tải bản **LTS**
2. Chạy file `.msi` và cài đặt theo hướng dẫn (giữ nguyên tùy chọn mặc định)
3. Sau khi cài xong, mở **Command Prompt** hoặc **PowerShell** và kiểm tra:

```cmd
node --version
npm --version
```

### Bước 2 — Cài ffmpeg

**Cách 1 — Dùng winget (Windows 10/11, khuyên dùng):**

```cmd
winget install Gyan.FFmpeg
```

Sau đó khởi động lại Command Prompt và kiểm tra: `ffmpeg -version`

**Cách 2 — Thủ công:**

1. Vào [ffmpeg.org/download.html](https://ffmpeg.org/download.html) → chọn **Windows builds from gyan.dev**
2. Tải file `ffmpeg-release-essentials.zip`
3. Giải nén vào `C:\ffmpeg\`
4. Thêm `C:\ffmpeg\bin` vào **PATH**:
   - Tìm kiếm **"Edit the system environment variables"** trong Start Menu
   - Nhấn **Environment Variables** → chọn dòng `Path` → **Edit**
   - Nhấn **New** → nhập `C:\ffmpeg\bin` → OK hết
5. Khởi động lại Command Prompt, kiểm tra: `ffmpeg -version`

### Bước 3 — Cài Google Chrome

Tải về tại [google.com/chrome](https://www.google.com/chrome/) và cài đặt bình thường.

### Bước 4 — Cài Git (nếu chưa có)

```cmd
winget install Git.Git
```

Sau đó khởi động lại Command Prompt.

### Bước 5 — Tải source code

Mở **Command Prompt** hoặc **PowerShell**:

```cmd
git clone https://github.com/chauanhdung995/vibe-tool-video.git
cd vibe-tool-video
```

> Nếu repo là **private**, Git sẽ hỏi username và password.
> - Username: địa chỉ email GitHub của bạn
> - Password: **Personal Access Token** (xem hướng dẫn tạo token bên dưới)

### Bước 6 — Cài dependencies

```cmd
npm install
```

### Bước 7 — Khởi động

```cmd
node server.js
```

Truy cập: [http://127.0.0.1:3000](http://127.0.0.1:3000)

---

## Cấu hình ban đầu

Sau khi khởi động, mở [http://127.0.0.1:3000](http://127.0.0.1:3000) và vào phần **⚙ Cài đặt nâng cao**:

1. **CHATO1 API KEYS** — Tải file `.txt` chứa danh sách API key (mỗi key một dòng)
2. **LUCYLAB API KEY** — Dán API key của LucyLab Vivibe
3. **VOICE ID** — Dán Voice ID muốn dùng

Tất cả cài đặt được lưu tự động, không cần làm lại mỗi lần khởi động.

---

## Cấu hình đường dẫn ffmpeg (nếu cần)

Mặc định tool tìm `ffmpeg` và `ffprobe` trong PATH hệ thống. Nếu cài ở vị trí tùy chỉnh, chỉnh file `storage/settings.json` sau khi khởi động lần đầu:

**Windows:**
```json
{
  "ffmpegPath": "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "ffprobePath": "C:\\ffmpeg\\bin\\ffprobe.exe"
}
```

**macOS (nếu dùng Homebrew):** thường không cần chỉnh, ffmpeg đã nằm trong PATH.

---

## Chạy nền tự động (tùy chọn)

Dùng `pm2` để tool tự khởi động lại khi tắt Terminal hoặc reboot máy:

```bash
npm install -g pm2
pm2 start server.js --name vibe-tool
pm2 startup    # làm theo hướng dẫn hiện ra
pm2 save
```

Lệnh quản lý:
```bash
pm2 status          # xem trạng thái
pm2 logs vibe-tool  # xem log
pm2 restart vibe-tool
pm2 stop vibe-tool
```

---

## Cấu trúc thư mục

```
vibe-tool-video/
├── public/          # Giao diện web (HTML, CSS, JS)
├── src/
│   ├── config/      # Hằng số, cấu hình mặc định
│   ├── lib/         # Tiện ích chung (fs, logger)
│   ├── routes/      # API endpoints
│   └── services/    # Logic nghiệp vụ (pipeline, render, AI...)
├── projects/        # Dữ liệu dự án (tự tạo khi chạy)
├── storage/         # Cài đặt ứng dụng (tự tạo khi chạy)
├── tmp/             # File tạm (tự tạo khi chạy)
└── server.js        # Entry point
```

---

## Lệnh thường dùng

```bash
node server.js            # Khởi động
node --watch server.js    # Khởi động với auto-reload khi sửa code
```

---

## Tính năng nổi bật

### Nhạc nền
- Chọn một hoặc nhiều file nhạc — hệ thống tự ghép nối và loop
- **Thanh trượt âm lượng** (0–100%) ngay trong sidebar, mặc định 18%

### Ảnh tham chiếu nhân vật
Có thể chỉ định ảnh tham chiếu ở 3 cấp độ:

| Cấp độ | Cách thiết lập |
|--------|---------------|
| Toàn bộ video | Dán URL vào ô **ẢNH THAM CHIẾU** trên sidebar |
| Từng cảnh (modal) | Mở **✏ Sửa** → điền URL vào ô **URL ảnh tham chiếu** |
| Từng cảnh (JSON) | Đặt `"useReferenceImage": "https://..."` trong kịch bản JSON |

Giá trị `useReferenceImage` trong JSON chấp nhận ba dạng:
- `false` — không dùng ảnh tham chiếu
- `true` — dùng URL tham chiếu chung (sidebar)
- `"https://..."` — dùng URL ảnh cụ thể cho riêng cảnh đó

### Phụ đề (burn-in)
- Tự động tạo file `.srt` và `.ass` từ audio
- Render phụ đề trực tiếp vào video (không cần player hỗ trợ)

### Hiệu ứng chuyển động
Tất cả hiệu ứng dùng hàm tuần hoàn (seamless loop, không khựng khi lặp):

| Hiệu ứng | Mô tả |
|----------|-------|
| Phóng to / Thu nhỏ | Pulse 2 chu kỳ/cảnh |
| Di chuyển trái/phải | Sine oscillation 2 chu kỳ/cảnh |
| Lắc lư nhẹ (sway) | 2° pendulum, tự bù offset để không lộ mép trên |
| Zoom + trượt | Kết hợp pulse zoom + sine pan |
| Random | Tự chọn hiệu ứng theo hash cảnh |
