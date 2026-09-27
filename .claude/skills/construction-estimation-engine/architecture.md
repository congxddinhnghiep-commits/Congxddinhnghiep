# Kiến trúc đề xuất cho app dự toán

## Modules
1. Importer & Template Detector
2. Encoding/Normalization Service
3. Quantity Expression Engine
4. Norm Catalog Service
5. Resource Expansion Engine
6. Price Resolver
7. Cost Rule Engine
8. Estimate Aggregator
9. Validator
10. Audit/Provenance
11. Exporter

## Database
Khuyến nghị PostgreSQL. Dùng JSONB cho biểu thức rule và metadata nguồn; dữ liệu lõi vẫn relational.

## Rule engine
Không lưu tỷ lệ trong code nguồn. Lưu expression có whitelist biến:
`(VL + NC + M) * rate`, `T * rate`, `(T + C) * rate`.

Mỗi rule gồm:
- key
- formula
- rate/parameters
- base variable
- effective dates
- project type
- discipline
- location
- priority
- source/reference

## Quantity parser
Không `eval`.
- tokenize
- parse AST
- whitelist numeric literal, variable, + - * / parentheses
- unit-aware evaluation
- max expression length/depth
- deterministic rounding policy

## Search mã hiệu
Hybrid:
- exact/canonical code
- full-text Vietnamese normalized
- synonyms
- unit match
- discipline filter
- optional embedding rerank
Trả cả lý do match.

## Auditability
Mỗi số tiền cuối cùng phải truy ngược:
summary → estimate item → resource line → norm → quantity line → source price/rule → source file/cell.
