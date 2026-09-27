# DUTOAN-AI – Phần mềm lập dự toán xây dựng

Phần mềm lập dự toán công trình xây dựng tại Việt Nam (chức năng lõi tương tự Dự toán F1/G8), chạy được **trên web**
(đăng nhập từ trình duyệt bất kỳ) và **trên máy tính cá nhân** (cùng một mã nguồn), kèm **trợ lý AI** nhận lệnh tiếng Việt.

> ⚠ Định mức và giá tài nguyên kèm theo là **DỮ LIỆU MẪU** (không lấy từ TT 38/2026 hay công bố giá nào). Hãy nạp định mức chính thức
> (phụ lục TT 38/2026 thay thế theo CV 9947/BXD-VPB) và công bố giá địa phương qua chức năng Nhập dữ liệu / Bộ đơn giá.
> Bảng tỷ lệ TT 36/2026 (Bảng 3.3–3.7) đã được đối chiếu và đánh dấu **đã xác minh**; quản trị viên có thể chuyển về TẠM tại **Căn cứ pháp lý**.

## Căn cứ pháp lý (cập nhật 27/09/2026)
Mỗi công trình lưu một **bộ căn cứ pháp lý** và không bao giờ bị tự động đổi:

| Bộ pháp lý | Áp dụng | Phương pháp | Định mức |
|---|---|---|---|
| **TT 36/2026 + TT 38/2026** (hiện hành) | Ngày lập giá từ 01/07/2026 (mặc định) | Bảng 3.8 TT 36/2026 (đính chính QĐ 1538/QĐ-BXD) | Bộ `TT38_2026`, nhân công theo **nhóm** |
| **TT 11/2021 + TT 12/2021** (lịch sử) | Ngày lập giá trước 01/07/2026 | Phương pháp Phase 1 | Bộ `TT12_2021`, nhân công theo cấp bậc |

Bảng 3.3 và 3.7 tra khoảng theo **chi phí xây dựng trước thuế của công trình trong TMĐT được duyệt** (nhập ở tab Cài đặt hệ số, đơn vị
tỷ đồng); để trống thì phần mềm dùng giá trị dự toán và cảnh báo. Không nội suy giữa các khoảng.
Bảng tổng hợp chi phí theo TT 36/2026: T (VL + NC×Knc + M×Km) → C (Bảng 3.3, hoặc Bảng 3.4 theo NC) → TT (Bảng 3.5) →
GT = C + TT → TL (Bảng 3.6) → GXDTT → GTGT → GXD, và dòng riêng **V. Nhà tạm** = GXDTT × Bảng 3.7 × (1 + TGTGT).
Tổng dự toán có hai khoản dự phòng theo Phụ lục II TT 36/2026: GDP1 = G_TDP × kps (kps ≤ 5%) và
GDP2 = Σ G_TDP,t × [(I_bq + ΔI)^t − 1] với lịch phân bổ giá trị theo năm/quý.
Khi nâng cấp từ bản cũ, các công trình đã có được giữ ở bộ lịch sử nên số liệu không đổi.
Chi tiết: [docs/LEGAL-UPDATE-2026.md](docs/LEGAL-UPDATE-2026.md), [docs/UPDATE-2.md](docs/UPDATE-2.md), [docs/DECISIONS.md](docs/DECISIONS.md) mục 27–56.

## Tính năng (Phase 1)
- Đăng nhập, phân quyền quản trị/người dùng, bắt buộc đổi mật khẩu lần đầu.
- Danh sách công trình: tạo, sao chép, xóa, mở.
- **Dự toán chi tiết** theo hạng mục, thao tác bàn phím như F1/G8: gõ mã hiệu → Enter tự điền tên, đơn vị; Enter xuống dòng;
  F3 tra định mức (có dấu/không dấu); diễn giải khối lượng dạng công thức `2*3,5*0,3`.
