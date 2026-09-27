# DUTOAN-AI – Phần mềm lập dự toán xây dựng

Phần mềm lập dự toán công trình xây dựng tại Việt Nam (chức năng lõi tương tự Dự toán F1/G8), chạy được **trên web**
(đăng nhập từ trình duyệt bất kỳ) và **trên máy tính cá nhân** (cùng một mã nguồn), kèm **trợ lý AI** nhận lệnh tiếng Việt.

> ⚠ Dữ liệu định mức/đơn giá và tỷ lệ chi phí kèm theo là **DỮ LIỆU MẪU**. Hãy nạp Định mức 12/2021, bảng giá địa phương
> và kiểm tra lại tỷ lệ theo Phụ lục TT11/2021 & TT09/2024 trước khi dùng cho hồ sơ thật.

## Tính năng (Phase 1)
- Đăng nhập, phân quyền quản trị/người dùng, bắt buộc đổi mật khẩu lần đầu.
- Danh sách công trình: tạo, sao chép, xóa, mở.
- **Dự toán chi tiết** theo hạng mục, thao tác bàn phím như F1/G8: gõ mã hiệu → Enter tự điền tên, đơn vị; Enter xuống dòng;
  F3 tra định mức (có dấu/không dấu); diễn giải khối lượng dạng công thức `2*3,5*0,3`.
- **Giá vật liệu/nhân công/máy** theo công trình, **Phân tích vật tư**, **Tổng hợp vật tư** (kèm chênh lệch giá).
- **Tổng hợp chi phí** theo TT 11/2021/TT-BXD (sửa đổi TT 09/2024/TT-BXD): T, C, LT, TT, GTk, GT, TL, G, GTGT (8%/10%), Gxd;
  Tổng dự toán (thiết bị, QLDA, tư vấn, chi phí khác, dự phòng). Hiển thị cách tính và nguồn hệ số từng dòng, đọc số thành chữ.
- **Xuất Excel** một file gồm các sheet TH, DTCT, PTVT, THVT, CLVT, TDT – dùng **công thức Excel thật**, khổ A4, Times New Roman, #,##0.
- **Nhập dữ liệu** từ máy tính (.xlsx/.csv, hoặc đường dẫn tuyệt đối khi chạy cục bộ) và từ **Google Drive**, có hộp thoại ánh xạ cột:
  nạp định mức, bảng giá, danh sách công tác.
- **Trợ lý AI** (không cần mạng): hiểu lệnh như
  - `thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân`
  - `tìm mã định mức đào đất móng`
  - `đổi giá xi măng PCB40 thành 1.650.000 đ/tấn`
  - `sửa khối lượng dòng 3 thành 2*3,5*0,3`, `tạo hạng mục phần mái`, `tính lại`, `xuất excel`, `hoàn tác`

  Khi thiếu thông tin hoặc có nhiều lựa chọn, trợ lý **hỏi lại bằng các nút bấm**; mọi thay đổi đều **xem trước** và chỉ thực hiện khi
  bấm **Xác nhận**; có **Hoàn tác**. Nếu đặt `ANTHROPIC_API_KEY`, trợ lý dùng Claude để hiểu câu lệnh tự do hơn.

## Cấu trúc thư mục
```
packages/core    Hàm tính toán thuần (đơn giá, tổng hợp chi phí, công thức, bộ hiểu lệnh tiếng Việt) + unit test
packages/server  Express + SQLite (better-sqlite3), JWT, xuất/nhập Excel, API trợ lý
packages/web     Giao diện React + Vite
data/            rates-default.json (tỷ lệ mặc định MẪU), dutoan.db (tạo khi chạy)
docs/            SPEC.md, DECISIONS.md, google-drive-setup.md
desktop/         Khung Electron (Phase 2)
```

## Lệnh thường dùng
| Lệnh | Tác dụng |
|---|---|
| `npm install` | Cài thư viện |
| `npm run build` | Build core, server, web |
| `npm start` | Chạy bản build tại http://localhost:3000 |
| `npm run dev` | Chế độ phát triển: API cổng 3000 + giao diện Vite cổng 5173 (tự tải lại) |
| `npm test` | Chạy unit test (vitest) |

Đăng nhập lần đầu: **admin / admin123** (chỉ ở môi trường phát triển) → hệ thống yêu cầu đổi mật khẩu ngay.
Có thể đặt tài khoản khác bằng biến môi trường `ADMIN_USER`, `ADMIN_PASS` (xem `.env.example`) trước lần chạy đầu tiên.

