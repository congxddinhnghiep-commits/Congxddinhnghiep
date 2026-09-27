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
- projects(id, owner_id, name, owner_name/chủ đầu tư, location, building_type [dân dụng | công nghiệp | giao thông | NN&PTNT | hạ tầng kỹ thuật], price_base_date, price_date (ISO), legal_set [TT36_2026 | TT11_2021], vat_rate, created_at)
- categories / hạng mục (id, project_id, name, order)
- estimate_items (id, category_id, order, norm_code, name, unit, quantity, quantity_formula/diễn giải khối lượng e.g. "2*3.5*0.3", note)
- norms / định mức (code, name, unit, group) + norm_resources (norm_code, resource_code, consumption)
- resources / tài nguyên (code, name, unit, type [VL | NC | M], base_price)
- project_prices (project_id, resource_code, price)  → giá vật liệu/nhân công/máy tại thời điểm lập (overrides base price)
- cost_settings per project (rates below, editable)
- norms / norm_resources are versioned by `dataset` (TT38_2026 current, TT12_2021 historical); a project uses the dataset of its legal set
- rate_table_status (legal_set, table_id, status provisional|verified, interpolation, verified_by, verified_at)

## Calculation engine (pure functions in `packages/core`, fully unit-tested)
Per item: VL = Σ(consumption × price) for type VL; same for NC, M. Unit price (đơn giá) = VL + NC + M; amount = quantity × unit price. Support resource-analysis (phân tích vật tư) and resource summary (tổng hợp vật tư).

### Legal sets (updated 2026-09-27 — see docs/LEGAL-UPDATE-2026.md)
Each project stores a **legal set**; it is never changed automatically (switching requires explicit confirmation and recalculates).
- **TT 36/2026 + TT 38/2026** (current) — default when the price date is on/after 2026-07-01 (or empty).
- **TT 11/2021 + TT 12/2021** (historical) — for price dates before 2026-07-01. Databases from Phase 1 are migrated with all existing projects pinned to this set so their results do not change silently.

Cost summary per **TT 36/2026/TT-BXD, Phụ lục III, Bảng 3.8** (as corrected by QĐ 1538/QĐ-BXD):
- VL = Σ Qj × Dj_vl; NC = Σ Qj × Dj_nc × Knc; M = Σ Qj × Dj_m × Km
  (Knc = 1 + tỷ lệ làm đêm × tỷ lệ chênh lệch đơn giá đêm; Km = 1 + g × (Knc − 1), g = tỷ trọng tiền lương trong giá ca máy)
- T = VL + NC + M
- C = T × rate (Bảng 3.3, bracket by T) — or NC × rate (Bảng 3.4, bracket by NC) for the listed work types
- TT = T × rate (Bảng 3.5)
- GT = C + TT
- TL = (T + GT) × rate (Bảng 3.6)
- GXDTT = T + GT + TL; GTGT = GXDTT × TGTGT (8/10%); GXD = GXDTT + GTGT
- V. GXDNT (nhà tạm để ở và điều hành thi công) = GXDTT × rate (Bảng 3.7, bracket by GXDTT, "theo tuyến" or "còn lại") × (1 + TGTGT) — separate line after VAT
- Tổng dự toán: V = (GXD + GXDNT) + thiết bị + QLDA + tư vấn + chi phí khác; dự phòng Gdp1 = V × % (khối lượng/công việc phát sinh) and Gdp2 (trượt giá) = V × % or Σ_t (V/N) × [(1 + i)^t − 1] from duration N and chỉ số giá xây dựng i.

Rate tables are **data** (`data/legal/tt36-2026.json`, `data/legal/tt11-2021.json`) with source, table number and status. TT 36/2026 Bảng 3.3–3.7 are `verified` (Update 2 A1: PL III was not replaced by CV 9947/BXD-VPB); an admin can reset a table to `provisional`, which shows a warning banner. **Bracket base (Update 2 A1b)**: Bảng 3.3 and 3.7 are looked up by the công trình's chi phí XD trước thuế in the approved TMĐT (project field `gxdtt_tmdt`, tỷ đồng; fallback: the estimate's own GXDTT, iterated, with a warning), Bảng 3.4 by chi phí nhân công; no interpolation (opt-in only, with a warning). Bảng 3.5/3.6 missing rows use the parent loại công trình; TT rate can be overridden per hạng mục (công tác trong đường hầm). Dự phòng per PL II formulas 2.8 (kps ≤ 5%) and 2.9 (schedule per period, I_bq, ΔI). Every summary line shows its formula and source.

