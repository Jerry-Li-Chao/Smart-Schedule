import type { LegacySheet } from './importLegacy';

/** Read a downloaded .xlsx (Google Sheets → File → Download → Microsoft Excel), keeping cell colours. */
export async function readXlsx(file: File): Promise<LegacySheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { cellStyles: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'];
    if (!ref) return { name, header: [], cells: [], bgs: [] };
    const range = XLSX.utils.decode_range(ref);
    const rows: string[][] = [];
    const bgs: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      const bg: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as { w?: string; v?: unknown; s?: { patternType?: string; fgColor?: { rgb?: string } } } | undefined;
        row.push(cell ? String(cell.w ?? cell.v ?? '') : '');
        const rgb = cell?.s?.patternType && cell.s.patternType !== 'none' ? cell.s.fgColor?.rgb : undefined;
        bg.push(rgb ? `#${rgb.slice(-6).toLowerCase()}` : '#ffffff');
      }
      rows.push(row);
      bgs.push(bg);
    }
    return { name, header: rows[0] ?? [], cells: rows.slice(1), bgs: bgs.slice(1) };
  });
}
