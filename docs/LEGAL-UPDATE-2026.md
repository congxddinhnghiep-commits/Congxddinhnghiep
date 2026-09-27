# Legal basis update 2026 (verified 2026-09-27)

All instruments below were confirmed on the official government portal vanban.chinhphu.vn (metadata: number, date, effective date). Rate tables were extracted from the official PDF of TT 36/2026 Phụ lục III by an automated reader: they MUST be re-checked against the signed PDF (and the replacement appendices under Công văn 9947/BXD-VP) before being marked `official` in the app. Until then store them with status `provisional`.

## 1. Confirmed instruments

| Instrument | Issued | Effective | Role | Source |
|---|---|---|---|---|
| Luật Xây dựng 135/2025/QH15 | 10/12/2025 | 01/07/2026 | Luật khung | https://vanban.chinhphu.vn/?classid=1&docid=216514&pageid=27160&typegroupid=3 |
| Nghị định 206/2026/NĐ-CP | 15/06/2026 | 01/07/2026 | Quản lý chi phí ĐTXD (replaces NĐ 10/2021) | https://vanban.chinhphu.vn/?docid=218454&pageid=27160 |
| Nghị định 212/2026/NĐ-CP | 17/06/2026 | 01/07/2026 | Năng lực HĐXD, HTTT & CSDL quốc gia | https://vanban.chinhphu.vn/?docid=218489&pageid=27160 |
| Thông tư 36/2026/TT-BXD | 26/06/2026 | 01/07/2026 | Phương pháp xác định & quản lý chi phí ĐTXD. Repeals TT 11/2021/TT-BXD, TT 14/2023/TT-BXD, and Art.1 + PL III + PL V of TT 60/2025/TT-BXD (Điều 16.2) | https://vanban.chinhphu.vn/?pageid=27160&docid=218629 |
| Thông tư 37/2026/TT-BXD | 26/06/2026 | 01/07/2026 | Phương pháp xác định định mức, giá nhân công, giá ca máy, chỉ số giá | https://vanban.chinhphu.vn/?docid=218630&pageid=27160 |
| Thông tư 38/2026/TT-BXD | 26/06/2026 | 01/07/2026 | Ban hành định mức xây dựng (8 phụ lục). Replaces TT 12/2021, TT 09/2024, TT 08/2025, TT 60/2025 norm parts | https://vanban.chinhphu.vn/?classid=0&docid=218632&pageid=27160 |
| Công văn 9947/BXD-VP | 29/06/2026 | — | Thay thế phụ lục kèm TT 36/2026 và TT 38/2026 (implemented locally e.g. CV 10007/UBND-CNXD Đắk Lắk 05/07/2026) | https://vpubnd.daklak.gov.vn/Documents/Detail/11373 |
| Quyết định 1538/QĐ-BXD | 28/08/2026 | — | Đính chính TT 36/2026 | https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/9/dinh-chinh-tt36-bxd.signed.pdf |

Key consequences for DUTOAN-AI:
- TT 11/2021 and TT 09/2024 (used in Phase 1) are NO LONGER the basis for estimates dated on/after 01/07/2026. Keep them as a historical legal set for older projects only.
- Labor in norms is now by **nhóm nhân công** (e.g. "Nhân công nhóm 3") instead of cấp bậc thợ (e.g. "3,5/7"). Norm values are otherwise largely unchanged vs TT 12/2021.
- Transitional: ministry/provincial norms issued before 01/07/2026 must convert labor to nhóm nhân công by 01/09/2026.

## 2. Bảng tổng hợp dự toán chi phí xây dựng (TT 36/2026, PL III, Bảng 3.8 — as corrected by QĐ 1538/QĐ-BXD)

| STT | Khoản mục | Cách tính | Ký hiệu |
|---|---|---|---|
| I | Chi phí trực tiếp | VL + NC + M | T |
| 1 | Chi phí vật liệu | Σ Qj × Dj_vl | VL |
| 2 | Chi phí nhân công | Σ Qj × Dj_nc × Knc | NC |
| 3 | Chi phí máy & thiết bị thi công | Σ Qj × Dj_m × Km | M |
| II | Chi phí gián tiếp | C + TT | GT |
| 1 | Chi phí chung | T × tỷ lệ (Bảng 3.3) — or NC × tỷ lệ (Bảng 3.4) for listed work types | C |
| 2 | Chi phí một số công việc không xác định được khối lượng từ thiết kế | T × tỷ lệ (Bảng 3.5) | TT |
| III | Thu nhập chịu thuế tính trước | (T + GT) × tỷ lệ (Bảng 3.6) | TL |
|  | Chi phí xây dựng trước thuế | T + GT + TL | GXDTT |
| IV | Thuế GTGT | GXDTT × TGTGT | GTGT |
|  | Chi phí xây dựng sau thuế | GXDTT + GTGT | GXD |
| V | Chi phí nhà tạm để ở và điều hành thi công | GXDTT × tỷ lệ (Bảng 3.7) × (1 + TGTGT) | GXDNT |

