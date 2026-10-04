/**
 * Update 5 — element-based quantity take-off ("Bóc khối lượng theo cấu kiện"): pure calculation
 * engine. Every formula is per ONE element; `computeElementTasks` multiplies by `count` and rounds
 * to 3 decimals (docs/UPDATE-5.md section I). No norm codes are invented here – resolving a task
 * against the active norm set is the caller's job (see packages/server/src/takeoff.ts), using the
 * existing suggestion engine (./suggest.ts).
 */

export type ElementType =
  | 'mong_don'
  | 'mong_bang'
  | 'dai_coc'
  | 'giang_mong'
  | 'tuong_mong'
  | 'cot'
  | 'dam'
  | 'san'
  | 'vach'
  | 'cau_thang'
  | 'tuong_xay'
  | 'lanh_to'
  | 'nen'
  | 'hoan_thien';

export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  mong_don: 'Móng đơn',
  mong_bang: 'Móng băng',
  dai_coc: 'Đài cọc / móng cọc',
  giang_mong: 'Giằng móng / đà kiềng',
  tuong_mong: 'Tường móng',
  cot: 'Cột',
  dam: 'Dầm',
  san: 'Sàn',
  vach: 'Vách BTCT',
  cau_thang: 'Cầu thang (bản)',
  tuong_xay: 'Tường xây',
  lanh_to: 'Lanh tô',
  nen: 'Nền',
  hoan_thien: 'Hoàn thiện (tự do)',
};

export type ElementParams = Record<string, number>;

export interface GeneratedTask {
  /** Stable key of the task template, e.g. "bt_mong" – used to aggregate the same work across elements. */
  key: string;
  name: string;
  unit: string;
  /** Human-readable formula with the element's actual numbers substituted, for traceability. */
  formula: string;
  /** Value for ONE element (not multiplied by count), rounded to 3 decimals. */
  perUnit: number;
  /** Value for the whole element (perUnit × count), rounded to 3 decimals. */
  value: number;
}

interface TaskTemplate {
  key: string;
  name: string;
  unit: string;
  /** Optional task, generated only when true (a param the user set) – or when force-enabled via `opts.enabled`. */
  condition?: (p: ElementParams) => boolean;
  calc: (p: ElementParams) => { value: number; formula: string };
}

const round3 = (x: number): number => Math.round((x + Number.EPSILON) * 1000) / 1000;
/** Number inside a human-readable formula, Vietnamese style: 1.8 → "1,8" (the formulas end up in "Diễn giải khối lượng"). */
const n = (x: number): string => (Number.isInteger(x) ? String(x) : String(round3(x)).replace('.', ','));

/**
 * Excavation of a rectangular pit (hố móng/đài): straight sides when `m` (hệ số mái dốc) is 0,
 * a sloped prismatoid (chóp cụt) otherwise – same shape as the `tt_chop_cut` manual-calc function.
 */
function pitExcavation(A: number, B: number, H_d: number, m: number): { value: number; formula: string } {
  if (!m) return { value: A * B * H_d, formula: `${n(A)}×${n(B)}×${n(H_d)}` };
  const Ap = A + 2 * m * H_d;
  const Bp = B + 2 * m * H_d;
  const value = (H_d / 6) * (A * B + (A + Ap) * (B + Bp) + Ap * Bp);
  return { value, formula: `${n(H_d)}/6×[${n(A)}×${n(B)}+(${n(A)}+${n(Ap)})×(${n(B)}+${n(Bp)})+${n(Ap)}×${n(Bp)}]` };
}

/** Excavation of a continuous trench (móng băng): 2-D cross-section × length L. */
function trenchExcavation(A: number, H_d: number, m: number, L: number): { value: number; formula: string } {
  if (!m) return { value: A * H_d * L, formula: `${n(A)}×${n(H_d)}×${n(L)}` };
  const Ap = A + 2 * m * H_d;
  const value = (H_d / 2) * (A + Ap) * L;
  return { value, formula: `${n(H_d)}/2×(${n(A)}+${n(Ap)})×${n(L)}` };
}

export const ELEMENT_DEFAULTS: Record<ElementType, ElementParams> = {
  mong_don: { a: 1, b: 1, h: 0.3, t_l: 0.1, e_l: 0.1, H_d: 1, e_tc: 0.3, m: 0, bc: 0, hc: 0, Hc: 0, h_ngam: 0 },
  mong_bang: { b: 0.3, h: 0.3, L: 1, bs: 0, hs: 0, t_l: 0.1, e_l: 0.1, H_d: 1, e_tc: 0.3, m: 0 },
  dai_coc: { a: 1, b: 1, h: 0.8, n: 1, D: 0.3, L: 5, dap_dau: 0.5, pile_shape: 0, t_l: 0.1, e_l: 0.1, H_d: 1.5, e_tc: 0.3, m: 0 },
  giang_mong: { b: 0.2, h: 0.3, L: 1, t_l: 0, e_l: 0.1 },
  tuong_mong: { b: 0.2, h: 0.3, L: 1, t_l: 0, e_l: 0.1 },
  cot: { b: 0.2, h: 0.2, D: 0, H: 3, h_dam: 0, cot_den_day_dam: 1, trat: 0 },
  dam: { b: 0.2, h: 0.3, L: 1, h_san: 0 },
  san: { S: 1, a: 0, b: 0, t: 0.1, S_lo: 0 },
  vach: { L: 1, H: 1, t: 0.2, S_lo: 0 },
  cau_thang: { w: 1, Ln: 1, t: 0.1, S_cn: 0 },
  tuong_xay: { L: 1, H: 1, day: 0.2, S_cua: 0, ba_son: 0, op_chan: 0 },
  lanh_to: { b: 0.1, h: 0.07, L: 1 },
  nen: { S: 1, t_bt: 0.1, t_lot: 0.05, t_da: 0, nilon: 0 },
  hoan_thien: { S: 1, L: 0 },
};

