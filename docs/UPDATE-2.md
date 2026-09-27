# Update 2 — verified legal details + new features (2026-09-27)

## A. Resolution of open issues (verified from official PDFs on datafiles.chinhphu.vn)

### A1. TT 36/2026 rate tables → mark VERIFIED
- Công văn 9947/BXD-VPB (29/06/2026) replaced only **Phụ lục V of TT 36/2026** and **Phụ lục I–VIII of TT 38/2026**. Phụ lục II and III of TT 36 were NOT replaced.
- A second verbatim transcription of TT 36 Phụ lục III (file 03.thongtuqlcp-pl3-cpxd.pdf) matches all numbers in docs/LEGAL-UPDATE-2026.md for Bảng 3.3, 3.4, 3.5, 3.6, 3.7.
- Therefore set status of Bảng 3.3–3.7 to `verified` (source: TT 36/2026/TT-BXD PL III + QĐ 1538/QĐ-BXD), verified_by "Claude (automated transcription, 2 passes)", verified_at 2026-09-27. Keep the ability for an admin to reset to provisional.
- Correct the document number everywhere to **9947/BXD-VPB**.

### A1b. IMPORTANT correction — bracket base
- Bảng 3.3 and Bảng 3.7 brackets are looked up by **"chi phí xây dựng trước thuế của từng công trình trong tổng mức đầu tư của dự án được duyệt" (tỷ đồng)** — NOT by chi phí trực tiếp T. The rate is then applied to T (3.3) or GXDTT (3.7).
- Bảng 3.4 brackets are by **chi phí nhân công** (tỷ đồng); rate applied to NC in chi phí trực tiếp. Row 1 label is "Sửa chữa đường bộ, đường sắt, hệ thống báo hiệu hàng hải" (corrected by QĐ 1538); row 2 "Công trình nông nghiệp và môi trường thực hiện hoàn toàn bằng thủ công"; row 3 "Lắp đặt thiết bị công nghệ; xây lắp đường dây tải điện và trạm biến áp".
- Add project field `gxdtt_tmdt` ("Chi phí XD trước thuế trong TMĐT được duyệt, tỷ đồng"). If empty, fall back to the estimate's own GXDTT (iterate: compute with bracket from T, then re-check bracket with resulting GXDTT until stable) and show a warning "Chưa nhập chi phí XD trong TMĐT được duyệt – đang dùng giá trị dự toán để tra khoảng".
- Interpolation: the circular gives NO interpolation rule → discrete brackets only; remove/disable interpolation by default (keep as opt-in with warning "không có căn cứ trong TT 36").
- Projects split into component projects: rates are determined per công trình (per its own chi phí XD trước thuế).

### A2. Missing rows in Bảng 3.5 / 3.6
- Bảng 3.5 has explicit rows: dân dụng 2,5; công nghiệp 2,0 (riêng công tác XD trong đường hầm thủy điện, hầm lò 6,5); giao thông 2,0 (riêng công tác XD trong đường hầm giao thông 6,5); nông nghiệp & môi trường 2,0 (riêng công tác XD trong đường hầm 6,5); hạ tầng kỹ thuật 2,0. No row for tu bổ di tích → use parent "dân dụng" (2,5).
- Bảng 3.6 has no sub-rows for hầm or di tích → use the parent loại công trình (dân dụng 5,5; công nghiệp 6,0; giao thông 6,0; NN&MT 5,5; HTKT 5,5; lắp đặt thiết bị công nghệ / đường dây & TBA / thí nghiệm hiệu chỉnh điện 6,0).
- Replace the "nearest row" warning with an informational note citing this rule. Note that hầm rates in 3.5 apply to "công tác xây dựng trong đường hầm" (work items), so allow per-hạng mục override of the TT rate.

### A3. Dự phòng (TT 36/2026 Phụ lục II, công thức 2.8 & 2.9)
- GDP1 = G_TDP × kps, with kps ≤ 5% (validate and block > 5%). G_TDP = giá trị dự toán XD công trình trước chi phí dự phòng.
- GDP2 = Σ_{t=1..T} G_TDP_t × [ (I_bq + ΔI)^t − 1 ], T = thời gian xây dựng (quý hoặc năm), G_TDP_t = giá trị thực hiện trong khoảng t (user enters a schedule, default equal split), I_bq = chỉ số giá XD bình quân dùng tính dự phòng, ΔI = mức biến động bình quân của chỉ số giá XD. Implement exactly this, with unit tests (hand-calculated example: G=10 tỷ split 2 years 60/40, I_bq=1.03, ΔI=0.005 → GDP2 = 6×(1.035−1) + 4×(1.035²−1) = 0.21 + 0.2849 = 0.4949 tỷ).
- Dự phòng lines appear in the dự toán công trình summary (after GXD and nhà tạm), each with formula and source.

### A4. Sample norms / nhóm nhân công
- TT 38/2026 appendices were re-issued by CV 9947/BXD-VPB; official norm values must come from the replacement files. Do NOT invent labor groups. Keep the sample norms clearly flagged `sample`, remove any claim that their labor group is from TT 38, and make the norm importer (section B) able to load the official TT 38 norm workbook (any layout) including labor rows "Nhân công nhóm N".

