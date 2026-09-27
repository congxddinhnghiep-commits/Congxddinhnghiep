# Cấu hình nhập dữ liệu từ Google Drive

Chức năng “Nhập dữ liệu → Từ Google Drive” dùng **Google Picker** để người dùng tự chọn file
(.xlsx, .csv hoặc Google Sheets). Trình duyệt lấy quyền truy cập (OAuth) và gửi mã file cho máy chủ;
máy chủ tải file về (Google Sheets được xuất sang .xlsx) rồi hiển thị bảng ánh xạ cột như khi tải file từ máy tính.

## 1. Tạo dự án Google Cloud
1. Vào https://console.cloud.google.com/ → tạo dự án mới (ví dụ `dutoan-ai`).
2. **APIs & Services → Library**: bật **Google Drive API** và **Google Picker API**.
3. **OAuth consent screen**: chọn *External*, điền tên ứng dụng, email hỗ trợ.
   Thêm scope `https://www.googleapis.com/auth/drive.file`. Khi đang thử nghiệm, thêm email người dùng vào *Test users*.

## 2. Tạo thông tin xác thực
1. **Credentials → Create credentials → OAuth client ID** → loại *Web application*.
   - *Authorized JavaScript origins*: địa chỉ mở ứng dụng, ví dụ
     `http://localhost:3000`, `https://<tên>-3000.app.github.dev` (Codespaces), `https://dutoan.congty.vn`.
2. **Create credentials → API key** → giới hạn key cho *Google Picker API* và các website ở trên.
3. Ghi lại **Project number** (trang *Dashboard* của dự án) – dùng làm `GOOGLE_APP_ID`.

## 3. Khai báo trong `.env`
```
GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
GOOGLE_API_KEY=AIza...
GOOGLE_APP_ID=1234567890
```
Khởi động lại ứng dụng. Nút “Chọn file trên Google Drive” sẽ xuất hiện trong bảng Nhập dữ liệu.

> Không commit file `.env` (đã có trong `.gitignore`).

## Ghi chú
- Với `GOOGLE_APP_ID`, ứng dụng dùng scope hẹp `drive.file` (chỉ đọc được file người dùng chọn).
  Nếu bỏ trống, ứng dụng dùng `drive.readonly` (rộng hơn – nên tránh).
- Máy chủ cần truy cập được `https://www.googleapis.com`.