Changes vs TT 11/2021: lán trại (nhà tạm) moved OUT of chi phí gián tiếp to a separate line V after VAT; "chi phí gián tiếp khác" no longer a standard line; brackets of Bảng 3.3 start at ≤40 tỷ.
Knc = 1 + (tỷ lệ làm đêm) × (tỷ lệ chênh lệch đơn giá đêm); Km = 1 + g × (Knc − 1), g = tỷ trọng tiền lương trong giá ca máy.

## 3. Rate tables (PROVISIONAL — verify against signed PDF)

Bảng 3.3 — Chi phí chung (% of T), by chi phí trực tiếp bracket (tỷ đồng):

| Loại công trình | ≤40 | ≤60 | ≤100 | ≤300 | ≤500 | ≤750 | ≤1000 | >1000 |
|---|---|---|---|---|---|---|---|---|
| Dân dụng | 7.3 | 7.1 | 6.7 | 6.5 | 6.2 | 6.1 | 6.0 | 5.8 |
| Tu bổ, phục hồi di tích | 11.6 | 11.1 | 10.3 | 10.1 | 9.9 | 9.8 | 9.6 | 9.4 |
| Công nghiệp | 6.2 | 6.0 | 5.6 | 5.3 | 5.1 | 5.0 | 4.9 | 4.6 |
| Công nghiệp — hầm thủy điện, hầm lò | 7.3 | 7.2 | 7.1 | 6.9 | 6.7 | 6.6 | 6.5 | 6.4 |
| Giao thông | 6.2 | 6.0 | 5.6 | 5.3 | 5.1 | 5.0 | 4.9 | 4.6 |
| Giao thông — hầm | 7.3 | 7.2 | 7.1 | 6.9 | 6.7 | 6.6 | 6.5 | 6.4 |
| Nông nghiệp & môi trường | 6.1 | 5.9 | 5.5 | 5.3 | 5.1 | 5.0 | 4.8 | 4.6 |
| Nông nghiệp — hầm | 7.3 | 7.2 | 7.1 | 6.9 | 6.7 | 6.6 | 6.5 | 6.4 |
| Hạ tầng kỹ thuật | 5.5 | 5.3 | 5.0 | 4.8 | 4.5 | 4.4 | 4.3 | 4.0 |

Bảng 3.4 — Chi phí chung (% of NC), by chi phí nhân công bracket: ≤15 / ≤50 / ≤100 / >100 tỷ
- Sửa chữa (corrected from "Bảo dưỡng") đường bộ, đường sắt, báo hiệu hàng hải…: 66 / 63 / 60 / 56
- Công trình nông nghiệp thủ công: 51 / 48 / 45 / 42
- Lắp đặt thiết bị công nghệ, đường dây điện, trạm biến áp: 65 / 62 / 59 / 55

Bảng 3.5 — Công việc không xác định được KL từ thiết kế (% of T): Dân dụng 2.5; Công nghiệp 2.0 (hầm thủy điện, hầm lò 6.5); Giao thông 2.0 (hầm 6.5); Nông nghiệp & MT 2.0 (hầm 6.5); Hạ tầng kỹ thuật 2.0.

Bảng 3.6 — Thu nhập chịu thuế tính trước (% of T+GT): Dân dụng 5.5; Công nghiệp 6.0; Giao thông 6.0; Nông nghiệp & MT 5.5; Hạ tầng kỹ thuật 5.5; Lắp đặt thiết bị công nghệ / đường dây điện 6.0.

Bảng 3.7 — Nhà tạm để ở và điều hành thi công (% of GXDTT), by GXDTT bracket ≤15 / ≤100 / ≤500 / ≤1000 / >1000 tỷ:
- Công trình theo tuyến: 2.2 / 2.0 / 1.9 / 1.8 / 1.7
- Công trình còn lại: 1.1 / 1.0 / 0.95 / 0.90 / 0.85

Bracket rule: look up the bracket by the estimate's own base (T, NC, or GXDTT as stated). Support linear interpolation between brackets only if the circular text requires it — check the PDF note under each table and implement exactly that (default: no interpolation, flag for review).

## 4. Dự phòng (TT 36/2026)
Two components: dự phòng cho khối lượng/công việc phát sinh (% of base costs) and dự phòng cho yếu tố trượt giá (based on duration and chỉ số giá xây dựng liên hoàn — wording corrected by QĐ 1538). Keep both as configurable lines with source and formula.