## B. New feature: import existing estimate files (any Excel layout)
Goal: user uploads an existing dự toán / BOQ Excel file (F1, G8, Eta, GXD, company templates, or free-form) and the system extracts what it needs.
1. Accept .xlsx/.xls/.xlsm/.csv; list all sheets with a preview (first 30 rows) and auto-classify each sheet: dự toán chi tiết / tổng hợp chi phí / phân tích vật tư / tổng hợp vật tư / giá vật liệu / khác.
2. Header detection: scan the first ~30 rows for the header row(s) (including merged 2-row headers), matching synonyms with and without diacritics, e.g. STT; Mã hiệu / Mã ĐM / Mã CV / Mã số; Tên công việc / Nội dung công việc / Hạng mục / Diễn giải; Đơn vị / ĐVT; Khối lượng / KL; Đơn giá (VL, NC, M); Thành tiền; Diễn giải khối lượng; Ghi chú. Also Chinese headers used in bilingual files (序号, 编码, 项目名称, 单位, 工程量, 单价, 合价).
3. Row classification: category/hạng mục header rows (roman numerals, bold, no quantity), work item rows, sub-total rows (Cộng / Tổng / 小计 / 合计 — must be excluded), note rows, empty rows. Handle Vietnamese number formats (1.234,56 and 1,234.56), formulas (read cached values), merged cells.
4. Mapping review screen: show detected column mapping (editable dropdowns), detected rows with type badges, counts, and warnings (missing unit, zero quantity, duplicated items, unknown units). User confirms before import. Preserve source file/sheet/row and original description, quantity and unit on every imported item (never overwrite).
5. For items without a norm code, run the auto-matching engine (section C) and show suggestions.
6. Save the mapping as a reusable "mẫu nhập" template keyed by a header fingerprint so the same layout imports in one click next time.
7. Tests with at least 3 synthetic fixtures (F1-like layout, a free-form BOQ with merged headers and subtotals, a bilingual Vietnamese–Chinese layout).

## C. New feature: smarter norm lookup + automatic code suggestion
1. Search box accepts code prefixes (AF.1, AF11), Vietnamese with/without diacritics, abbreviations (BT, BTCT, VK, CT = cốt thép, M250/B20, PCB40, đk ≤10mm), and ranks by relevance.
2. Auto-suggest engine for a work description + unit: normalize text (lowercase, strip diacritics, expand abbreviations, extract parameters: concrete grade M/B, steel diameter, thickness, height ≤ x m, soil class cấp I–IV, mortar grade, member type móng/cột/dầm/sàn/tường). Score candidates by token similarity (e.g. BM25 / trigram), unit compatibility (hard filter m3 vs m2 vs tấn vs 100m3 with conversion), parameter matches, and chapter/group hints. Return top 5 with a confidence score and a short "vì sao" explanation.
3. UI: in the estimate grid, a suggestion column/badge; one click to accept; bulk "Gắn mã tự động" for all items with confidence ≥ threshold (user-set, default 0.8) – items below threshold stay "cần xem lại". Every auto-assigned code is marked `auto` and needs user confirmation before the estimate can be marked approved.
4. The assistant command "gắn mã cho các công việc chưa có mã" uses the same engine with preview/confirm.
5. Tests: at least 20 description→expected-code cases on the sample norm set.

## D. New feature: price books by region and time (bộ đơn giá / công bố giá theo khu vực & thời điểm)
1. New entity PriceBook: region (tỉnh/thành, optional khu vực/sub-area), issuer (e.g. Sở Xây dựng TP. Hồ Chí Minh), document number and date, price period (month/quarter/year), type (vật liệu / nhân công / ca máy / đơn giá tổng hợp), VAT included/excluded, delivery condition, source file/URL, status (draft/verified), and its price rows (resource code/name/spec/unit/price, optional sub-area).
2. Project settings: choose region + price period, then the system proposes matching price books (same region, latest period ≤ price date); user selects one or more books per resource type with priority order. Resolution order per resource: project manual override → selected books by priority → base sample price (flagged). Show the source of each applied price in the price tab and in Excel (column "Nguồn giá").
3. Price book import from Excel (any layout, reuse the header detector) with mapping to existing resources by code or fuzzy name/spec match; unmatched rows go to a review list.
4. Compare view: same resource across periods/regions (price history) and "Chênh lệch giá" when switching books.
5. Seed ONE metadata-only example (no invented prices): region "TP. Hồ Chí Minh", issuer "Sở Xây dựng TP. Hồ Chí Minh", "Công bố giá vật liệu xây dựng tháng 02/2026", document "7563/TB-SXD-KTVLXD ngày 10/03/2026" (source: dutoanf1.com.vn summary; official page soxaydung.hochiminhcity.gov.vn), status draft, 0 rows, note "Tải file công bố giá chính thức và nhập vào để sử dụng". Also a region list of all 34 tỉnh/thành after the 2025 merger (names only) for the dropdown.
6. Tests: resolution order, period selection, VAT flag handling, import mapping.

## E. General
- Follow .claude/skills/du-toan-cong-trinh-viet-nam/SKILL.md rules (no invented official data, provenance on every row, preview before bulk changes).
- Update README (Vietnamese user guide for the 3 new features), DECISIONS, SPEC, LEGAL-UPDATE-2026 (bracket base correction, VPB number, verified status).
- npm test + npm run build must pass; restart the app on port 3000 with the normal database; commit in logical steps and push.
