# Định mức TT 38/2026/TT-BXD – dữ liệu tách từ PDF có chữ ký

Nguồn: bộ PDF `*_signed1.pdf` do người dùng cung cấp (bản phụ lục theo CV 9947/BXD-VPB). SHA-256 từng file trong `manifest.json`.
Công cụ: `parse_tt38.py` (PyMuPDF find_tables + hình học chữ), chạy lại: `python3 parse_tt38.py <pdf> PL2 out/pl2`.

| Phụ lục | Nội dung | Số mã | Dòng hao phí |
|---|---|---|---|
| I | Khảo sát xây dựng | 439 | 4.147 |
| II | Xây dựng công trình | 4.439 | 23.231 |
| III | Lắp đặt hệ thống kỹ thuật | 2.149 | 11.886 |
| IV | Lắp đặt thiết bị công trình | 517 | 7.026 |
| V | Thí nghiệm chuyên ngành | 495 | 3.643 |
| VI | Sửa chữa, bảo dưỡng | 973 | 3.570 |
| **Tổng** | | **9.012** | **53.503** |

Chưa tách: Phụ lục VII (định mức sử dụng vật liệu/cấp phối vữa, bê tông), Phụ lục VIII (chi phí QLDA, tư vấn).
Độ phủ: so với mã tiền tố xuất hiện trong PDF, PL1/3/4/5/6 đủ 100%; PL2 thiếu 6 tiền tố (AD.241, AD.253, AD.254, AD.255, AF.333, AL.192) – xem `tt38_2026_warnings.csv`.

Trạng thái: `imported_needs_review` – dữ liệu tách tự động, đã kiểm tra mẫu; cần người có chuyên môn đối chiếu ngẫu nhiên với PDF (cột `page`) trước khi đánh dấu `verified`.
Cột `raw` giữ nguyên chuỗi số trong PDF (dấu phẩy thập phân).
