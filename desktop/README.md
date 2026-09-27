# Bản cài đặt máy tính (Electron) – chuẩn bị cho Phase 2

Thư mục này chỉ chứa khung khởi động Electron. Phase 1 chưa đóng gói installer.

Hướng dự kiến:
1. `npm i -D electron electron-builder` trong thư mục `desktop/`.
2. `main.cjs` khởi động chính server Express (`packages/server/dist`) với `LOCAL_MODE=true`
   rồi mở cửa sổ tới `http://localhost:3000`.
3. Cần sao chép thư mục `data/legal/` vào thư mục dữ liệu người dùng (`DATA_DIR`) khi cài đặt,
   và rebuild `better-sqlite3` cho phiên bản Node của Electron (`electron-builder install-app-deps`).