The historical TT 11/2021 method (C, LT, TT, GTk inside GT; G; Gxd) is kept unchanged for historical projects; its sample rates are marked GIÁ TRỊ MẪU.

## Sample data (seed)
- Labour resources in the current norm dataset use **nhóm nhân công** (e.g. "Nhân công nhóm 3") instead of cấp bậc thợ (TT 38/2026); the historical dataset keeps cấp bậc thợ.
- Seed ~40 common norm codes (bê tông lót, bê tông móng/cột/dầm/sàn, cốt thép, ván khuôn, xây gạch, trát, đào đất, đắp đất, sơn, lát nền, ép cọc...) with resources and sample prices. Mark every seeded record `is_sample=1` and show a banner "Dữ liệu định mức/đơn giá MẪU – thay bằng dữ liệu chính thức".
- Provide an importer for official norm/price data from Excel (column mapping dialog), so real định mức 12/2021 and provincial price books can be loaded later.
- Seed admin user from env `ADMIN_USER` / `ADMIN_PASS` (default admin/admin123 only in dev, force change on first login).

## Screens
1. Đăng nhập.
2. Danh sách công trình (tạo, sao chép, xóa, mở).
3. Công trình: tabs — "Dự toán chi tiết" (grid by hạng mục), "Giá vật liệu/NC/Máy", "Phân tích vật tư", "Tổng hợp vật tư", "Tổng hợp chi phí", "Cài đặt hệ số".
4. Norm search dialog (tìm theo mã hoặc tên, có dấu/không dấu).
5. AI assistant side panel (see below).
6. Import panel: "Từ máy tính" (upload .xlsx/.csv; when running locally also accept an absolute path) and "Từ Google Drive". Norm import targets a dataset (TT38_2026 / TT12_2021).
7. Căn cứ pháp lý (legal-basis register): documents with number, issuer, dates, status and official source; legal sets; rate tables with source/table number/status, admin "mark verified" and interpolation switch.

## Excel export (one workbook, Vietnamese template style)
Sheets: TH (Tổng hợp chi phí — with the project's legal basis (documents, dates, sources), a provisional-rates warning and a "Nguồn / căn cứ" column per line), DTCT (Dự toán chi tiết), PTVT (Phân tích vật tư), THVT (Tổng hợp vật tư), CLVT (Chênh lệch giá vật tư). Use real Excel formulas (not hard-coded numbers) so the file stays editable, A4 print setup, Times New Roman, number format #,##0.

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

## Update 2 features (docs/UPDATE-2.md)
- **B. Import existing estimate files (any layout)**: .xlsx/.xlsm/.xls/.csv; sheet list with auto-classification and 30-row preview; header detection (incl. merged 2-row headers, VN with/without diacritics, Chinese headers); row classification (hạng mục, công việc, Cộng/Tổng excluded, notes, numbering rows); VN/EN number formats, cached formula values, merged cells; mapping review with editable columns, row-type override, warnings; provenance (file/sheet/row/description/quantity/unit/code) on every item; code check + suggestions; reusable import templates by header fingerprint.
- **C. Norm lookup and auto code suggestion**: code prefixes (AF.1, AF11), abbreviations (BT, BTCT, VK, CT, M250/B20, PCB40, đk ≤10mm), parameter extraction, unit compatibility as a hard filter with conversion, top-5 with confidence and "vì sao"; grid suggestion column, one-click accept, bulk "Gắn mã tự động" (threshold, default 0,8, preview); auto codes must be confirmed before the estimate can be approved; assistant command "gắn mã cho các công việc chưa có mã".
- **D. Price books by region and period**: PriceBook (region = 34 tỉnh/thành after the 2025 merger, sub-area, issuer, document, month/quarter/year, type VL/NC/M/TH, VAT flag, delivery, source, draft/verified) with rows; project region + proposals; selection per resource type with priority; resolution manual → books → base (flagged); price source in the price tab and Excel THVT; Excel import with fuzzy matching and review list; price history and switching diff. Seed: one metadata-only HCMC book (0 rows).

## Out of scope for Phase 1
Thanh quyết toán, dự thầu nâng cao, đồng bộ nhiều người dùng thời gian thực, Electron installer (just prepare structure).
