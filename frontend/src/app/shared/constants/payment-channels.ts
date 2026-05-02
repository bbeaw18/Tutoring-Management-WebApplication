/**
 * รายการช่องทางรับเงิน (Payment Channels)
 *  - value : key ที่บันทึกใน DB (stable, lowercase)
 *  - label : ป้ายชื่อที่แสดงใน UI
 *  - group : หมวดสำหรับ grouping ใน <select>
 */
export interface PaymentChannelOption {
  value: string;
  label: string;
  group: string;
}

export const PAYMENT_CHANNELS: PaymentChannelOption[] = [

  // ── ธนาคารพาณิชย์ไทย (Thai Commercial Banks) ─────────────
  { value: 'bbl',     label: 'Bangkok Bank',                   group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'ktb',     label: 'Krungthai Bank',                 group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'bay',     label: 'Krungsri',                       group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'kbank',   label: 'KBank',                          group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'kkp',     label: 'KKP',                            group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'cimbt',   label: 'CIMB Thai',                      group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'ttb',     label: 'ttb',                            group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'tisco',   label: 'TISCO Bank',                     group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'scb',     label: 'SCB',                            group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'uob',     label: 'UOB Thailand',                   group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'lhb',     label: 'LH Bank',                        group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'sct',     label: 'Standard Chartered Thailand',    group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'icbct',   label: 'ICBC Thai',                      group: 'ธนาคารพาณิชย์ไทย' },
  { value: 'tcd',     label: 'Thai Credit Bank',               group: 'ธนาคารพาณิชย์ไทย' },

  // ── ธนาคารต่างประเทศที่มีสาขาในไทย (Foreign Banks in Thailand) ──
  { value: 'smtbt',   label: 'Sumitomo Mitsui Trust Bank Thailand', group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'micbc',   label: 'Mega ICBC Thailand',                  group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'boct',    label: 'Bank of China Thailand',              group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'jpm',     label: 'J.P. Morgan',                          group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'citi',    label: 'Citibank',                             group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'smbc',    label: 'SMBC',                                 group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'db',      label: 'Deutsche Bank',                        group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'bnp',     label: 'BNP Paribas',                          group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'mizuho',  label: 'Mizuho Bank',                          group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'boa',     label: 'Bank of America',                      group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'rhb',     label: 'RHB Bank',                             group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'iob',     label: 'Indian Overseas Bank',                 group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'ocbc',    label: 'OCBC',                                 group: 'ธนาคารต่างประเทศในไทย' },
  { value: 'hsbc',    label: 'HSBC',                                 group: 'ธนาคารต่างประเทศในไทย' },

  // ── ธนาคารเฉพาะกิจของรัฐ (Specialized State Banks) ───────────
  { value: 'gsb',     label: 'GSB',             group: 'ธนาคารเฉพาะกิจของรัฐ' },
  { value: 'baac',    label: 'BAAC',            group: 'ธนาคารเฉพาะกิจของรัฐ' },
  { value: 'ghb',     label: 'GHB',             group: 'ธนาคารเฉพาะกิจของรัฐ' },
  { value: 'exim',    label: 'EXIM Thailand',   group: 'ธนาคารเฉพาะกิจของรัฐ' },
  { value: 'smedb',   label: 'SME D Bank',      group: 'ธนาคารเฉพาะกิจของรัฐ' },
  { value: 'ibank',   label: 'iBank',           group: 'ธนาคารเฉพาะกิจของรัฐ' }
];

/** ดึง label จาก value (fallback คืน value เดิมถ้าไม่เจอ) */
export function getPaymentChannelLabel(value?: string | null): string {
  if (!value) return '';
  const found = PAYMENT_CHANNELS.find(c => c.value === value);
  return found ? found.label : value;
}

/** จัดกลุ่มสำหรับใช้ใน <optgroup> */
export function getPaymentChannelGroups(): { group: string; items: PaymentChannelOption[] }[] {
  const map = new Map<string, PaymentChannelOption[]>();
  for (const opt of PAYMENT_CHANNELS) {
    if (!map.has(opt.group)) map.set(opt.group, []);
    map.get(opt.group)!.push(opt);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}
