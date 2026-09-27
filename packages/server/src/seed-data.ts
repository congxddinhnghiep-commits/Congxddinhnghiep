/**
 * SAMPLE norms/resources/prices for demonstration only (is_sample = 1).
 * Codes follow the style of Định mức 12/2021/TT-BXD but consumptions and prices are
 * approximate — replace with official data via the Excel importer.
 */
import type { ResourceType } from '@dutoan/core';

type R = [code: string, name: string, unit: string, type: ResourceType, price: number];

export const SAMPLE_RESOURCES: R[] = [
  ['V.XM40', 'Xi măng PCB40', 'kg', 'VL', 1500],
  ['V.CATV', 'Cát vàng', 'm3', 'VL', 350000],
  ['V.CATM', 'Cát mịn ML=1,5-2,0', 'm3', 'VL', 250000],
  ['V.CATSL', 'Cát san lấp', 'm3', 'VL', 150000],
  ['V.DA12', 'Đá dăm 1x2', 'm3', 'VL', 380000],
  ['V.DA46', 'Đá dăm 4x6', 'm3', 'VL', 320000],
  ['V.NUOC', 'Nước', 'm3', 'VL', 15000],
  ['V.THEP10', 'Thép tròn D≤10mm', 'kg', 'VL', 17500],
  ['V.THEP18', 'Thép tròn D≤18mm', 'kg', 'VL', 17000],
  ['V.THEP18L', 'Thép tròn D>18mm', 'kg', 'VL', 16800],
  ['V.DAYTHEP', 'Dây thép buộc', 'kg', 'VL', 25000],
  ['V.QUEHAN', 'Que hàn', 'kg', 'VL', 30000],
  ['V.GOVAN', 'Gỗ ván khuôn', 'm3', 'VL', 4500000],
  ['V.GODA', 'Gỗ đà nẹp, gỗ chống', 'm3', 'VL', 4000000],
  ['V.DINH', 'Đinh các loại', 'kg', 'VL', 22000],
  ['V.GACHDAC', 'Gạch đặc 6,5x10,5x22cm', 'viên', 'VL', 1300],
  ['V.GACHLO', 'Gạch rỗng 2 lỗ 6,5x10,5x22cm', 'viên', 'VL', 1100],
  ['V.GACH60', 'Gạch ceramic 600x600mm', 'm2', 'VL', 180000],
  ['V.BOTBA', 'Bột bả tường', 'kg', 'VL', 8000],
  ['V.SONLOT', 'Sơn lót', 'kg', 'VL', 60000],
  ['V.SONPHU', 'Sơn phủ', 'kg', 'VL', 85000],
  ['V.COC25', 'Cọc BTCT 25x25cm', 'm', 'VL', 280000],
  ['N.3.0', 'Nhân công bậc 3,0/7 - Nhóm I', 'công', 'NC', 245000],
  ['N.3.5', 'Nhân công bậc 3,5/7 - Nhóm I', 'công', 'NC', 262000],
  ['N.4.0', 'Nhân công bậc 4,0/7 - Nhóm I', 'công', 'NC', 280000],
  ['M.TRONBT250', 'Máy trộn bê tông 250 lít', 'ca', 'M', 320000],
  ['M.TRONVUA150', 'Máy trộn vữa 150 lít', 'ca', 'M', 280000],
  ['M.DAMDUI', 'Máy đầm dùi 1,5kW', 'ca', 'M', 250000],
  ['M.DAMBAN', 'Máy đầm bàn 1kW', 'ca', 'M', 240000],
  ['M.VANTHANG', 'Vận thăng lồng 3T', 'ca', 'M', 900000],
  ['M.CATUON', 'Máy cắt uốn cốt thép 5kW', 'ca', 'M', 280000],
  ['M.HAN23', 'Máy hàn điện 23kW', 'ca', 'M', 350000],
  ['M.DAO08', 'Máy đào 0,8m3', 'ca', 'M', 3200000],
  ['M.DAMCOC', 'Máy đầm đất cầm tay 70kg', 'ca', 'M', 380000],
  ['M.OTO7', 'Ô tô tự đổ 7T', 'ca', 'M', 1700000],
  ['M.EPCOC150', 'Máy ép cọc 150T', 'ca', 'M', 3000000],
  ['M.CAU10', 'Cần cẩu bánh hơi 10T', 'ca', 'M', 2800000],
];

type N = [code: string, name: string, unit: string, group: string, resources: [string, number][]];

/** Concrete mix per 1 m3 (sample): cement kg, sand m3, stone m3 */
const MIX: Record<number, [number, number, number]> = {
  100: [218, 0.531, 0.936],
  250: [415, 0.455, 0.887],
  300: [450, 0.455, 0.88],
};

