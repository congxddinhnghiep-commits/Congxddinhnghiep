# Kiểm thử trình duyệt (headless) – Update 3

Chạy trên **CSDL tạm** (không đụng dữ liệu thật):

```bash
npm install && npx playwright install chromium
npm run build
DB_PATH=/tmp/e2e.db npm run import:tt38 && DB_PATH=/tmp/e2e.db node e2e/seed-e2e.mjs   # TT38 thật + 2 bộ giá HCM có dòng giá
DB_PATH=/tmp/e2e.db PORT=3101 node packages/server/dist/index.js &                      # máy chủ thử
npm run e2e                                                                             # BASE_URL=http://localhost:3101, ảnh chụp trong /tmp/e2e-shots
```
Kịch bản: đăng nhập → tạo công trình → tải `test_import.xlsx` → kiểm ánh xạ tự nhận → đổi ánh xạ thủ công (bỏ rồi chọn lại cột G = Đơn giá nhân công)
→ loại dòng, tùy chọn đơn giá, bảng đối chiếu (1.187.500 / 4.384.000 / 15.555.000 / 21.126.500) → chọn mã đề xuất → nhập → lưới khớp file →
nút “Cập nhật định mức & đơn giá theo khu vực” với TP. Hồ Chí Minh → xem trước → áp dụng → hoàn tác.

## Update 5 — Bóc khối lượng theo cấu kiện

```bash
npm run build
DB_PATH=/tmp/e2e5.db PORT=3101 node packages/server/dist/index.js &   # máy chủ thử (dữ liệu MẪU là đủ, không cần import:tt38)
npm run e2e:update5                                                   # BASE_URL=http://localhost:3101
```
Kịch bản: đăng nhập (đổi mật khẩu lần đầu) → tạo công trình → tab “Bóc khối lượng” → thêm 1 tầng → tạo cấu kiện Móng đơn “M1”
(a=1,8; b=1,2; h=0,5; H_d=1,5; count=10) → kiểm 5 công tác sinh ra đúng số (10,8 / 2,8 / 30 / 78 / 64,4) → “Xem trước đẩy sang dự
toán” → “Đẩy sang dự toán” → sang tab “Dự toán chi tiết” thấy đúng các công việc và khối lượng vừa đẩy → quay lại bấm “↶ Hoàn tác
lần đẩy gần nhất” → các dòng vừa thêm biến mất khỏi dự toán.