/** One element parameter as shown in the form: Vietnamese label, unit and a tooltip (Update 5 fix: no cryptic keys). */
export interface ElementParamMeta {
  label: string;
  /** '' for dimensionless values (hệ số, số cọc…). */
  unit: string;
  hint: string;
  /** 0/1 switch rendered as a checkbox. */
  flag?: boolean;
}

const P = (label: string, unit: string, hint: string, flag?: boolean): ElementParamMeta => (flag ? { label, unit, hint, flag } : { label, unit, hint });

const LOT_DAO: Record<string, ElementParamMeta> = {
  t_l: P('chiều dày bê tông lót', 'm', 'Chiều dày lớp bê tông lót dưới đáy (thường 0,1 m). Nhập 0 nếu không có lót.'),
  e_l: P('mở rộng lót mỗi bên', 'm', 'Bê tông lót rộng hơn đáy kết cấu mỗi bên một đoạn e_l (thường 0,1 m).'),
  H_d: P('chiều sâu đào', 'm', 'Chiều sâu hố đào tính từ cốt mặt đất tự nhiên đến đáy lớp lót.'),
  e_tc: P('mở rộng thi công mỗi bên', 'm', 'Khoảng mở rộng đáy hố đào mỗi bên ngoài mép lót để thi công (thường 0,3 m).'),
  m: P('hệ số mái dốc', '', 'm = 0: vách đào thẳng đứng; m = 0,5: mái dốc 1:0,5 (mỗi mét sâu mở rộng thêm 0,5 m mỗi bên).'),
};

/** Labels/units/tooltips for every parameter of every element type (same keys as ELEMENT_DEFAULTS). */
export const ELEMENT_PARAM_META: Record<ElementType, Record<string, ElementParamMeta>> = {
  mong_don: {
    a: P('cạnh dài móng', 'm', 'Kích thước cạnh dài của bản đế móng.'),
    b: P('cạnh ngắn móng', 'm', 'Kích thước cạnh ngắn của bản đế móng (chiều rộng móng để chọn mã ≤250 / >250 cm).'),
    h: P('chiều cao bản móng', 'm', 'Chiều dày (chiều cao) bản đế móng.'),
    ...LOT_DAO,
    bc: P('cạnh b tiết diện cổ móng', 'm', 'Kích thước tiết diện cổ móng theo phương b. Nhập 0 nếu không có cổ móng.'),
    hc: P('cạnh h tiết diện cổ móng', 'm', 'Kích thước tiết diện cổ móng theo phương h.'),
    Hc: P('chiều cao cổ móng', 'm', 'Chiều cao cổ móng (từ mặt bản móng đến đáy giằng / chân cột).'),
    h_ngam: P('chiều cao cổ móng nằm trong đất', 'm', 'Phần cổ móng chôn trong đất, được trừ khi tính đắp đất.'),
  },
  mong_bang: {
    b: P('bề rộng đáy móng băng', 'm', 'Bề rộng bản đáy móng băng.'),
    h: P('chiều cao bản móng', 'm', 'Chiều dày bản đáy móng băng.'),
    L: P('chiều dài móng băng', 'm', 'Chiều dài tính toán của đoạn móng băng.'),
    bs: P('bề rộng sườn móng', 'm', 'Bề rộng sườn (dầm) móng băng. Nhập 0 nếu không có sườn.'),
    hs: P('chiều cao sườn móng', 'm', 'Chiều cao sườn tính từ mặt bản móng.'),
    ...LOT_DAO,
  },
  dai_coc: {
    a: P('cạnh dài đài', 'm', 'Kích thước cạnh dài của đài cọc.'),
    b: P('cạnh ngắn đài', 'm', 'Kích thước cạnh ngắn của đài cọc.'),
    h: P('chiều cao đài', 'm', 'Chiều cao (chiều dày) đài cọc.'),
    n: P('số cọc trong đài', 'cọc', 'Số cọc của một đài.'),
    D: P('đường kính / cạnh cọc', 'm', 'Đường kính cọc tròn, hoặc cạnh cọc vuông khi bật “cọc vuông”.'),
    L: P('chiều dài cọc', 'm', 'Chiều dài một cọc (ép/đóng).'),
    dap_dau: P('đoạn đập đầu cọc', 'm', 'Chiều dài đoạn đầu cọc phải đập bỏ.'),
    pile_shape: P('cọc vuông', '', 'Bật: cọc vuông cạnh D (tiết diện D²). Tắt: cọc tròn đường kính D (π·D²/4).', true),
    ...LOT_DAO,
  },
  giang_mong: {
    b: P('bề rộng giằng', 'm', 'Bề rộng tiết diện giằng móng / đà kiềng.'),
    h: P('chiều cao giằng', 'm', 'Chiều cao tiết diện giằng móng.'),
    L: P('chiều dài giằng', 'm', 'Chiều dài thông thủy giữa các móng/cột.'),
    t_l: LOT_DAO.t_l,
    e_l: LOT_DAO.e_l,
  },
  tuong_mong: {
    b: P('bề dày tường móng', 'm', 'Chiều dày tường móng bê tông.'),
    h: P('chiều cao tường móng', 'm', 'Chiều cao tường móng.'),
    L: P('chiều dài tường móng', 'm', 'Chiều dài tường móng.'),
    t_l: LOT_DAO.t_l,
    e_l: LOT_DAO.e_l,
  },
  cot: {
    b: P('cạnh b tiết diện cột', 'm', 'Kích thước tiết diện cột chữ nhật theo phương b.'),
    h: P('cạnh h tiết diện cột', 'm', 'Kích thước tiết diện cột chữ nhật theo phương h.'),
    D: P('đường kính cột tròn', 'm', 'Chỉ dùng cho cột tròn; để 0 với cột chữ nhật.'),
    H: P('chiều cao tầng', 'm', 'Chiều cao cột tính từ mặt sàn/móng đến mặt sàn trên.'),
    h_dam: P('chiều cao dầm (trừ)', 'm', 'Chiều cao dầm đỡ sàn trên – được trừ khi tính cột đến đáy dầm.'),
    cot_den_day_dam: P('cột tính đến đáy dầm', '', 'Bật: chiều cao cột = H − h_dầm (quy tắc Cột > Dầm > Sàn). Tắt: dùng cả H.', true),
    trat: P('có trát cột', '', 'Bật để sinh công tác trát cột (chu vi × chiều cao).', true),
  },
  dam: {
    b: P('bề rộng dầm', 'm', 'Bề rộng tiết diện dầm.'),
    h: P('chiều cao dầm', 'm', 'Chiều cao tiết diện dầm (kể cả phần trong sàn).'),
    L: P('chiều dài thông thủy', 'm', 'Chiều dài dầm giữa hai mép cột.'),
    h_san: P('chiều dày sàn (trừ ván khuôn)', 'm', 'Chiều dày sàn – phần thành dầm nằm trong sàn không tính ván khuôn.'),
  },
  san: {
    S: P('diện tích sàn', 'm²', 'Diện tích sàn thông thủy (dùng khi a, b = 0).'),
    a: P('cạnh a ô sàn', 'm', 'Nếu nhập a và b > 0 thì diện tích = a × b (thay cho S).'),
    b: P('cạnh b ô sàn', 'm', 'Nếu nhập a và b > 0 thì diện tích = a × b (thay cho S).'),
    t: P('chiều dày sàn', 'm', 'Chiều dày bản sàn.'),
    S_lo: P('diện tích lỗ mở', 'm²', 'Tổng diện tích lỗ mở được trừ.'),
  },
  vach: {
    L: P('chiều dài vách', 'm', 'Chiều dài vách bê tông cốt thép.'),
    H: P('chiều cao vách', 'm', 'Chiều cao vách.'),
    t: P('chiều dày vách', 'm', 'Chiều dày vách.'),
    S_lo: P('diện tích lỗ mở', 'm²', 'Tổng diện tích lỗ cửa/lỗ mở được trừ.'),
  },
  cau_thang: {
    w: P('bề rộng bản thang', 'm', 'Bề rộng vế thang.'),
    Ln: P('chiều dài nghiêng bản thang', 'm', 'Chiều dài theo phương nghiêng của bản thang.'),
    t: P('chiều dày bản thang', 'm', 'Chiều dày bản thang và chiếu nghỉ.'),
    S_cn: P('diện tích chiếu nghỉ', 'm²', 'Diện tích chiếu nghỉ / chiếu tới.'),
  },
  tuong_xay: {
    L: P('chiều dài tường', 'm', 'Chiều dài tường xây.'),
    H: P('chiều cao tường', 'm', 'Chiều cao tường xây.'),
    day: P('chiều dày tường', 'm', 'Chiều dày tường (ví dụ 0,1 hoặc 0,2 m).'),
    S_cua: P('diện tích lỗ cửa', 'm²', 'Tổng diện tích cửa/lỗ mở được trừ.'),
    ba_son: P('có bả, sơn', '', 'Bật để sinh công tác bả, sơn 2 mặt tường.', true),
    op_chan: P('chiều dài ốp chân tường', 'm', 'Chiều dài ốp chân tường; 0 = không ốp.'),
  },
  lanh_to: {
    b: P('bề rộng lanh tô', 'm', 'Bề rộng tiết diện lanh tô.'),
    h: P('chiều cao lanh tô', 'm', 'Chiều cao tiết diện lanh tô.'),
    L: P('chiều dài lanh tô', 'm', 'Chiều dài lanh tô (kể cả phần gác lên tường).'),
  },
  nen: {
    S: P('diện tích nền', 'm²', 'Diện tích nền.'),
    t_bt: P('chiều dày bê tông nền', 'm', 'Chiều dày lớp bê tông nền.'),
    t_lot: P('chiều dày lớp lót', 'm', 'Chiều dày lớp bê tông lót nền; 0 = không có.'),
    t_da: P('chiều dày lớp đá', 'm', 'Chiều dày lớp đá 4x6 / 0x4 lót nền; 0 = không có.'),
    nilon: P('có lót nilon', '', 'Bật để sinh công tác lót nilon (m²).', true),
  },
  hoan_thien: {
    S: P('diện tích', 'm²', 'Diện tích lát / ốp / trần / sơn.'),
    L: P('chiều dài', 'm', 'Nhập chiều dài > 0 nếu công tác tính theo m (khi đó bỏ qua S).'),
  },
};