function concrete(code: string, name: string, grade: 100 | 250 | 300, labour: number, extra: [string, number][]): N {
  const [xm, cat, da] = MIX[grade];
  const k = 1.025; // loss factor
  const stone = grade === 100 ? 'V.DA46' : 'V.DA12';
  return [
    code,
    `${name}, đá ${grade === 100 ? '4x6' : '1x2'}, mác ${grade}`,
    'm3',
    'Bê tông',
    [
      ['V.XM40', +(xm * k).toFixed(2)],
      ['V.CATV', +(cat * k).toFixed(4)],
      [stone, +(da * k).toFixed(4)],
      ['V.NUOC', 0.195],
      ['N.3.5', labour],
      ['M.TRONBT250', 0.095],
      ...extra,
    ],
  ];
}

function rebar(code: string, name: string, dia: '10' | '18' | '18L', labour: number): N {
  const steel = dia === '10' ? 'V.THEP10' : dia === '18' ? 'V.THEP18' : 'V.THEP18L';
  const res: [string, number][] = [
    [steel, dia === '10' ? 1005 : 1020],
    ['V.DAYTHEP', dia === '10' ? 21.42 : 14.28],
    ['N.3.5', labour],
    ['M.CATUON', dia === '10' ? 0.4 : 0.32],
  ];
  if (dia !== '10') res.push(['V.QUEHAN', dia === '18' ? 4.64 : 5.3], ['M.HAN23', dia === '18' ? 1.1 : 1.3]);
  return [code, name, 'tấn', 'Cốt thép', res];
}

function formwork(code: string, name: string, labour: number): N {
  return [code, name, '100m2', 'Ván khuôn', [['V.GOVAN', 0.792], ['V.GODA', 0.5], ['V.DINH', 12], ['N.4.0', labour]]];
}

const VIBRO: [string, number][] = [['M.DAMDUI', 0.18]];
const LIFT: [string, number][] = [['M.DAMDUI', 0.18], ['M.VANTHANG', 0.11]];

