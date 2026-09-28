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
