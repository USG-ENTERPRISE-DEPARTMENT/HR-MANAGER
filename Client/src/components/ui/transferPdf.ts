import api from '../../../lib/api';
import { toast } from 'sonner';

const dateOnly = (value: unknown) => value ? String(value).slice(0, 10) : '—';

async function blobErrorMessage(error: any): Promise<string> {
  const data = error.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.message || 'PDF export failed';
    } catch { /* use fallback */ }
  }
  return data?.message || error.message || 'PDF export failed';
}

/** Generate a branded, auditable PDF for one employee transfer record. */
export async function downloadTransferPdf(transfer: any): Promise<void> {
  const rows: (string | number)[][] = [
    ['Transfer', 'Transfer Number', transfer.transfer_number || '—', transfer.status || '—'],
    ['Employee', 'Employee', transfer.employee_name || `Employee ${transfer.employee}`, transfer.employee_code || '—'],
    ['Transfer', 'Transfer Type', transfer.transfer_type || '—', '—'],
    ['Transfer', 'Effective Date', dateOnly(transfer.effective_date), '—'],
    ['Transfer', 'Created Date', dateOnly(transfer.created_at), '—'],
  ];

  for (const change of transfer.changes ?? []) {
    rows.push(['Field Change', change.label || change.field, change.current || 'Not assigned', change.proposed || 'Not assigned']);
  }
  if (transfer.reason) rows.push(['Request', 'Reason', transfer.reason, '—']);
  if (transfer.supporting_document) rows.push(['Request', 'Supporting Document', transfer.supporting_document, '—']);
  if (transfer.rejected_reason) rows.push(['Decision', 'Rejection Reason', transfer.rejected_reason, 'Rejected']);
  if (transfer.cancelled_reason) rows.push(['Decision', 'Cancellation Reason', transfer.cancelled_reason, 'Cancelled']);

  for (const stage of transfer.stages ?? []) {
    const stageNumber = Number(stage.stage_order ?? 0) + 1;
    const detail = [stage.approver_label || 'Assigned approver', stage.acted_at ? `Acted ${dateOnly(stage.acted_at)}` : null, stage.comment].filter(Boolean).join(' · ');
    rows.push(['Approval', `${stageNumber}. ${stage.stage_name || 'Approval stage'}`, detail || '—', stage.status || 'Pending']);
  }

  try {
    const response = await api.post('/reports/table.pdf', {
      title: `Employee Transfer ${transfer.transfer_number || ''}`.trim(),
      subtitle: `${transfer.employee_name || 'Employee'}${transfer.employee_code ? ` (${transfer.employee_code})` : ''} · ${transfer.transfer_type || 'Employee Transfer'}`,
      headers: ['Section', 'Item', 'Previous Value / Details', 'New Value / Status'],
      rows,
      landscape: true,
    }, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const safeNumber = String(transfer.transfer_number || transfer.id || 'record').replace(/[^a-z0-9-]+/gi, '-');
    const link = Object.assign(document.createElement('a'), { href: url, download: `employee-transfer-${safeNumber}.pdf` });
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Transfer PDF downloaded');
  } catch (error: any) {
    toast.error(await blobErrorMessage(error));
  }
}
