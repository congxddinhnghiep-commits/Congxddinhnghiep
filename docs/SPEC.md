# DUTOAN-AI — Construction Cost Estimating Software (Phase 1 / MVP spec)

Goal: a Vietnamese construction cost-estimating app with core functions similar to F1 / G8 (Dự toán F1, Dự toán G8), plus:
1. Runs BOTH as a web app (login from any browser) AND locally on a personal computer (same codebase, `npm start` → http://localhost:3000; later wrap with Electron).
2. An "AI assistant" panel that performs operations on behalf of the user: the user types a request in Vietnamese, the assistant asks clarifying questions when info is missing, then executes actions (add items, set quantities, apply prices, recalc, export).
3. Import data from files on the user's computer (upload, or a local file path when running locally) and from Google Drive.

All UI text MUST be Vietnamese (with proper diacritics). Code/comments in English.

## Tech stack (keep it simple, one language)
- Monorepo, Node.js 20+, TypeScript everywhere.
- Backend: Express + better-sqlite3 (single file DB `data/dutoan.db`), JWT auth (bcrypt password hashes).
- Frontend: React + Vite + a spreadsheet-like grid (e.g. AG Grid Community or a lightweight custom grid). Keyboard-friendly like F1/G8 (Enter moves down, type a norm code in the "Mã hiệu" column to auto-fill).
- Excel export: exceljs. Excel/CSV import: exceljs / papaparse.
- Scripts: `npm run dev` (both), `npm run build`, `npm start` (serves built frontend from Express on port 3000), `npm test` (vitest).
- Include `.devcontainer/devcontainer.json` so Codespaces installs deps and forwards port 3000.

## Data model
- users(id, username, password_hash, full_name, role)
- projects(id, owner_id, name, owner_name/chủ đầu tư, location, building_type [dân dụng | công nghiệp | giao thông | NN&PTNT | hạ tầng kỹ thuật], price_base_date, vat_rate, created_at)
- categories / hạng mục (id, project_id, name, order)
- estimate_items (id, category_id, order, norm_code, name, unit, quantity, quantity_formula/diễn giải khối lượng e.g. "2*3.5*0.3", note)
- norms / định mức (code, name, unit, group) + norm_resources (norm_code, resource_code, consumption)
- resources / tài nguyên (code, name, unit, type [VL | NC | M], base_price)
- project_prices (project_id, resource_code, price)  → giá vật liệu/nhân công/máy tại thời điểm lập (overrides base price)
- cost_settings per project (rates below, editable)

## Calculation engine (pure functions in `packages/core`, fully unit-tested)
Per item: VL = Σ(consumption × price) for type VL; same for NC, M. Unit price (đơn giá) = VL + NC + M; amount = quantity × unit price. Support resource-analysis (phân tích vật tư) and resource summary (tổng hợp vật tư).

Cost summary per Thông tư 11/2021/TT-BXD (as amended by TT 09/2024/TT-BXD), "Bảng tổng hợp chi phí xây dựng":
- T = VL + NC + M (chi phí trực tiếp)
- GT = C + LT + TT + GTk  (chi phí gián tiếp: chi phí chung, lán trại, một số công việc không xác định KL từ thiết kế, chi phí gián tiếp khác) — each = T × rate (C may be on T or NC per building type; make the base configurable)
- TL = (T + GT) × rate  (thu nhập chịu thuế tính trước)
- G = T + GT + TL  (dự toán trước thuế)
- GTGT = G × vat_rate (default 8%, configurable 8/10%)
- Gxd = G + GTGT
- Tổng dự toán (optional sheet): Gxd + thiết bị + QLDA + tư vấn + chi phí khác + dự phòng (KL phát sinh %, trượt giá %).
Default rates: put them in `data/rates-default.json` by building type and cost bracket, CLEARLY marked "GIÁ TRỊ MẪU – cần kiểm tra lại theo Phụ lục TT11/2021 & TT09/2024". User can edit per project. Show rate source/formula next to each line.

## Sample data (seed)
- Seed ~40 common norm codes (bê tông lót, bê tông móng/cột/dầm/sàn, cốt thép, ván khuôn, xây gạch, trát, đào đất, đắp đất, sơn, lát nền, ép cọc...) with resources and sample prices. Mark every seeded record `is_sample=1` and show a banner "Dữ liệu định mức/đơn giá MẪU – thay bằng dữ liệu chính thức".
- Provide an importer for official norm/price data from Excel (column mapping dialog), so real định mức 12/2021 and provincial price books can be loaded later.
- Seed admin user from env `ADMIN_USER` / `ADMIN_PASS` (default admin/admin123 only in dev, force change on first login).

## Screens
1. Đăng nhập.
2. Danh sách công trình (tạo, sao chép, xóa, mở).
3. Công trình: tabs — "Dự toán chi tiết" (grid by hạng mục), "Giá vật liệu/NC/Máy", "Phân tích vật tư", "Tổng hợp vật tư", "Tổng hợp chi phí", "Cài đặt hệ số".
4. Norm search dialog (tìm theo mã hoặc tên, có dấu/không dấu).
5. AI assistant side panel (see below).
6. Import panel: "Từ máy tính" (upload .xlsx/.csv; when running locally also accept an absolute path) and "Từ Google Drive".

## Excel export (one workbook, Vietnamese template style)
Sheets: TH (Tổng hợp chi phí), DTCT (Dự toán chi tiết), PTVT (Phân tích vật tư), THVT (Tổng hợp vật tư), CLVT (Chênh lệch giá vật tư). Use real Excel formulas (not hard-coded numbers) so the file stays editable, A4 print setup, Times New Roman, number format #,##0.

## AI assistant (Phase 1: no LLM required)
- Architecture: `AssistantEngine` with an `IntentProvider` interface.
  - `RuleBasedProvider` (default, works offline): parses Vietnamese commands (with or without diacritics), e.g.
    - "thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân"
    - "tìm mã định mức đào đất móng"
    - "đổi giá xi măng PCB40 thành 1.650.000 đ/tấn"
    - "tính lại" / "xuất excel"
  - `ClaudeProvider` stub: enabled only if `ANTHROPIC_API_KEY` is set; uses tool-calling with the same action functions. Not required now.
- Actions exposed as typed tools: searchNorm, addItem, updateQuantity, setPrice, createCategory, recalc, exportExcel, importFile.
- If a required parameter is missing or ambiguous (e.g. several matching norm codes, unknown category), the assistant asks a question with clickable options instead of guessing.
- Every action is shown as a preview ("Tôi sẽ thêm: AF.xxxxx … 50 m3 vào Phần thân — Xác nhận?") and applied only after the user confirms. Keep an undo history.

## Google Drive import
- Module behind config: requires GOOGLE_CLIENT_ID / GOOGLE_API_KEY in `.env`; uses Google Picker to choose a .xlsx/.csv/Google Sheet and imports it. If not configured, the button shows setup instructions (docs/google-drive-setup.md). Do not commit secrets.

## Quality
- Unit tests for the calculation engine (hand-checked example with numbers) and for the rule-based parser (at least 15 Vietnamese sentences).
- README.md in Vietnamese: how to run in Codespaces, locally on Windows, and how to deploy to the web.
- Commit in small logical steps with clear messages; push to origin main when done.

## Out of scope for Phase 1
Thanh quyết toán, dự thầu nâng cao, đồng bộ nhiều người dùng thời gian thực, Electron installer (just prepare structure).