/** "a – cạnh dài móng (m)": key, Vietnamese label and unit, for forms and tooltips. */
export function elementParamLabel(type: ElementType, key: string): string {
  const m = ELEMENT_PARAM_META[type]?.[key];
  if (!m) return key;
  return `${key} – ${m.label}${m.unit ? ` (${m.unit})` : ''}`;
}

const sanArea = (p: ElementParams): number => (p.a > 0 && p.b > 0 ? p.a * p.b : p.S);

export const ELEMENT_TEMPLATES: Record<ElementType, TaskTemplate[]> = {
  mong_don: [
    { key: 'bt_mong', name: 'Bê tông móng', unit: 'm3', calc: (p) => ({ value: p.a * p.b * p.h, formula: `${n(p.a)}×${n(p.b)}×${n(p.h)}` }) },
    {
      key: 'bt_co_mong',
      name: 'Bê tông cổ móng',
      unit: 'm3',
      condition: (p) => p.bc > 0 && p.hc > 0 && p.Hc > 0,
      calc: (p) => ({ value: p.bc * p.hc * p.Hc, formula: `${n(p.bc)}×${n(p.hc)}×${n(p.Hc)}` }),
    },
    {
      key: 'bt_lot',
      name: 'Bê tông lót móng',
      unit: 'm3',
      calc: (p) => ({ value: (p.a + 2 * p.e_l) * (p.b + 2 * p.e_l) * p.t_l, formula: `(${n(p.a)}+2×${n(p.e_l)})×(${n(p.b)}+2×${n(p.e_l)})×${n(p.t_l)}` }),
    },
    { key: 'vk_mong', name: 'Ván khuôn móng', unit: 'm2', calc: (p) => ({ value: 2 * (p.a + p.b) * p.h, formula: `2×(${n(p.a)}+${n(p.b)})×${n(p.h)}` }) },
    {
      key: 'dao_mong',
      name: 'Đào móng',
      unit: 'm3',
      calc: (p) => pitExcavation(p.a + 2 * p.e_l + 2 * p.e_tc, p.b + 2 * p.e_l + 2 * p.e_tc, p.H_d, p.m),
    },
    {
      key: 'dap_dat',
      name: 'Đắp đất',
      unit: 'm3',
      calc: (p) => {
        const dao = pitExcavation(p.a + 2 * p.e_l + 2 * p.e_tc, p.b + 2 * p.e_l + 2 * p.e_tc, p.H_d, p.m).value;
        const btMong = p.a * p.b * p.h;
        const btLot = (p.a + 2 * p.e_l) * (p.b + 2 * p.e_l) * p.t_l;
        const coNgam = p.bc > 0 && p.hc > 0 ? p.bc * p.hc * p.h_ngam : 0;
        return { value: dao - (btMong + btLot + coNgam), formula: `Đào móng − (BT móng + BT lót${coNgam ? ' + cổ móng ngầm' : ''})` };
      },
    },
  ],
  mong_bang: [
    { key: 'bt_mong_bang', name: 'Bê tông móng băng', unit: 'm3', calc: (p) => ({ value: p.b * p.h * p.L, formula: `${n(p.b)}×${n(p.h)}×${n(p.L)}` }) },
    {
      key: 'bt_suon',
      name: 'Bê tông sườn móng băng',
      unit: 'm3',
      condition: (p) => p.bs > 0 && p.hs > 0,
      calc: (p) => ({ value: p.bs * p.hs * p.L, formula: `${n(p.bs)}×${n(p.hs)}×${n(p.L)}` }),
    },
    {
      key: 'bt_lot_bang',
      name: 'Bê tông lót móng băng',
      unit: 'm3',
      condition: (p) => p.t_l > 0,
      calc: (p) => ({ value: (p.b + 2 * p.e_l) * p.t_l * p.L, formula: `(${n(p.b)}+2×${n(p.e_l)})×${n(p.t_l)}×${n(p.L)}` }),
    },
    { key: 'vk_mong_bang', name: 'Ván khuôn móng băng', unit: 'm2', calc: (p) => ({ value: 2 * p.h * p.L, formula: `2×${n(p.h)}×${n(p.L)}` }) },
    {
      key: 'vk_suon',
      name: 'Ván khuôn sườn móng băng',
      unit: 'm2',
      condition: (p) => p.bs > 0 && p.hs > 0,
      calc: (p) => ({ value: 2 * p.hs * p.L, formula: `2×${n(p.hs)}×${n(p.L)}` }),
    },
    { key: 'dao_mong_bang', name: 'Đào móng băng', unit: 'm3', calc: (p) => trenchExcavation(p.b + 2 * p.e_l + 2 * p.e_tc, p.H_d, p.m, p.L) },
    {
      key: 'dap_mong_bang',
      name: 'Đắp đất móng băng',
      unit: 'm3',
      calc: (p) => {
        const dao = trenchExcavation(p.b + 2 * p.e_l + 2 * p.e_tc, p.H_d, p.m, p.L).value;
        const bt = p.b * p.h * p.L + (p.bs > 0 && p.hs > 0 ? p.bs * p.hs * p.L : 0);
        const lot = p.t_l > 0 ? (p.b + 2 * p.e_l) * p.t_l * p.L : 0;
        return { value: dao - (bt + lot), formula: 'Đào móng băng − (BT + lót)' };
      },
    },
  ],
  dai_coc: [
    { key: 'ep_coc', name: 'Ép/đóng cọc', unit: 'm', calc: (p) => ({ value: p.n * p.L, formula: `${n(p.n)}×${n(p.L)}` }) },
    { key: 'dap_dau_coc_cai', name: 'Đập đầu cọc', unit: 'cai', calc: (p) => ({ value: p.n, formula: `${n(p.n)}` }) },
    {
      key: 'dap_dau_coc_m3',
      name: 'Đập đầu cọc',
      unit: 'm3',
      calc: (p) => {
        const areaPerPile = p.pile_shape ? p.D * p.D : (Math.PI * p.D * p.D) / 4;
        return { value: areaPerPile * p.dap_dau * p.n, formula: `${p.pile_shape ? `${n(p.D)}²` : `π×${n(p.D)}²/4`}×${n(p.dap_dau)}×${n(p.n)}` };
      },
    },
    { key: 'bt_dai', name: 'Bê tông đài cọc', unit: 'm3', calc: (p) => ({ value: p.a * p.b * p.h, formula: `${n(p.a)}×${n(p.b)}×${n(p.h)}` }) },
    {
      key: 'bt_lot_dai',
      name: 'Bê tông lót đài',
      unit: 'm3',
      calc: (p) => ({ value: (p.a + 2 * p.e_l) * (p.b + 2 * p.e_l) * p.t_l, formula: `(${n(p.a)}+2×${n(p.e_l)})×(${n(p.b)}+2×${n(p.e_l)})×${n(p.t_l)}` }),
    },
    { key: 'vk_dai', name: 'Ván khuôn đài cọc', unit: 'm2', calc: (p) => ({ value: 2 * (p.a + p.b) * p.h, formula: `2×(${n(p.a)}+${n(p.b)})×${n(p.h)}` }) },
    { key: 'dao_dai', name: 'Đào đài cọc', unit: 'm3', calc: (p) => pitExcavation(p.a + 2 * p.e_l + 2 * p.e_tc, p.b + 2 * p.e_l + 2 * p.e_tc, p.H_d, p.m) },
    {
      key: 'dap_dai',
      name: 'Đắp đất đài cọc',
      unit: 'm3',
      calc: (p) => {
        const dao = pitExcavation(p.a + 2 * p.e_l + 2 * p.e_tc, p.b + 2 * p.e_l + 2 * p.e_tc, p.H_d, p.m).value;
        const bt = p.a * p.b * p.h;
        const lot = (p.a + 2 * p.e_l) * (p.b + 2 * p.e_l) * p.t_l;
        return { value: dao - (bt + lot), formula: 'Đào đài − (BT đài + BT lót)' };
      },
    },
  ],
  giang_mong: [
    { key: 'bt_giang', name: 'Bê tông giằng móng', unit: 'm3', calc: (p) => ({ value: p.b * p.h * p.L, formula: `${n(p.b)}×${n(p.h)}×${n(p.L)}` }) },
    { key: 'vk_giang', name: 'Ván khuôn giằng móng', unit: 'm2', calc: (p) => ({ value: 2 * p.h * p.L, formula: `2×${n(p.h)}×${n(p.L)}` }) },
    {
      key: 'lot_giang',
      name: 'Bê tông lót giằng móng',
      unit: 'm3',
      condition: (p) => p.t_l > 0,
      calc: (p) => ({ value: (p.b + 2 * p.e_l) * p.t_l * p.L, formula: `(${n(p.b)}+2×${n(p.e_l)})×${n(p.t_l)}×${n(p.L)}` }),
    },
  ],
  tuong_mong: [
    { key: 'bt_tuong_mong', name: 'Bê tông tường móng', unit: 'm3', calc: (p) => ({ value: p.b * p.h * p.L, formula: `${n(p.b)}×${n(p.h)}×${n(p.L)}` }) },
    { key: 'vk_tuong_mong', name: 'Ván khuôn tường móng', unit: 'm2', calc: (p) => ({ value: 2 * p.h * p.L, formula: `2×${n(p.h)}×${n(p.L)}` }) },
    {
      key: 'lot_tuong_mong',
      name: 'Bê tông lót tường móng',
      unit: 'm3',
      condition: (p) => p.t_l > 0,
      calc: (p) => ({ value: (p.b + 2 * p.e_l) * p.t_l * p.L, formula: `(${n(p.b)}+2×${n(p.e_l)})×${n(p.t_l)}×${n(p.L)}` }),
    },
  ],
  cot: [
    {
      key: 'bt_cot',
      name: 'Bê tông cột',
      unit: 'm3',
      calc: (p) => {
        const H = p.cot_den_day_dam ? Math.max(p.H - p.h_dam, 0) : p.H;
        if (p.D > 0) return { value: (Math.PI * p.D * p.D * H) / 4, formula: `π×${n(p.D)}²/4×${n(H)}` };
        return { value: p.b * p.h * H, formula: `${n(p.b)}×${n(p.h)}×${n(H)}` };
      },
    },
    {
      key: 'vk_cot',
      name: 'Ván khuôn cột',
      unit: 'm2',
      calc: (p) => {
        const H = p.cot_den_day_dam ? Math.max(p.H - p.h_dam, 0) : p.H;
        if (p.D > 0) return { value: Math.PI * p.D * H, formula: `π×${n(p.D)}×${n(H)}` };
        return { value: 2 * (p.b + p.h) * H, formula: `2×(${n(p.b)}+${n(p.h)})×${n(H)}` };
      },
    },
    {
      key: 'trat_cot',
      name: 'Trát cột',
      unit: 'm2',
      condition: (p) => !!p.trat,
      calc: (p) => {
        const H = p.cot_den_day_dam ? Math.max(p.H - p.h_dam, 0) : p.H;
        const perim = p.D > 0 ? Math.PI * p.D : 2 * (p.b + p.h);
        return { value: perim * H, formula: `chu vi×${n(H)}` };
      },
    },
  ],
  dam: [
    { key: 'bt_dam', name: 'Bê tông dầm', unit: 'm3', calc: (p) => ({ value: p.b * p.h * p.L, formula: `${n(p.b)}×${n(p.h)}×${n(p.L)}` }) },
    {
      key: 'vk_dam',
      name: 'Ván khuôn dầm',
      unit: 'm2',
      calc: (p) => ({ value: (p.b + 2 * (p.h - p.h_san)) * p.L, formula: `(${n(p.b)}+2×(${n(p.h)}−${n(p.h_san)}))×${n(p.L)}` }),
    },
  ],
  san: [
    {
      key: 'bt_san',
      name: 'Bê tông sàn',
      unit: 'm3',
      calc: (p) => {
        const S = sanArea(p);
        return { value: (S - p.S_lo) * p.t, formula: `(${n(S)}−${n(p.S_lo)})×${n(p.t)}` };
      },
    },
    {
      key: 'vk_san',
      name: 'Ván khuôn sàn',
      unit: 'm2',
      calc: (p) => {
        const S = sanArea(p);
        return { value: S - p.S_lo, formula: `${n(S)}−${n(p.S_lo)}` };
      },
    },
  ],
  vach: [
    { key: 'bt_vach', name: 'Bê tông vách', unit: 'm3', calc: (p) => ({ value: (p.L * p.H - p.S_lo) * p.t, formula: `(${n(p.L)}×${n(p.H)}−${n(p.S_lo)})×${n(p.t)}` }) },
    { key: 'vk_vach', name: 'Ván khuôn vách', unit: 'm2', calc: (p) => ({ value: 2 * (p.L * p.H - p.S_lo), formula: `2×(${n(p.L)}×${n(p.H)}−${n(p.S_lo)})` }) },
  ],
  cau_thang: [
    {
      key: 'bt_thang',
      name: 'Bê tông bản thang',
      unit: 'm3',
      calc: (p) => ({ value: (p.w * p.Ln + p.S_cn) * p.t, formula: `(${n(p.w)}×${n(p.Ln)}+${n(p.S_cn)})×${n(p.t)}` }),
    },
    { key: 'vk_thang', name: 'Ván khuôn đáy thang', unit: 'm2', calc: (p) => ({ value: p.w * p.Ln + p.S_cn, formula: `${n(p.w)}×${n(p.Ln)}+${n(p.S_cn)}` }) },
  ],
  tuong_xay: [
    { key: 'dt_tuong', name: 'Diện tích tường xây', unit: 'm2', calc: (p) => ({ value: p.L * p.H - p.S_cua, formula: `${n(p.L)}×${n(p.H)}−${n(p.S_cua)}` }) },
    { key: 'xay_tuong', name: 'Xây tường', unit: 'm3', calc: (p) => ({ value: (p.L * p.H - p.S_cua) * p.day, formula: `(${n(p.L)}×${n(p.H)}−${n(p.S_cua)})×${n(p.day)}` }) },
    { key: 'trat_2mat', name: 'Trát 2 mặt', unit: 'm2', calc: (p) => ({ value: 2 * (p.L * p.H - p.S_cua), formula: `2×(${n(p.L)}×${n(p.H)}−${n(p.S_cua)})` }) },
    {
      key: 'ba_son',
      name: 'Bả, sơn tường',
      unit: 'm2',
      condition: (p) => !!p.ba_son,
      calc: (p) => ({ value: 2 * (p.L * p.H - p.S_cua), formula: `2×(${n(p.L)}×${n(p.H)}−${n(p.S_cua)})` }),
    },
    {
      key: 'op_chan_tuong',
      name: 'Ốp chân tường',
      unit: 'm',
      condition: (p) => p.op_chan > 0,
      calc: (p) => ({ value: p.op_chan, formula: `${n(p.op_chan)}` }),
    },
  ],
  lanh_to: [
    { key: 'bt_lt', name: 'Bê tông lanh tô', unit: 'm3', calc: (p) => ({ value: p.b * p.h * p.L, formula: `${n(p.b)}×${n(p.h)}×${n(p.L)}` }) },
    { key: 'vk_lt', name: 'Ván khuôn lanh tô', unit: 'm2', calc: (p) => ({ value: (p.b + 2 * p.h) * p.L, formula: `(${n(p.b)}+2×${n(p.h)})×${n(p.L)}` }) },
  ],
  nen: [
    { key: 'bt_nen', name: 'Bê tông nền', unit: 'm3', calc: (p) => ({ value: p.S * p.t_bt, formula: `${n(p.S)}×${n(p.t_bt)}` }) },
    { key: 'lot_nen', name: 'Lót nền', unit: 'm3', condition: (p) => p.t_lot > 0, calc: (p) => ({ value: p.S * p.t_lot, formula: `${n(p.S)}×${n(p.t_lot)}` }) },
    { key: 'da_nen', name: 'Đá lót nền', unit: 'm3', condition: (p) => p.t_da > 0, calc: (p) => ({ value: p.S * p.t_da, formula: `${n(p.S)}×${n(p.t_da)}` }) },
    { key: 'nilon_nen', name: 'Nilon lót nền', unit: 'm2', condition: (p) => !!p.nilon, calc: (p) => ({ value: p.S, formula: `${n(p.S)}` }) },
  ],
  hoan_thien: [{ key: 'hoan_thien', name: 'Hoàn thiện', unit: 'm2', calc: (p) => ({ value: p.L > 0 ? p.L : p.S, formula: `${n(p.L > 0 ? p.L : p.S)}` }) }],
};

