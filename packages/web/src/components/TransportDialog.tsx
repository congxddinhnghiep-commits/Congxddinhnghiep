import { useEffect, useState } from 'react';
import { api, type PriceRow, type TransportLegDTO } from '../api';
import { money } from '../format';
import { Modal } from './Modal';

const blank = (): TransportLegDTO => ({ fromLocation: '', toLocation: 'Công trình', roadClass: '', distance: 0, freightRate: 0, loadFactor: 1, weightFactor: 1, handling: 0, toll: 0 });
const amount = (l: TransportLegDTO) => l.distance * l.freightRate * l.weightFactor * l.loadFactor + l.handling + l.toll;

/** Giá đến công trình = giá nguồn + cước + bốc dỡ + phí; not added when the source already includes transport. */
export function TransportDialog({ projectId, resource, onClose, onSaved }: { projectId: number; resource: PriceRow; onClose: () => void; onSaved: () => void }) {
  const [legs, setLegs] = useState<TransportLegDTO[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api.transport(projectId).then((t) => setLegs(t[resource.code] ?? []));
  }, [projectId, resource.code]);
  const upd = (i: number, k: keyof TransportLegDTO, v: string) =>
    setLegs(legs.map((l, j) => (j === i ? { ...l, [k]: ['fromLocation', 'toLocation', 'roadClass', 'note'].includes(k) ? v : Number(v.replace(',', '.')) || 0 } : l)));
  const save = async () => {
    setError('');
    try {
      await api.saveTransport(projectId, resource.code, legs);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const total = legs.reduce((a, l) => a + amount(l), 0);
  const included = resource.source?.kind === 'manual' || resource.source?.notes?.some((n) => /đã gồm vận chuyển/.test(n));
  return (
    <Modal title={`Vận chuyển đến công trình – ${resource.code} ${resource.name} (${resource.unit})`} onClose={onClose} wide>
      <p className="hint">
        Tiền vận chuyển / {resource.unit} = cự ly × cước (đ/t.km) × trọng lượng (t/{resource.unit}) × hệ số + bốc dỡ + phí. Không cộng khi nguồn giá đã gồm vận
        chuyển (giá nhập tay coi là giá đến công trình; bộ giá ghi “đã gồm vận chuyển”).
      </p>
      {included && <p className="warn-box">Nguồn giá hiện tại đã gồm vận chuyển – các chặng dưới đây sẽ KHÔNG được cộng (tránh tính 2 lần).</p>}
      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Từ</th>
              <th>Đến</th>
              <th>Loại đường</th>
              <th className="num">Cự ly (km)</th>
              <th className="num">Cước (đ/t.km)</th>
              <th className="num">T/{resource.unit}</th>
              <th className="num">Hệ số</th>
              <th className="num">Bốc dỡ</th>
              <th className="num">Phí</th>
              <th className="num">Thành tiền</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {legs.map((l, i) => (
              <tr key={i}>
                {(['fromLocation', 'toLocation', 'roadClass'] as const).map((k) => (
                  <td key={k}>
                    <input value={String(l[k] ?? '')} onChange={(e) => upd(i, k, e.target.value)} />
                  </td>
                ))}
                {(['distance', 'freightRate', 'weightFactor', 'loadFactor', 'handling', 'toll'] as const).map((k) => (
                  <td key={k}>
                    <input className="num" style={{ width: 80 }} value={String(l[k])} onChange={(e) => upd(i, k, e.target.value)} />
                  </td>
                ))}
                <td className="num">{money(amount(l))}</td>
                <td>
                  <button className="icon" onClick={() => setLegs(legs.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <button onClick={() => setLegs([...legs, blank()])}>+ Thêm chặng</button>
        <span>
          <b>Cộng vận chuyển: {money(total)} đ/{resource.unit}</b>{' '}
          <button className="primary" onClick={save}>
            Lưu
          </button>
        </span>
      </div>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}
