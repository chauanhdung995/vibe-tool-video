# Vibe Tool Video

Ứng dụng web chạy local để tạo video tự động từ chủ đề hoặc kịch bản JSON.

Pipeline chính:

```text
chủ đề / JSON -> script -> ảnh từng cảnh -> voice LarVoice -> phụ đề -> render HyperFrames -> ghép video -> thumbnail -> SEO
```

Phiên bản hiện tại đã được đơn giản hóa:

- API ảnh và văn bản chỉ dùng **Chat01.ai**.
- TTS chỉ dùng **LarVoice**.
- Không còn lựa chọn provider khác trên giao diện.
- Các cài đặt API chính hiển thị trực tiếp trên sidebar, không nằm trong phần cài đặt nâng cao.
- Voice LarVoice có danh sách giọng và file MP3 nghe thử trong giao diện.

## Yêu Cầu

| Thành phần | Bắt buộc | Ghi chú |
|---|---:|---|
| Node.js | Có | Khuyến nghị Node 18+ |
| ffmpeg / ffprobe | Có | Ghép audio, video, phụ đề, nhạc nền |
| Google Chrome | Có | Dùng cho bước render frame |
| Chat01.ai API keys | Có | Tạo script, ảnh, thumbnail, SEO |
| LarVoice API key | Có | Tạo giọng đọc |
| faster-whisper | Không bắt buộc | Nếu thiếu, app tự tạo phụ đề fallback từ `voiceText` |

## Cài Đặt Nhanh

```bash
npm install
npm start
```

Mở trình duyệt tại:

```text
http://127.0.0.1:3000
```

Lệnh khác:

```bash
npm run dev
```

Nếu muốn đổi port:

```bash
PORT=3001 npm start
```

## Cài Trên macOS

```bash
brew install node ffmpeg
```

Cài Google Chrome nếu máy chưa có:

```text
https://www.google.com/chrome/
```

Sau đó chạy:

```bash
npm install
npm start
```

Nếu Chrome nằm ở đường dẫn đặc biệt, đặt biến môi trường:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm start
```

## Cài Trên Windows

Cài Node.js LTS:

```text
https://nodejs.org/
```

Cài ffmpeg bằng winget:

```cmd
winget install Gyan.FFmpeg
```

Cài Google Chrome:

```text
https://www.google.com/chrome/
```

Sau đó mở PowerShell hoặc Command Prompt trong thư mục dự án:

```cmd
npm install
npm start
```

Nếu Chrome không được nhận diện, đặt `CHROME_PATH` trỏ tới file `chrome.exe`.

## Cấu Hình Trong Giao Diện

Mở `http://127.0.0.1:3000` và nhập các phần sau ở sidebar.

### Chat01 API Keys

Tải file `.txt` chứa danh sách key Chat01.

Ví dụ:

```text
sk-key-1
sk-key-2
sk-key-3
```

Key có thể cách nhau bằng xuống dòng, dấu phẩy, dấu `;`, hoặc khoảng trắng.

Quy tắc gọi Chat01:

- Mỗi request sẽ thử lần lượt toàn bộ key còn dùng được.
- Nếu một key lỗi, hết credit, invalid, lỗi mạng hoặc response lỗi, key đó bị loại khỏi phiên chạy hiện tại.
- Các request sau trong cùng một project không gọi lại key đã lỗi.
- Sang project video tiếp theo, danh sách key được reset lại từ đầu theo file key đã lưu.
- Chỉ khi thử hết toàn bộ key mà vẫn lỗi thì pipeline mới báo lỗi.

### LarVoice

Nhập:

- **LarVoice API Key**
- **Giọng đọc LarVoice**
- **Tốc độ giọng**

Tốc độ giọng chỉ có:

```text
0.9
1.0
1.1
```

Mặc định là `1.0`.

Giao diện có nút nghe thử giọng đọc. Các file nghe thử nằm trong:

```text
public/voice-samples/
```

### Ảnh Tham Chiếu

Có thể dùng ảnh tham chiếu nhân vật ở 3 cấp:

- URL ảnh tham chiếu chung trong sidebar.
- URL ảnh tham chiếu riêng trong modal sửa từng cảnh.
- Trong JSON scene, đặt `useReferenceImage` là `true` hoặc URL ảnh cụ thể.

Ví dụ:

```json
{
  "sceneNumber": 1,
  "voiceText": "Nội dung giọng đọc...",
  "imagePrompt": "A cinematic Vietnamese scene...",
  "useReferenceImage": true
}
```

## Prompt Ảnh Và Chữ Trong Ảnh

### Ảnh Từng Cảnh

Ảnh scene không còn bị cấm chữ tuyệt đối. Prompt hiện tại yêu cầu chữ ở mức vừa phải:

- Chữ phải là tiếng Việt có dấu.
- Không dùng chữ tiếng Anh.
- Nên có 1-2 cụm chữ tiếng Việt nếu chữ giúp cảnh nổi bật hoặc rõ ý hơn.
- Tổng lượng chữ khoảng 3-10 từ tiếng Việt.
- Tránh paragraph, caption, subtitle, UI text, nhiều label nhỏ, chữ lặp, chữ giả, ký tự random, watermark, logo.

Mục tiêu là ảnh vẫn tập trung vào minh họa, nhưng có lượng chữ vừa đủ khi cần gây chú ý.

### Thumbnail

Thumbnail dùng prompt riêng, khác ảnh scene:

- Bắt buộc có headline tiếng Việt lớn.
- Headline ngắn, dễ đọc trên màn hình điện thoại.
- Không dùng đoạn chữ nhỏ, watermark, logo hoặc UI screenshot.

