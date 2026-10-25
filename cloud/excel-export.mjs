import ExcelJS from 'exceljs';
import { SERVICE_NAMES } from '../src/decode.mjs';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sheetNames = { YouTube: 'YouTube', Lovable: 'Lovable', Notion: 'Notion', NordVPN: 'Nord', Headspace: 'Headspace' };
const colors = { YouTube: 'FFEA7070', Lovable: 'FFAD91EA', Notion: 'FF99A6B5', NordVPN: 'FF579AEA', Headspace: 'FFF5A76B' };

export function exportFormat(value = 'txt') {
  if (!['txt', 'xlsx'].includes(value)) throw new Error('Choose TXT or Excel export.');
  return value;
}

// Indexes keep the frozen service grouping without storing every URL twice.
export function exportWorksheets(rows, urls) {
  const indexes = new Map(urls.map((url, index) => [url, index]));
  const groups = new Map(SERVICE_NAMES.map(service => [service, new Set()]));
  for (const row of rows) {
    if (!groups.has(row.service)) throw new Error('A saved link has an unsupported service.');
    groups.get(row.service).add(indexes.get(row.url));
  }
  return SERVICE_NAMES.filter(service => groups.get(service).size).map(service => ({ service, indexes: [...groups.get(service)] }));
}

export async function excelBuffer(snapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Link Grabber';
  workbook.created = new Date(snapshot.createdAt);
  workbook.modified = new Date(snapshot.createdAt);
  for (const group of snapshot.worksheets) {
    const name = sheetNames[group.service];
    if (!name || !group.indexes.length) throw new Error('Invalid export worksheet.');
    const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: colors[group.service] } }, views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [{ header: 'Link', key: 'link', width: 120 }];
    sheet.getColumn(1).numFmt = '@';
    sheet.getColumn(1).alignment = { vertical: 'middle', wrapText: false };
    const header = sheet.getRow(1);
    header.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF20364A' } };
    header.height = 24;
    for (const index of group.indexes) {
      if (!Number.isInteger(index) || typeof snapshot.urls[index] !== 'string') throw new Error('Invalid export link.');
      // Literal text preserves long URLs and avoids formula interpretation.
      const row = sheet.addRow([snapshot.urls[index]]);
      row.font = { name: 'Calibri', size: 11 };
      row.height = 20;
    }
    sheet.autoFilter = { from: 'A1', to: `A${sheet.rowCount}` };
  }
  if (!workbook.worksheets.length) throw new Error('No links match this export.');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function sendExcel(res, item, buffer) {
  res.writeHead(200, {
    'Content-Type': XLSX_MIME,
    'Content-Disposition': `attachment; filename="${item.filename}"`,
    'Content-Length': buffer.length,
    'X-Export-Id': item._id
  });
  res.end(buffer);
}