/**
 * Generated tasks for one element × `count` (docs/UPDATE-5.md section B/I). `opts.enabled` overrides
 * which optional tasks are on; `opts.elementName` names the free-form "Hoàn thiện" task after the element.
 */
export function computeElementTasks(type: ElementType, rawParams: ElementParams, count: number, opts: { enabled?: Record<string, boolean>; elementName?: string } = {}): GeneratedTask[] {
  const p: ElementParams = { ...ELEMENT_DEFAULTS[type], ...rawParams };
  const templates = ELEMENT_TEMPLATES[type] ?? [];
  const out: GeneratedTask[] = [];
  for (const t of templates) {
    const on = opts.enabled?.[t.key];
    if (on === false) continue;
    if (t.condition && !t.condition(p) && on !== true) continue;
    const { value, formula } = t.calc(p);
    let name = t.name;
    let unit = t.unit;
    if (type === 'hoan_thien') {
      name = opts.elementName?.trim() || name;
      unit = p.L > 0 ? 'm' : 'm2';
    }
    out.push({ key: t.key, name, unit, formula, perUnit: round3(value), value: round3(value * count) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// C. Norm-code family hints (TT 38/2026 Phụ lục II)
// ---------------------------------------------------------------------------

/**
 * Which TT38 PL2 table ("họ mã") a generated concrete task belongs to, and which column of that table its parameters
 * select (chiều rộng ≤250/>250 cm, tiết diện cột ≤0,1/>0,1 m², chiều cao ≤6/≤28/≤100 m, chiều dày tường ≤45/>45 cm).
 * Only a code-PREFIX of a table is named here – the actual codes always come from the project's norm dataset. Family
 * AF.1xxxx = vữa bê tông sản xuất bằng máy trộn, đổ bằng thủ công (the default for small buildings, e.g. "Bê tông lót
 * móng" → AF.111xx, never AF.211xx which is the "đổ bằng cần cẩu" table that merely repeats the words "lót móng").
 * Tasks without a hint (ván khuôn, đào, xây, trát…) fall back to the generic suggestion engine.
 */
export interface NormVariant {
  label: string;
  /** Tested against the norm name normalised by `normFamilyText`. */
  re: RegExp;
  /** The parameter was not known and a default was assumed (e.g. chiều cao ≤ 6 m when no tầng is set). */
  assumed?: boolean;
}

export interface NormHint {
  /** Code prefix of the TT38 table, e.g. "AF.111". */
  family: string;
  familyLabel: string;
  variants: NormVariant[];
}

export interface NormHintContext {
  /** Cao độ đỉnh of the element's tầng (elevation + height, m), when the element is placed on a tầng. */
  topElevationM?: number | null;
}

const widthVariant = (wm: number): NormVariant =>
  wm <= 2.5 ? { label: 'chiều rộng ≤ 250 cm', re: /\bchieu rong (cm )?le 250\b/ } : { label: 'chiều rộng > 250 cm', re: /\bchieu rong (cm )?gt 250\b/ };

const heightVariant = (h: number | null | undefined): NormVariant => {
  const assumed = h === null || h === undefined || !(h > 0);
  const v = assumed ? 6 : h <= 6 ? 6 : h <= 28 ? 28 : 100;
  return { label: `chiều cao ≤ ${v} m${assumed ? ' (giả định)' : ''}`, re: new RegExp(`\\bchieu cao (m )?le ${v}\\b`), assumed };
};

const sectionVariant = (area: number): NormVariant =>
  area <= 0.1 ? { label: 'tiết diện ≤ 0,1 m²', re: /\btiet dien cot (m2 )?le 0\.1\b/ } : { label: 'tiết diện > 0,1 m²', re: /\btiet dien cot (m2 )?gt 0\.1\b/ };

const thickVariant = (tm: number): NormVariant =>
  tm <= 0.45 ? { label: 'chiều dày ≤ 45 cm', re: /\bchieu day (cm )?le 45\b/ } : { label: 'chiều dày > 45 cm', re: /\bchieu day (cm )?gt 45\b/ };

const LOT = { family: 'AF.111', familyLabel: 'Bê tông lót móng (TT38 PL2 – AF.111)' };
const MONG = { family: 'AF.112', familyLabel: 'Bê tông móng (TT38 PL2 – AF.112)' };
const TUONG = { family: 'AF.121', familyLabel: 'Bê tông tường (TT38 PL2 – AF.121)' };
const COT = { family: 'AF.122', familyLabel: 'Bê tông cột (TT38 PL2 – AF.122)' };
const DAM = { family: 'AF.123', familyLabel: 'Bê tông xà dầm, giằng (TT38 PL2 – AF.123)' };

type HintFn = (p: ElementParams, ctx: NormHintContext) => NormHint;

const NORM_HINTS: Record<string, HintFn> = {
  bt_lot: (p) => ({ ...LOT, variants: [widthVariant(Math.min(p.a, p.b) + 2 * p.e_l)] }),
  bt_lot_dai: (p) => ({ ...LOT, variants: [widthVariant(Math.min(p.a, p.b) + 2 * p.e_l)] }),
  bt_lot_bang: (p) => ({ ...LOT, variants: [widthVariant(p.b + 2 * p.e_l)] }),
  lot_giang: (p) => ({ ...LOT, variants: [widthVariant(p.b + 2 * p.e_l)] }),
  lot_tuong_mong: (p) => ({ ...LOT, variants: [widthVariant(p.b + 2 * p.e_l)] }),
  bt_mong: (p) => ({ ...MONG, variants: [widthVariant(Math.min(p.a, p.b))] }),
  bt_dai: (p) => ({ ...MONG, variants: [widthVariant(Math.min(p.a, p.b))] }),
  bt_mong_bang: (p) => ({ ...MONG, variants: [widthVariant(p.b)] }),
  bt_suon: (p) => ({ ...MONG, variants: [widthVariant(p.b)] }),
  bt_co_mong: (p, ctx) => ({ ...COT, variants: [sectionVariant(p.bc * p.hc), heightVariant(ctx.topElevationM ?? p.Hc)] }),
  bt_cot: (p, ctx) => ({ ...COT, variants: [sectionVariant(p.D > 0 ? (Math.PI * p.D * p.D) / 4 : p.b * p.h), heightVariant(ctx.topElevationM ?? p.H)] }),
  bt_dam: (_p, ctx) => ({ ...DAM, variants: [heightVariant(ctx.topElevationM)] }),
  bt_giang: (_p, ctx) => ({ ...DAM, variants: [heightVariant(ctx.topElevationM)] }),
  bt_tuong_mong: (p, ctx) => ({ ...TUONG, variants: [thickVariant(p.b), heightVariant(ctx.topElevationM)] }),
  bt_vach: (p, ctx) => ({ ...TUONG, variants: [thickVariant(p.t), heightVariant(ctx.topElevationM ?? p.H)] }),
  bt_san: () => ({ family: 'AF.1241', familyLabel: 'Bê tông sàn mái (TT38 PL2 – AF.124)', variants: [] }),
  bt_lt: () => ({ family: 'AF.1251', familyLabel: 'Bê tông lanh tô, ô văng (TT38 PL2 – AF.125)', variants: [] }),
  bt_thang: () => ({ family: 'AF.1261', familyLabel: 'Bê tông cầu thang thường (TT38 PL2 – AF.126)', variants: [] }),
  bt_nen: () => ({ family: 'AF.1131', familyLabel: 'Bê tông nền (TT38 PL2 – AF.113)', variants: [] }),
};

/** Norm-family hint for one generated task of an element, or null (→ generic suggestion engine). */
export function taskNormHint(type: ElementType, taskKey: string, rawParams: ElementParams, ctx: NormHintContext = {}): NormHint | null {
  const fn = NORM_HINTS[taskKey];
  return fn ? fn({ ...ELEMENT_DEFAULTS[type], ...rawParams }, ctx) : null;
}

/** Norm name → plain comparable text: "Chiều rộng (cm) – ≤250" → "chieu rong cm le 250". */
export function normFamilyText(name: string): string {
  return name
    .replace(/≤|<=/g, ' le ')
    .replace(/≥|>=/g, ' ge ')
    .replace(/>/g, ' gt ')
    .replace(/</g, ' le ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FamilyCandidate<T extends { code: string; name: string }> {
  norm: T;
  confidence: number;
  why: string;
}

/**
 * Rank the codes of a hint's family by how many of its parameter columns they match. Confidence: 0,65 for being in the
 * right table + 0,3 × (share of matched columns); an assumed (defaulted) parameter costs 0,1, so it is shown as a
 * suggestion but never auto-assigned (auto ≥ 0,8). Codes outside the family are never returned.
 */
export function rankFamilyNorms<T extends { code: string; name: string }>(norms: T[], hint: NormHint): FamilyCandidate<T>[] {
  const fam = norms.filter((n) => n.code.toUpperCase().startsWith(hint.family.toUpperCase()));
  const total = hint.variants.length;
  return fam
    .map((norm) => {
      const text = normFamilyText(norm.name);
      const hit = hint.variants.filter((v) => v.re.test(text));
      const assumedHit = hit.some((v) => v.assumed);
      const confidence = total ? 0.65 + (0.3 * hit.length) / total - (assumedHit ? 0.1 : 0) : 0.9;
      const why = [hint.familyLabel, ...hit.map((v) => v.label)].join(' · ');
      return { norm, confidence: Math.round(confidence * 100) / 100, why, hits: hit.length };
    })
    .sort((x, y) => y.hits - x.hits || y.confidence - x.confidence || x.norm.code.localeCompare(y.norm.code))
    .map(({ norm, confidence, why }) => ({ norm, confidence, why }));
}

// ---------------------------------------------------------------------------
// D. Rebar ("bảng thống kê cốt thép")
// ---------------------------------------------------------------------------

/** kg/m by diameter (mm), TCVN typical values; other diameters fall back to d²×0,006165 (steel density). */
export const REBAR_UNIT_WEIGHT: Record<number, number> = {
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  14: 1.21,
  16: 1.58,
  18: 2.0,
  20: 2.47,
  22: 2.98,
  25: 3.85,
  28: 4.83,
  32: 6.31,
};

export function rebarUnitWeight(diaMm: number): number {
  return REBAR_UNIT_WEIGHT[diaMm] ?? 0.006165 * diaMm * diaMm;
}

export type RebarGroup = 'le10' | 'le18' | 'gt18';

export const REBAR_GROUP_LABELS: Record<RebarGroup, string> = { le10: 'Ø ≤ 10', le18: '10 < Ø ≤ 18', gt18: 'Ø > 18' };

export function rebarGroup(diaMm: number): RebarGroup {
  return diaMm <= 10 ? 'le10' : diaMm <= 18 ? 'le18' : 'gt18';
}

export interface RebarRowInput {
  diaMm: number;
  /** L1..L6 (mm) of the bar shape; summed when `chieuDai1ThanhMm` is not given directly. */
  lengths?: (number | null | undefined)[];
  chieuDai1ThanhMm?: number | null;
  soThanh1CauKien: number;
  soCauKien: number;
}

export interface RebarRowResult {
  chieuDai1ThanhMm: number;
  tongChieuDaiM: number;
  tongTrongLuongKg: number;
  group: RebarGroup;
}

export function computeRebarRow(r: RebarRowInput): RebarRowResult {
  const len1 = r.chieuDai1ThanhMm ?? (r.lengths ?? []).filter((x): x is number => Number.isFinite(x as number)).reduce((a, b) => a + b, 0);
  const tongChieuDaiM = round3((len1 / 1000) * r.soThanh1CauKien * r.soCauKien);
  const tongTrongLuongKg = round3(tongChieuDaiM * rebarUnitWeight(r.diaMm));
  return { chieuDai1ThanhMm: len1, tongChieuDaiM, tongTrongLuongKg, group: rebarGroup(r.diaMm) };
}

/** Summarise a set of rebar rows by TT38 group (Ø≤10 / 10<Ø≤18 / Ø>18), in tấn. */
export function summarizeRebarByGroup(rows: RebarRowResult[]): Record<RebarGroup, number> {
  const out: Record<RebarGroup, number> = { le10: 0, le18: 0, gt18: 0 };
  for (const r of rows) out[r.group] += r.tongTrongLuongKg / 1000;
  (Object.keys(out) as RebarGroup[]).forEach((k) => (out[k] = round3(out[k])));
  return out;
}

// ---------------------------------------------------------------------------
// E.2 "Bảng tính nhanh" (quick table)
// ---------------------------------------------------------------------------

export interface QuickRowInput {
  n: number;
  a: number;
  l: number;
  h: number;
}

export interface QuickRowResult {
  area: number;
  length: number;
  volume: number;
  lateralArea: number;
}

export function computeQuickRow(r: QuickRowInput): QuickRowResult {
  return {
    area: round3(r.a * r.n),
    length: round3(r.l * r.n),
    volume: round3(r.a * r.h * r.n),
    lateralArea: round3(r.l * r.h * r.n),
  };
}

// ---------------------------------------------------------------------------
// H. ETABS — interface + stub only (fallback / later phase, docs/ETABS.md)
// ---------------------------------------------------------------------------

export interface EtabsStoryInfo {
  name: string;
  heightM: number;
  elevationM: number;
}

export interface EtabsFrameInfo {
  name: string;
  kind: 'column' | 'beam';
  story: string;
  /** Rectangular section (b×h, m) or a round one (diameter, m). */
  section: { b: number; h: number } | { diameter: number };
  lengthM: number;
}

export interface EtabsAreaInfo {
  name: string;
  kind: 'slab' | 'wall';
  story: string;
  thicknessM: number;
  areaM2: number;
}

/** Source of take-off elements: the manual UI, an Excel import, or (later) ETABS. */
export interface ElementSource {
  listStories(): Promise<EtabsStoryInfo[]>;
  listFrames(): Promise<EtabsFrameInfo[]>;
  listAreas(): Promise<EtabsAreaInfo[]>;
}

const ETABS_NOT_SUPPORTED =
  'Chưa hỗ trợ trong bản này: kết nối trực tiếp tới ETABS. Hãy xuất bảng (Story Definitions, Frame/Area Assignments) từ ETABS ra Excel và dùng chức năng Nhập dữ liệu, hoặc xem docs/ETABS.md.';

/** Always-unsupported stub (web app cannot call the ETABS API; see docs/ETABS.md for the two future options). */
export class UnsupportedElementSource implements ElementSource {
  async listStories(): Promise<EtabsStoryInfo[]> {
    throw new Error(ETABS_NOT_SUPPORTED);
  }
  async listFrames(): Promise<EtabsFrameInfo[]> {
    throw new Error(ETABS_NOT_SUPPORTED);
  }
  async listAreas(): Promise<EtabsAreaInfo[]> {
    throw new Error(ETABS_NOT_SUPPORTED);
  }
}
