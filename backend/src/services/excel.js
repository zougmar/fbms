const ExcelJS = require('exceljs');

function styleHeader(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
}

async function workbookBuffer(title, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FBMS';
  const sheet = workbook.addWorksheet(title.slice(0, 31) || 'FBMS');
  sheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(14, column.label.length + 4)
  }));
  rows.forEach((row) => {
    const shaped = {};
    columns.forEach((column) => {
      let value = row[column.key];
      if (column.format === 'date' && value) value = new Date(value);
      if (column.format === 'money' || column.format === 'number') value = value === '' || value === null || value === undefined ? null : Number(value);
      shaped[column.key] = value;
    });
    sheet.addRow(shaped);
  });
  columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    if (column.format === 'money') excelColumn.numFmt = '#,##0.00 "MAD"';
    if (column.format === 'date') excelColumn.numFmt = 'dd/mm/yyyy';
    if (column.format === 'number') excelColumn.numFmt = '#,##0';
  });
  if (rows.length) {
    const totalRow = {};
    columns.forEach((column, index) => {
      if (index === 0) totalRow[column.key] = 'TOTAL';
      else if (column.format === 'money' || column.format === 'number') {
        totalRow[column.key] = rows.reduce((sum, row) => sum + (Number(row[column.key]) || 0), 0);
      }
    });
    const added = sheet.addRow(totalRow);
    added.font = { bold: true };
  }
  styleHeader(sheet);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook.xlsx.writeBuffer();
}

function csvBuffer(columns, rows) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [columns.map((column) => escape(column.label)).join(';')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => escape(row[column.key])).join(';'));
  });
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
}

module.exports = { workbookBuffer, csvBuffer };
