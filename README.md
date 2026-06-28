# CryptoPulse AI - Real-time Crypto News & Sentiment Analyzer

CryptoPulse AI là một hệ thống tự động tổng hợp tin tức và giá Bitcoin (BTC) theo thời gian thực, sau đó sử dụng trí tuệ nhân tạo (Llama-3.3-70b qua Groq API) để phân tích tâm lý thị trường (sentiment) và đưa ra nhận định chuyên sâu bằng tiếng Việt.

## 🚀 Tính năng chính

- **Dữ liệu Giá thời gian thực**: Cập nhật giá BTC/USDT trực tiếp từ API Binance mỗi 10 giây.
- **Tổng hợp Tin tức Tự động**: Quét và hợp nhất các bài báo mới nhất từ các trang tin uy tín: Cointelegraph, CoinDesk và Decrypt qua RSS feeds.
- **Bộ não Phân tích AI (Groq)**: Sử dụng mô hình `llama-3.3-70b-versatile` để tổng hợp, phân tích xu hướng, xếp hạng điểm số tâm lý từ -100 (Cực kỳ tiêu cực) đến +100 (Cực kỳ tích cực).
- **Giao diện Modern Glassmorphism**: Dashboard cao cấp với chế độ tối sâu (dark mode), biểu đồ đo tâm lý dạng đồng hồ (gauge chart), cùng hiệu ứng chuyển động mượt mà và hiển thị di động tối ưu.
- **Hệ thống Cache & Chống spam**: Lưu trữ đệm kết quả phân tích trong 15 phút để tránh quá tải API Rate Limit, tích hợp cooldown làm mới thủ công (3 phút).

## 🛠 Cấu trúc dự án

```text
crypto-news-ai-server/
├── public/                # Thư mục chứa giao diện Frontend (SPA)
│   ├── index.html         # Bố cục giao diện dashboard
│   ├── style.css          # Định dạng giao diện (Glassmorphism & Cyberpunk CSS)
│   └── script.js          # Logic cập nhật giá live, vẽ gauge và gọi API
├── .env                   # Tệp cấu hình môi trường phát triển (chứa API Key)
├── package.json           # Danh sách thư viện và tập lệnh khởi chạy
├── server.js              # Mã nguồn máy chủ Node.js / Express
└── README.md              # Tài liệu hướng dẫn sử dụng và triển khai
```

## 💻 Hướng dẫn chạy cục bộ (Local)

### 1. Cài đặt Node.js
Đảm bảo bạn đã cài đặt Node.js (khuyên dùng phiên bản >= 18).

### 2. Cài đặt các thư viện
Mở terminal tại thư mục dự án và chạy lệnh:
```bash
npm install
```

### 3. Cấu hình biến môi trường
Tệp `.env` đã được cấu hình tự động. Nội dung tệp `.env` mẫu:
```env
PORT=3000
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

### 4. Khởi chạy máy chủ
Chạy lệnh sau để bật server ở chế độ phát triển (tự động cập nhật code):
```bash
npm run dev
```
Hoặc khởi chạy thông thường:
```bash
npm start
```

Mở trình duyệt truy cập: **[http://localhost:3000](http://localhost:3000)** để xem Dashboard.

---

## 🌐 Hướng dẫn triển khai lên Render (Render Deployment)

Render là nền tảng điện toán đám mây tuyệt vời, cho phép triển khai ứng dụng Node.js miễn phí và nhanh chóng.

### Bước 1: Đưa mã nguồn lên GitHub
1. Tạo một kho chứa (repository) mới trên tài khoản GitHub của bạn (ở chế độ Private hoặc Public).
2. Khởi tạo Git và đẩy mã nguồn dự án lên GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of CryptoPulse AI"
   git branch -M main
   git remote add origin <URL_KHO_CHỨA_GITHUB_CỦA_BẠN>
   git push -u origin main
   ```

### Bước 2: Tạo Web Service mới trên Render
1. Truy cập vào dashboard của **[Render](https://dashboard.render.com)** (đăng nhập bằng tài khoản GitHub).
2. Nhấn nút **New +** và chọn **Web Service**.
3. Kết nối với kho chứa GitHub chứa dự án `crypto-news-ai-server` của bạn.

### Bước 3: Cấu hình Web Service
Cấu hình các thông số sau trên Render:
- **Name**: `crypto-pulse-ai` (hoặc tên bất kỳ bạn thích)
- **Region**: Chọn khu vực gần bạn nhất (ví dụ: `Singapore` hoặc `Oregon`)
- **Branch**: `main`
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: `Free`

### Bước 4: Thiết lập biến môi trường (Environment Variables)
1. Chuyển sang tab **Environment** trong giao diện cấu hình dịch vụ trên Render.
2. Thêm các khóa biến sau:
   - `GROQ_API_KEY`: `your_groq_api_key_here`
   - `GROQ_MODEL`: `llama-3.3-70b-versatile`
   - `PORT`: `3000` (Render tự động phát hiện cổng, nhưng thêm vào để đảm bảo tính đồng bộ)
3. Nhấn **Save Changes**.

Render sẽ tự động tiến hành quá trình tải code, cài đặt thư viện (`build`) và khởi động server (`deploy`). Sau khi hoàn tất, Render sẽ cấp cho bạn một đường dẫn URL công khai có dạng: `https://crypto-pulse-ai.onrender.com`.

---

## 🔌 Tài liệu API Endpoints

### 1. Lấy thông tin thị trường và báo cáo AI
- **Endpoint**: `GET /api/market-status`
- **Phản hồi**: Trả về dữ liệu giá BTC, danh sách bài báo mới nhất, báo cáo AI được lưu trong bộ nhớ đệm và thời gian cooldown làm mới còn lại.

### 2. Yêu cầu AI phân tích lại ngay lập tức
- **Endpoint**: `POST /api/analyze`
- **Phản hồi**: Buộc máy chủ gọi Groq API để chạy phân tích mới (bỏ qua cache) và phản hồi dữ liệu cập nhật.
- **Ràng buộc**: Bị giới hạn cooldown 3 phút mỗi lượt gọi (Trả về mã lỗi `429 Too Many Requests` nếu cố tình gọi liên tục).