- **Giá vật liệu/nhân công/máy** theo công trình, **Phân tích vật tư**, **Tổng hợp vật tư** (kèm chênh lệch giá).
- **Tổng hợp chi phí** theo bộ pháp lý của công trình (TT 36/2026 Bảng 3.8, hoặc bộ lịch sử TT 11/2021); Knc/Km khi làm đêm;
  Tổng dự toán (thiết bị, QLDA, tư vấn, chi phí khác, 2 khoản dự phòng). Mỗi dòng hiển thị cách tính và **nguồn** (văn bản, số bảng,
  khoảng tra, trạng thái xác minh), đọc số thành chữ.
- **Căn cứ pháp lý**: sổ văn bản (số hiệu, ngày ban hành/hiệu lực, tình trạng, nguồn chính thức), các bộ pháp lý và bảng tỷ lệ;
  quản trị viên đánh dấu từng bảng “đã xác minh” và bật/tắt nội suy.
- **Xuất Excel** một file gồm các sheet TH, DTCT, PTVT, THVT, CLVT, TDT – dùng **công thức Excel thật**, khổ A4, Times New Roman, #,##0.
  Sheet TH ghi rõ căn cứ pháp lý, nguồn từng dòng và cảnh báo khi bảng tỷ lệ còn TẠM.
- **Nhập dữ liệu** từ máy tính (.xlsx/.csv, hoặc đường dẫn tuyệt đối khi chạy cục bộ) và từ **Google Drive**, có hộp thoại ánh xạ cột:
  nạp định mức, bảng giá, danh sách công tác.
- **Trợ lý AI** (không cần mạng): hiểu lệnh như
  - `thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân`
  - `tìm mã định mức đào đất móng`
  - `đổi giá xi măng PCB40 thành 1.650.000 đ/tấn`
  - `sửa khối lượng dòng 3 thành 2*3,5*0,3`, `tạo hạng mục phần mái`, `tính lại`, `xuất excel`, `hoàn tác`

  Khi thiếu thông tin hoặc có nhiều lựa chọn, trợ lý **hỏi lại bằng các nút bấm**; mọi thay đổi đều **xem trước** và chỉ thực hiện khi
  bấm **Xác nhận**; có **Hoàn tác**. Nếu đặt `ANTHROPIC_API_KEY`, trợ lý dùng Claude để hiểu câu lệnh tự do hơn.

## Hướng dẫn nhanh các tính năng mới

### 1. Nhập file dự toán / BOQ có sẵn (mọi mẫu Excel)
1. Mở công trình → **⤓ Nhập dữ liệu** → loại dữ liệu “Dự toán / BOQ có sẵn” → chọn file `.xlsx`, `.xlsm`, `.xls` hoặc `.csv`
   (hoặc chọn từ Google Drive).
2. Phần mềm liệt kê các sheet kèm loại tự nhận diện (Dự toán chi tiết, Tổng hợp chi phí, Phân tích vật tư…) và chọn sẵn sheet dự toán.
3. Kiểm tra **ánh xạ cột** (STT, Mã hiệu, Tên công việc, Đơn vị, Khối lượng, Đơn giá VL/NC/M…), dòng tiêu đề (1 hoặc 2 dòng) và bảng dòng:
   mỗi dòng có nhãn *Hạng mục / Công việc / Cộng-Tổng (bỏ qua) / Ghi chú*, có thể đổi loại hoặc **Bỏ qua** từng dòng; cột cảnh báo nêu thiếu
   đơn vị, khối lượng bằng 0, dòng trùng, đơn vị lạ, mã không có trong bộ định mức; cột gợi ý mã cho dòng chưa có mã.
4. Tùy chọn: đặt tên **mẫu nhập** để lần sau file cùng mẫu tự nhận ánh xạ; bật **gắn mã tự động** với ngưỡng tin cậy.
5. Bấm **Nhập**. Mỗi công việc giữ nguyên mô tả, khối lượng, đơn vị, mã và vị trí gốc (file / sheet / dòng) – rê chuột vào tên công việc để xem.
   Nhập nhầm thì bấm **↶ Hoàn tác** ở khung trợ lý.

### 2. Tra định mức và gắn mã tự động
- Ô tra định mức (F3) nhận mã (`AF.1`, `AF11`), chữ có/không dấu và viết tắt: `BT`, `BTCT`, `VK`, `CT` (cốt thép), `M250`/`B20`, `PCB40`,
  `đk ≤10mm`, `Ø16`, `dày 220`, `đất C2`…