Nếu Chat01 không tạo được thumbnail sau khi đã thử hết key, app sẽ fallback:

- Giữ thumbnail cũ nếu đã có.
- Nếu chưa có, copy ảnh scene đầu tiên thành `output/thumbnail.png`.

## Phụ Đề

App ưu tiên dùng:

```bash
python3 -m faster_whisper
```

Nếu máy chưa cài `faster_whisper`, pipeline không dừng. App sẽ tự tạo SRT từ `scene.voiceText` và duration của voice, rồi tạo file ASS karaoke để render.

Nếu muốn subtitle timing tốt hơn, cài thêm faster-whisper trong môi trường Python mà `python3` đang trỏ tới.

## Render

Render từng scene dùng HyperFrames để tạo chuyển động ảnh, sau đó ffmpeg ghép voice, phụ đề, nhạc nền và logo.

Các preset chuyển động có trong giao diện:

- Tĩnh
- Zoom in / zoom out
- Zoom xen kẽ
- Zoom + pan trái/phải
- Pan xen kẽ
- Sway
- Random

Nếu render báo không tìm thấy Chrome, đặt `CHROME_PATH`.

## Nhạc Nền Và Logo

Giao diện hỗ trợ:

- Upload một hoặc nhiều file nhạc nền.
- Tự loop/ghép nhạc theo độ dài video.
- Điều chỉnh âm lượng nhạc nền, mặc định `0.18`.
- Upload logo để chèn vào video cuối.

## Resume Và Regenerate

Pipeline có thể resume khi lỗi giữa chừng.

Khi bấm Resume:

- File ảnh đã có sẽ được skip.
- File voice đã có sẽ được skip.
- Phụ đề/video đã có sẽ được skip nếu không yêu cầu tạo lại.
- Pipeline chạy tiếp từ phần còn thiếu.

Trong modal từng cảnh có thể tạo lại riêng:

- Ảnh
- Voice
- Phụ đề
- Render scene

Ở output có thể tạo lại:

- Toàn bộ render
- Thumbnail
- SEO

## Cấu Trúc Thư Mục

```text
vibe-tool-video-main/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── voice-samples/       # MP3 nghe thử LarVoice
├── src/
│   ├── config/              # Cấu hình mặc định, style, preset
│   ├── lib/                 # File system, logger
│   ├── routes/              # Express API routes
│   └── services/
│       ├── chat01Client.js
│       ├── larvoiceClient.js
│       ├── imageService.js
│       ├── voiceService.js
│       ├── subtitleService.js
│       ├── renderService.js
│       ├── hyperframesRender.js
│       └── projectPipeline.js
├── projects/                # Dữ liệu project tự sinh
├── storage/                 # Settings và history local
├── tmp/                     # File tạm
├── server.js
└── package.json
```

## Cấu Hình File

App tự tạo:

```text
storage/settings.json
storage/history.json
projects/
tmp/
```

Nếu cần đặt đường dẫn ffmpeg thủ công, chỉnh `storage/settings.json`:

```json
{
  "ffmpegPath": "/opt/homebrew/bin/ffmpeg",
  "ffprobePath": "/opt/homebrew/bin/ffprobe"
}
```

Windows:

```json
{
  "ffmpegPath": "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "ffprobePath": "C:\\ffmpeg\\bin\\ffprobe.exe"
}
```

## Input JSON Mẫu

Có thể nhập chủ đề tự do hoặc JSON đầy đủ.

```json
{
  "title": "Bài học thay đổi cuộc đời",
  "thumbnailPrompt": "A dramatic YouTube thumbnail with large Vietnamese headline text about a life-changing lesson",
  "scenes": [
    {
      "sceneNumber": 1,
      "voiceText": "Có những khoảnh khắc nhỏ nhưng đủ sức thay đổi cả cuộc đời một con người.",
      "imagePrompt": "A cinematic Vietnamese street scene at dusk, a young person stops in front of an important sign reading \"ĐỪNG BỎ CUỘC\", emotional lighting, meaningful composition",
      "useReferenceImage": false
    },
    {
      "sceneNumber": 2,
      "voiceText": "Khi mọi thứ tưởng như bế tắc, một quyết định bình tĩnh có thể mở ra con đường mới.",
      "imagePrompt": "A thoughtful person standing before two paths, symbolic visual composition, Vietnamese words \"CHỌN LẠI\" subtly visible on a sign, dramatic cinematic mood",
      "useReferenceImage": false
    }
  ]
}
```

## Troubleshooting

### Chat01 báo hết credit

Kiểm tra file key `.txt`. App sẽ tự đổi qua key tiếp theo trong cùng danh sách. Nếu tất cả key đều lỗi, pipeline mới fail.

### Thiếu `faster_whisper`

Không bắt buộc. Pipeline sẽ tạo subtitle fallback. Nếu muốn timing chính xác hơn, cài faster-whisper cho Python đang dùng bởi `python3`.

### Không tìm thấy Chrome

Đặt `CHROME_PATH` tới Chrome executable.

### Không tìm thấy ffmpeg

Kiểm tra:

```bash
ffmpeg -version
ffprobe -version
```

Nếu không chạy được, cài ffmpeg hoặc chỉnh `storage/settings.json`.

### Muốn tạo lại ảnh với prompt mới

Ảnh đã tạo trước đó không tự thay đổi. Mở scene và bấm tạo lại ảnh.

## Chạy Nền Bằng pm2

```bash
npm install -g pm2
pm2 start server.js --name vibe-tool-video
pm2 save
```

Lệnh quản lý:

```bash
pm2 status
pm2 logs vibe-tool-video
pm2 restart vibe-tool-video
pm2 stop vibe-tool-video
```