## 1. Chạy trên GitHub Codespaces
1. Trên GitHub, bấm **Code → Codespaces → Create codespace on main**.
2. Codespace tự chạy `npm install && npm run build` (cấu hình trong `.devcontainer/devcontainer.json`).
3. Mở Terminal, chạy `npm start`. Cổng 3000 được chuyển tiếp – bấm **Open in Browser**.
4. Khi phát triển giao diện dùng `npm run dev` và mở cổng 5173.

## 2. Chạy trên máy tính Windows
1. Cài **Node.js 20 LTS hoặc 22 LTS** từ https://nodejs.org (chọn bản Windows Installer .msi, giữ tùy chọn mặc định).
2. Tải mã nguồn: `git clone https://github.com/congxddinhnghiep-commits/Congxddinhnghiep.git`
   (hoặc **Code → Download ZIP** rồi giải nén).
3. Mở **Command Prompt** / **PowerShell** trong thư mục vừa tải, chạy:
   ```
   npm install
   npm run build
   npm start
   ```
4. Mở trình duyệt tại **http://localhost:3000**.
5. Dữ liệu lưu trong `data\dutoan.db` – sao lưu file này để giữ dữ liệu. Khi chạy trên máy cá nhân có thể nhập file bằng đường dẫn
   tuyệt đối, ví dụ `C:\DuLieu\DinhMuc.xlsx`.

> Nếu `npm install` báo lỗi biên dịch `better-sqlite3`, hãy dùng Node.js bản LTS (20/22) – các bản này có sẵn file dựng sẵn.

## 3. Triển khai lên web
Ứng dụng là một tiến trình Node.js duy nhất (API + giao diện) và một file SQLite, nên cần máy chủ có **ổ đĩa lưu trữ bền vững**.

**Máy chủ VPS (Ubuntu) – khuyến nghị**
```bash
# Cài Node.js 22 LTS, git; sau đó:
git clone https://github.com/congxddinhnghiep-commits/Congxddinhnghiep.git dutoan && cd dutoan
npm ci && npm run build
cp .env.example .env   # sửa: NODE_ENV=production, JWT_SECRET=<chuỗi ngẫu nhiên dài>, ADMIN_PASS=<mật khẩu mạnh>, LOCAL_MODE=false
sudo npm i -g pm2
pm2 start npm --name dutoan -- start && pm2 save && pm2 startup
```
Đặt **Nginx** (hoặc Caddy) làm reverse proxy tới `http://127.0.0.1:3000` và bật **HTTPS** (Let's Encrypt).
Sao lưu định kỳ thư mục `data/`.

**Nền tảng PaaS** (Render, Railway, Fly.io…): lệnh build `npm ci && npm run build`, lệnh chạy `npm start`,
gắn ổ đĩa bền vững và đặt `DATA_DIR`/`DB_PATH` trỏ vào ổ đó (nhớ sao chép `data/rates-default.json` vào `DATA_DIR`).

Biến môi trường quan trọng khi lên web: `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`, `LOCAL_MODE=false`.

## Nhập dữ liệu chính thức
- **Định mức** (chỉ quản trị viên): bảng mỗi dòng một thành phần hao phí với các cột *Mã hiệu ĐM, Tên công tác, Đơn vị,
  Mã tài nguyên, Tên tài nguyên, Đơn vị, Loại (VL/NC/M), Hao phí, Đơn giá*. Mã định mức có thể chỉ ghi ở dòng đầu mỗi nhóm.
- **Bảng giá**: cột *Mã tài nguyên* và *Giá* (áp cho công trình hoặc cập nhật giá gốc thư viện).
- **Công tác**: cột *Mã hiệu, Khối lượng* (tùy chọn *Tên, Đơn vị, Diễn giải, Hạng mục*).

Hộp thoại nhập tự đoán cột theo tiêu đề; có thể chỉnh lại trước khi bấm **Nhập dữ liệu**.
Google Drive cần cấu hình theo [docs/google-drive-setup.md](docs/google-drive-setup.md).

## Trợ lý dùng Claude (tùy chọn)
Đặt `ANTHROPIC_API_KEY` (và tùy chọn `ANTHROPIC_MODEL`) trong `.env`. Claude chỉ diễn giải câu lệnh thành thao tác;
việc hỏi lại, xem trước và xác nhận vẫn giữ nguyên. Không có khóa, trợ lý chạy chế độ ngoại tuyến (rule-based).

## Ghi chú kỹ thuật
Các quyết định thiết kế và giới hạn của Phase 1 được ghi trong [docs/DECISIONS.md](docs/DECISIONS.md).