export const SAMPLE_NORMS: N[] = [
  // Earthwork
  ['AB.11312', 'Đào móng băng bằng thủ công, rộng ≤3m, sâu ≤1m, đất cấp II', 'm3', 'Đất', [['N.3.0', 0.82]]],
  ['AB.25112', 'Đào móng công trình bằng máy đào ≤0,8m3, đất cấp II', '100m3', 'Đất', [['N.3.0', 5.5], ['M.DAO08', 0.35]]],
  ['AB.13112', 'Đắp đất nền móng công trình bằng thủ công, độ chặt K=0,90', 'm3', 'Đất', [['N.3.0', 0.56]]],
  ['AB.65120', 'Đắp đất nền móng bằng đầm cóc, độ chặt K=0,95', '100m3', 'Đất', [['N.3.0', 8.8], ['M.DAMCOC', 4.2]]],
  ['AB.13411', 'Đắp cát nền móng công trình', 'm3', 'Đất', [['V.CATSL', 1.22], ['N.3.0', 0.5]]],
  ['AB.41432', 'Vận chuyển đất bằng ô tô tự đổ 7T, phạm vi ≤1000m, đất cấp II', '100m3', 'Đất', [['M.OTO7', 0.83]]],
  // Piles
  ['AC.26122', 'Ép trước cọc BTCT 25x25cm, chiều dài đoạn cọc >4m, đất cấp I', '100m', 'Cọc', [['V.COC25', 101], ['N.3.5', 11], ['M.EPCOC150', 2.9], ['M.CAU10', 2.9]]],
  ['AC.29212', 'Nối cọc BTCT vuông 25x25cm', 'mối nối', 'Cọc', [['V.QUEHAN', 1.2], ['N.3.5', 0.36], ['M.HAN23', 0.2]]],
  // Concrete
  concrete('AF.11111', 'Bê tông lót móng, rộng ≤250cm', 100, 1.42, [['M.DAMBAN', 0.089]]),
  concrete('AF.11213', 'Bê tông móng, rộng ≤250cm', 250, 1.64, VIBRO),
  concrete('AF.11214', 'Bê tông móng, rộng ≤250cm', 300, 1.64, VIBRO),
  concrete('AF.12213', 'Bê tông cột, tiết diện ≤0,1m2, cao ≤6m', 250, 4.1, LIFT),
  concrete('AF.12214', 'Bê tông cột, tiết diện ≤0,1m2, cao ≤6m', 300, 4.1, LIFT),
  concrete('AF.12223', 'Bê tông cột, tiết diện >0,1m2, cao ≤6m', 250, 3.04, LIFT),
  concrete('AF.12224', 'Bê tông cột, tiết diện >0,1m2, cao ≤6m', 300, 3.04, LIFT),
  concrete('AF.12313', 'Bê tông xà dầm, giằng nhà', 250, 3.56, LIFT),
  concrete('AF.12314', 'Bê tông xà dầm, giằng nhà', 300, 3.56, LIFT),
  concrete('AF.12413', 'Bê tông sàn mái', 250, 2.48, [['M.DAMBAN', 0.089], ['M.VANTHANG', 0.11]]),
  concrete('AF.12414', 'Bê tông sàn mái', 300, 2.48, [['M.DAMBAN', 0.089], ['M.VANTHANG', 0.11]]),
  concrete('AF.12513', 'Bê tông lanh tô, ô văng, máng nước', 250, 4.25, LIFT),
  concrete('AF.12613', 'Bê tông cầu thang thường', 250, 3.98, LIFT),
  // Rebar
  rebar('AF.61110', 'Sản xuất, lắp dựng cốt thép móng, đường kính ≤10mm', '10', 11.32),
  rebar('AF.61120', 'Sản xuất, lắp dựng cốt thép móng, đường kính ≤18mm', '18', 8.34),
  rebar('AF.61130', 'Sản xuất, lắp dựng cốt thép móng, đường kính >18mm', '18L', 6.35),
  rebar('AF.61411', 'Sản xuất, lắp dựng cốt thép cột, trụ, đường kính ≤10mm, cao ≤6m', '10', 16.3),
  rebar('AF.61421', 'Sản xuất, lắp dựng cốt thép cột, trụ, đường kính ≤18mm, cao ≤6m', '18', 10.63),
  rebar('AF.61511', 'Sản xuất, lắp dựng cốt thép xà dầm, giằng, đường kính ≤10mm, cao ≤6m', '10', 17.52),
  rebar('AF.61521', 'Sản xuất, lắp dựng cốt thép xà dầm, giằng, đường kính ≤18mm, cao ≤6m', '18', 9.72),
  rebar('AF.61711', 'Sản xuất, lắp dựng cốt thép sàn mái, đường kính ≤10mm, cao ≤6m', '10', 14.63),
  // Formwork
  formwork('AF.81111', 'Ván khuôn gỗ móng', 13.75),
  formwork('AF.81132', 'Ván khuôn gỗ cột vuông, chữ nhật', 31.9),
  formwork('AF.81141', 'Ván khuôn gỗ xà dầm, giằng', 34.38),
  formwork('AF.81151', 'Ván khuôn gỗ sàn mái', 28.75),
  // Masonry
  ['AE.22214', 'Xây tường thẳng gạch đặc 6,5x10,5x22cm, dày ≤11cm, cao ≤6m, vữa XM mác 75', 'm3', 'Xây', [['V.GACHDAC', 643], ['V.XM40', 74], ['V.CATM', 0.25], ['V.NUOC', 0.06], ['N.3.5', 2.43], ['M.TRONVUA150', 0.036], ['M.VANTHANG', 0.04]]],
  ['AE.22224', 'Xây tường thẳng gạch đặc 6,5x10,5x22cm, dày ≤33cm, cao ≤6m, vữa XM mác 75', 'm3', 'Xây', [['V.GACHDAC', 550], ['V.XM40', 93], ['V.CATM', 0.32], ['V.NUOC', 0.075], ['N.3.5', 1.97], ['M.TRONVUA150', 0.045], ['M.VANTHANG', 0.04]]],
  ['AE.62214', 'Xây tường thẳng gạch rỗng 2 lỗ 6,5x10,5x22cm, dày ≤11cm, cao ≤6m, vữa XM mác 75', 'm3', 'Xây', [['V.GACHLO', 643], ['V.XM40', 66], ['V.CATM', 0.22], ['V.NUOC', 0.055], ['N.3.5', 2.2], ['M.TRONVUA150', 0.032], ['M.VANTHANG', 0.04]]],
  // Finishing
  ['AK.21124', 'Trát tường trong, dày 1,5cm, vữa XM mác 75', 'm2', 'Hoàn thiện', [['V.XM40', 5.6], ['V.CATM', 0.019], ['V.NUOC', 0.005], ['N.4.0', 0.2], ['M.TRONVUA150', 0.003]]],
  ['AK.21224', 'Trát tường ngoài, dày 1,5cm, vữa XM mác 75', 'm2', 'Hoàn thiện', [['V.XM40', 5.6], ['V.CATM', 0.019], ['V.NUOC', 0.005], ['N.4.0', 0.26], ['M.TRONVUA150', 0.003]]],
  ['AK.23114', 'Trát trần, vữa XM mác 75', 'm2', 'Hoàn thiện', [['V.XM40', 4.4], ['V.CATM', 0.015], ['V.NUOC', 0.004], ['N.4.0', 0.5], ['M.TRONVUA150', 0.003]]],
  ['AK.51260', 'Lát nền, sàn gạch ceramic 600x600mm, vữa XM mác 75', 'm2', 'Hoàn thiện', [['V.GACH60', 1.02], ['V.XM40', 8], ['V.CATM', 0.025], ['N.4.0', 0.17]]],
  ['AK.84114', 'Bả bột bả vào tường', 'm2', 'Hoàn thiện', [['V.BOTBA', 0.4], ['N.4.0', 0.17]]],
  ['AK.83421', 'Sơn tường trong nhà đã bả, 1 nước lót, 2 nước phủ', 'm2', 'Hoàn thiện', [['V.SONLOT', 0.12], ['V.SONPHU', 0.21], ['N.4.0', 0.066]]],
  ['AK.84424', 'Sơn tường ngoài nhà không bả, 1 nước lót, 2 nước phủ', 'm2', 'Hoàn thiện', [['V.SONLOT', 0.13], ['V.SONPHU', 0.23], ['N.4.0', 0.078]]],
];