- Trên lưới dự toán, cột **Gợi ý / trạng thái mã** hiện mã đề xuất và độ tin cậy cho công việc chưa có mã: bấm để chấp nhận, hoặc ▾ để xem 5 gợi
  ý kèm lý do (“vì sao”). Đơn vị phải tương thích (m3 ↔ 100m3, kg ↔ tấn được quy đổi tự động, khối lượng gốc vẫn được giữ).
- **⚙ Gắn mã tự động**: chọn ngưỡng (mặc định 80%), xem trước danh sách rồi áp dụng. Công việc dưới ngưỡng giữ trạng thái “cần xem lại”.
  Mã gắn tự động có nhãn “tự động · xác nhận” – phải xác nhận (từng dòng hoặc cả loạt) trước khi bấm **Duyệt dự toán**.
- Trợ lý: gõ “gắn mã cho các công việc chưa có mã” (có thể thêm “ngưỡng 70%”).

### 3. Bộ đơn giá theo khu vực và thời điểm
- Menu **Bộ đơn giá**: quản trị viên thêm bộ (tỉnh/thành, khu vực, cơ quan công bố, số và ngày văn bản, kỳ tháng/quý/năm, loại VL/NC/Máy,
  giá đã/chưa gồm VAT, điều kiện giao hàng, nguồn), rồi **nhập file công bố giá** (mọi mẫu Excel). Dòng khớp tài nguyên theo mã hoặc tên/quy cách;
  dòng chưa khớp vào danh sách **cần xem lại** để gán tay hoặc bỏ qua. Kiểm tra xong bấm **Đánh dấu đã xác minh**.
- Có sẵn một bộ **chỉ có thông tin văn bản** của Sở Xây dựng TP.HCM (công bố giá VLXD tháng 02/2026, 7563/TB-SXD-KTVLXD) – chưa có giá,
  cần tải file chính thức tại soxaydung.hochiminhcity.gov.vn và nhập vào.
- Trong công trình → tab **Giá vật liệu/NC/Máy**: chọn tỉnh/thành (và khu vực) → phần mềm đề xuất các bộ cùng tỉnh có kỳ giá ≤ ngày lập giá →
  thêm bộ cho từng loại tài nguyên, sắp **ưu tiên** → **Xem chênh lệch giá** → **Áp dụng**. Thứ tự áp giá: giá nhập tay → bộ đơn giá theo ưu tiên →
  giá gốc (MẪU). Cột **Nguồn giá** cho biết giá lấy từ đâu (cả trong sheet THVT của file Excel); bấm tên tài nguyên để xem lịch sử giá theo kỳ.

## Cấu trúc thư mục
```
packages/core    Hàm tính toán thuần (đơn giá, tổng hợp chi phí, công thức, bộ hiểu lệnh tiếng Việt) + unit test
packages/server  Express + SQLite (better-sqlite3), JWT, xuất/nhập Excel, API trợ lý
packages/web     Giao diện React + Vite
data/legal/      Sổ văn bản pháp lý và bảng tỷ lệ theo bộ pháp lý (tt36-2026.json, tt11-2021.json)
data/regions.json  34 tỉnh/thành (sau sắp xếp 2025) cho danh sách chọn khu vực
scripts/         make-fixtures.mjs – tạo các file Excel mẫu dùng cho test
data/            dutoan.db (tạo khi chạy)
docs/            SPEC.md, DECISIONS.md, LEGAL-UPDATE-2026.md, google-drive-setup.md
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
gắn ổ đĩa bền vững và đặt `DATA_DIR`/`DB_PATH` trỏ vào ổ đó (nhớ sao chép thư mục `data/legal/` vào `DATA_DIR`).

Biến môi trường quan trọng khi lên web: `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`, `LOCAL_MODE=false`.

## Nhập dữ liệu chính thức
- **Định mức** (chỉ quản trị viên, chọn bộ đích `TT38_2026` hoặc `TT12_2021`): bảng mỗi dòng một thành phần hao phí với các cột *Mã hiệu ĐM, Tên công tác, Đơn vị,
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
