import { describe, expect, it } from 'vitest';
import { emptyRecords, type Patient, type Records } from '../src/domain/model';
import { searchPatientHistory } from '../src/domain/patient-search';

const date = '2026-11-24';
const ruya: Patient = {
  id: 'ruya', name: 'RÜYA ŞAHİN', phone: '+1 (202) 555-0150', email: 'ruya@example.test',
  status: 'Active', priority: 'Normal', priorityNote: '', createdOn: date, summary: '', nextAction: '',
};
const nora: Patient = {
  ...ruya, id: 'nora', name: 'NORA VALE', phone: '', email: '', status: 'Passive', priority: 'Urgent',
};
const records: Records = {
  ...emptyRecords(),
  patients: [ruya, nora],
  notes: [
    { id: 'ruya-note', patientId: ruya.id, appointmentId: null, date, type: 'Clinical visit', title: 'İlk görüşme',
      body: `${'Önceki görüşmeden satır. '.repeat(15)} İMPLANT ŞAFTI kontrol edildi. ${'Diğer bilgiler. '.repeat(10)}`,
      nextPlan: 'Renk seçimini planla.' },
    { id: 'nora-note', patientId: nora.id, appointmentId: null, date, type: 'Clinical visit', title: 'Klinik notu',
      body: 'Diş ölçüsü kaydedildi.', nextPlan: 'Kaplama hazırlanacak.' },
    { id: 'nora-other-note', patientId: nora.id, appointmentId: null, date, type: 'Other', title: 'Telefon notu',
      body: 'Renk kartı hazırlandı.', nextPlan: '' },
  ],
};

describe('patient history search', () => {
  it('finds note body and next plan in the same record, with Turkish-folded search and a compact original excerpt', () => {
    const [group] = searchPatientHistory(records, 'implant safti secimini');
    expect(group.patient).toBe(ruya);
    expect(group.patientMatch).toBe(false);
    expect(group.hits).toHaveLength(1);
    const [hit] = group.hits;
    expect(hit).toMatchObject({ id: 'ruya-note', title: 'İlk görüşme', kind: 'note', date });
    expect(hit.excerpt.filter(part => part.highlighted).map(part => part.text).join(' ')).toBe('İMPLANT ŞAFTI');
    expect(hit.excerpt.map(part => part.text).join('')).toMatch(/^….*kontrol edildi\..*…$/);
    expect(hit.excerpt.map(part => part.text).join('').length).toBeLessThan(130);
  });

  it('allows a patient name to narrow a linked result and keeps unrelated notes separate', () => {
    const [result] = searchPatientHistory(records, 'nora dis olcusu');
    expect(result.patient).toBe(nora);
    expect(result.patientNameParts).toEqual([{ text: 'NORA', highlighted: true }, { text: ' VALE', highlighted: false }]);
    expect(result.hits.map(hit => hit.id)).toEqual(['nora-note']);
    expect(searchPatientHistory(records, 'nora olcusu karti')).toEqual([]);
    expect(searchPatientHistory(records, 'dis olcusu', 'Active')).toEqual([]);
    expect(searchPatientHistory(records, 'dis olcusu', 'All', 'Normal')).toEqual([]);
  });

  it('retains name, unformatted-phone and email matching with readable highlights', () => {
    const results = searchPatientHistory(records, 'ruya 2025550150');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ patient: ruya, patientMatch: true, hits: [] });
    expect(results[0].contactMatch?.filter(part => part.highlighted)).toEqual([{ text: '202) 555-0150', highlighted: true }]);
    expect(searchPatientHistory(records, 'example.test')[0].contactMatch?.filter(part => part.highlighted)).toEqual([
      { text: 'example.test', highlighted: true },
    ]);
  });

  it('finds linked memory, preparation, closure, follow-up, task and alert text', () => {
    const linked: Records = {
      ...records,
      patients: [{ ...ruya, summary: 'Ortak. Hassasiyet izle.' }, nora],
      appointments: [{ id: 'visit', patientId: ruya.id, kind: 'Visit', status: 'Scheduled', title: 'Kontrol', date,
        start: '10:00', end: '10:30', notes: 'Ortak. Ölçü kaşığı hazırla.', procedure: 'Prova', exceptions: [] }],
      treatments: [{ id: 'treatment', patientId: ruya.id, status: 'Closed', title: 'Tedavi', startedOn: date, closedOn: date,
        closureNote: 'Ortak. Geçici protez çıkarıldı.' }],
      waits: [{ id: 'wait', patientId: ruya.id, title: 'Yanıt', type: 'Laboratory return', status: 'Waiting', startedOn: date,
        reviewOn: date, endedOn: null, blocks: false, notes: 'Ortak. Laboratuvarı ara.' }],
      tasks: [
        { id: 'task', patientId: ruya.id, title: 'Görev', notes: 'Ortak. Materyal sipariş et.', completedOn: null, blocks: false },
        { id: 'unlinked', patientId: null, title: 'Görev', notes: 'Ortak. Depoyu say.', completedOn: null, blocks: false },
      ],
      alerts: [{ id: 'alert', patientId: ruya.id, type: 'Allergy', label: 'Uyarı', severity: 'Caution', active: false,
        notes: 'Ortak. Lateks kullanma.' }],
    };
    const groups = searchPatientHistory(linked, 'ortak');
    expect(groups.map(group => group.patient.id)).toEqual([ruya.id]);
    expect(groups[0].hits.map(hit => hit.kind).sort()).toEqual(['alert', 'appointment', 'follow-up', 'patient', 'task', 'treatment']);
    expect(groups[0].hits.every(hit => hit.excerpt.some(part => part.highlighted))).toBe(true);
    expect(searchPatientHistory(linked, 'prova')[0].hits[0].id).toBe('visit');
    expect(searchPatientHistory(linked, 'depoyu')).toEqual([]);
  });

  it('maps overlapping matches, case expansions and decomposed accents to whole original characters', () => {
    const mixed: Records = {
      ...records,
      notes: [{ ...records.notes[0], title: 'Straße ve S\u0327aft', body: 'Açıklama', nextPlan: '' }],
    };
    const [group] = searchPatientHistory(mixed, 'strasse rasse saft');
    expect(group.hits[0].titleParts).toEqual([
      { text: 'Straße', highlighted: true }, { text: ' ve ', highlighted: false }, { text: 'S\u0327aft', highlighted: true },
    ]);
  });
});
