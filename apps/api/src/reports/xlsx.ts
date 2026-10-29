import { deflateRawSync } from 'node:zlib';

/**
 * Gerador de planilhas .xlsx (Office Open XML) sem dependências: estilos, células mescladas,
 * painel congelado, filtro, barras de dados, escala de cor e gráficos nativos do Excel
 * (colunas, barras, linhas e rosca). O arquivo abre no Excel, LibreOffice e Google Planilhas.
 */

export type CellValue = string | number | boolean | null | undefined | XDate;

/** Data/hora local (sem fuso), gravada como número de série do Excel. */
export class XDate {
  constructor(public readonly iso: string) {}
  serial(): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(this.iso);
    if (!m) return 0;
    const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    return ms / 86_400_000 + 25569;
  }
}

export interface StyleSpec {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string; // RRGGBB
  fill?: string; // RRGGBB
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  indent?: number;
  /** Borda: linha fina embaixo (bottom), em cima (top) ou caixa (box). */
  border?: 'bottom' | 'top' | 'box' | 'bottomStrong';
  borderColor?: string;
}

export interface Cell {
  v: CellValue;
  s?: number;
}

export type ChartKind = 'column' | 'bar' | 'line' | 'doughnut';

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  /** Faixa das categorias e de cada série, em linhas/colunas da própria aba (base 0). */
  cats: { col: number; from: number; to: number };
  series: { name: string; col: number; color: string }[];
  numFmt?: string;
  /** Posição: canto superior esquerdo e inferior direito (colunas/linhas base 0). */
  at: { col: number; row: number; toCol: number; toRow: number };
  palette?: string[];
}

export interface SheetSpec {
  name: string;
  rows: (Cell | null)[][];
  cols?: number[];
  rowHeights?: Record<number, number>;
  merges?: string[];
  /** Congela as linhas acima desta (base 0) e as colunas antes desta. */
  freeze?: { row: number; col?: number };
  autoFilter?: string;
  dataBars?: { ref: string; color: string }[];
  colorScales?: { ref: string; from: string; to: string }[];
  charts?: ChartSpec[];
  tabColor?: string;
  showGrid?: boolean;
  landscape?: boolean;
}

/* ---------------- utilidades ---------------- */

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de controle não são válidos em XML.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const ref = (col: number, row: number) => `${colName(col)}${row + 1}`;
export const range = (c1: number, r1: number, c2: number, r2: number) =>
  `${ref(c1, r1)}:${ref(c2, r2)}`;
const absRange = (sheet: string, c1: number, r1: number, c2: number, r2: number) =>
  `'${sheet.replace(/'/g, "''")}'!$${colName(c1)}$${r1 + 1}:$${colName(c2)}$${r2 + 1}`;

/** Nome de aba válido: até 31 caracteres, sem []:*?/\ e único no arquivo. */
export function sheetName(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Planilha';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/* ---------------- estilos ---------------- */

export class Styles {
  private fonts: string[] = ['<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>'];
  private fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  private borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private numFmts: string[] = [];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private cache = new Map<string, number>();
  private dxfs: string[] = [];

  constructor(private readonly baseFont = 'Calibri') {
    this.fonts[0] = `<font><sz val="10"/><color rgb="FF27272B"/><name val="${baseFont}"/><family val="2"/></font>`;
  }

  private add(list: string[], xml: string) {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  style(s: StyleSpec): number {
    const key = JSON.stringify(s);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const font = this.add(
      this.fonts,
      `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 10}"/><color rgb="FF${s.color ?? '27272B'}"/><name val="${this.baseFont}"/><family val="2"/></font>`,
    );
    const fill = s.fill
      ? this.add(
          this.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const bc = `<color rgb="FF${s.borderColor ?? 'E3E3E6'}"/>`;
    const line = (side: string, on: boolean, kind = 'thin') =>
      on ? `<${side} style="${kind}">${bc}</${side}>` : `<${side}/>`;
    const border = s.border
      ? this.add(
          this.borders,
          `<border>${line('left', s.border === 'box')}${line('right', s.border === 'box')}${line('top', s.border === 'box' || s.border === 'top', s.border === 'top' ? 'medium' : 'thin')}${line('bottom', s.border !== 'top', s.border === 'bottomStrong' ? 'medium' : 'thin')}<diagonal/></border>`,
        )
      : 0;
    let numFmt = 0;
    if (s.numFmt) {
      const builtin: Record<string, number> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4 };
      if (builtin[s.numFmt] !== undefined) numFmt = builtin[s.numFmt]!;
      else {
        const i = this.numFmts.indexOf(s.numFmt);
        numFmt = 164 + (i >= 0 ? i : this.numFmts.push(s.numFmt) - 1);
      }
    }
    const align =
      s.align || s.valign || s.wrap || s.indent
        ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''} vertical="${s.valign ?? 'center'}"${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>`
        : '<alignment vertical="center"/>';
    this.xfs.push(
      `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="${fill ? 1 : 0}" applyBorder="${border ? 1 : 0}" applyNumberFormat="${numFmt ? 1 : 0}" applyAlignment="1">${align}</xf>`,
    );
    const id = this.xfs.length - 1;
    this.cache.set(key, id);
    return id;
  }

  xml(): string {
    const nf = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>`
      : '';
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf}` +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs>` +
      `</styleSheet>`
    );
  }
}

/* ---------------- planilha ---------------- */

function cellXml(c: Cell, r: number, col: number): string {
  const at = ref(col, r);
  const s = c.s ? ` s="${c.s}"` : '';
  const v = c.v;
  if (v === null || v === undefined || v === '') return c.s ? `<c r="${at}"${s}/>` : '';
  if (v instanceof XDate) return `<c r="${at}"${s}><v>${v.serial()}</v></c>`;
  if (typeof v === 'number')
    return Number.isFinite(v) ? `<c r="${at}"${s}><v>${v}</v></c>` : `<c r="${at}"${s}/>`;
  if (typeof v === 'boolean') return `<c r="${at}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  // Texto que começa com = vira texto mesmo (nunca fórmula: evita injeção de fórmula).
  return `<c r="${at}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sh: SheetSpec, drawingRid: string | null): string {
  const maxCol = Math.max(1, ...sh.rows.map((r) => r.length));
  const dim = sh.rows.length ? range(0, 0, maxCol - 1, Math.max(0, sh.rows.length - 1)) : 'A1';
  const pane = sh.freeze
    ? (() => {
        const col = sh.freeze.col ?? 0;
        const row = sh.freeze.row;
        const pn = col && row ? 'bottomRight' : row ? 'bottomLeft' : 'topRight';
        return `<pane${col ? ` xSplit="${col}"` : ''}${row ? ` ySplit="${row}"` : ''} topLeftCell="${ref(col, row)}" activePane="${pn}" state="frozen"/><selection pane="${pn}" activeCell="${ref(col, row)}" sqref="${ref(col, row)}"/>`;
      })()
    : '';
  const views = `<sheetViews><sheetView workbookViewId="0"${sh.showGrid === false ? ' showGridLines="0"' : ''} zoomScale="100">${pane}</sheetView></sheetViews>`;
  const cols = sh.cols?.length
    ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = sh.rows
    .map((row, r) => {
      const h = sh.rowHeights?.[r];
      const cells = row.map((c, i) => (c ? cellXml(c, r, i) : '')).join('');
      if (!cells && !h) return '';
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const merges = sh.merges?.length
    ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  let prio = 1;
  const cf = [
    ...(sh.dataBars ?? []).map(
      (d) =>
        `<conditionalFormatting sqref="${d.ref}"><cfRule type="dataBar" priority="${prio++}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${d.color}"/></dataBar></cfRule></conditionalFormatting>`,
    ),
    ...(sh.colorScales ?? []).map(
      (d) =>
        `<conditionalFormatting sqref="${d.ref}"><cfRule type="colorScale" priority="${prio++}"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FF${d.from}"/><color rgb="FF${d.to}"/></colorScale></cfRule></conditionalFormatting>`,
    ),
  ].join('');
  const filter = sh.autoFilter ? `<autoFilter ref="${sh.autoFilter}"/>` : '';
  const props = `<sheetPr>${sh.tabColor ? `<tabColor rgb="FF${sh.tabColor}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `${props}<dimension ref="${dim}"/>${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>` +
    `${filter}${merges}${cf}` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
    `${drawingRid ? `<drawing r:id="${drawingRid}"/>` : ''}</worksheet>`
  );
}

/* ---------------- gráficos ---------------- */

function chartXml(sheet: string, c: ChartSpec): string {
  const cat = absRange(sheet, c.cats.col, c.cats.from, c.cats.col, c.cats.to);
  const fmt = esc(c.numFmt ?? 'General');
  const txt = (s: string, size = 1200, bold = true, color = '27272B') =>
    `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="pt-BR" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(s)}</a:t></a:r></a:p></c:rich></c:tx>`;
  const axisText = `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="5D5D65"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>`;
  const ser = (s: ChartSpec['series'][number], i: number) => {
    const val = absRange(sheet, s.col, c.cats.from, s.col, c.cats.to);
    const nameRef = absRange(sheet, s.col, c.cats.from - 1, s.col, c.cats.from - 1);
    const sp =
      c.kind === 'line'
        ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${i > 0 ? '<a:prstDash val="sysDash"/>' : ''}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
        : c.kind === 'doughnut'
          ? `<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>`
          : `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`;
    const points =
      c.kind === 'doughnut'
        ? Array.from({ length: c.cats.to - c.cats.from + 1 }, (_, p) => {
            const pal = c.palette ?? [s.color];
            return `<c:dPt><c:idx val="${p}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${pal[p % pal.length]}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`;
          }).join('')
        : '';
    const labels =
      c.kind === 'doughnut'
        ? `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`
        : '';
    return (
      `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${nameRef}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
      `${sp}${points}${labels}<c:cat><c:strRef><c:f>${cat}</c:f></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>${val}</c:f></c:numRef></c:val>${c.kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`
    );
  };
  const series = c.series.map(ser).join('');
  const axes =
    `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${c.kind === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${c.kind === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="CBCBD0"/></a:solidFill></a:ln></c:spPr>${axisText}<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${c.kind === 'bar' ? 't' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="EFEFF1"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${axisText}<c:crossAx val="5001"/><c:crosses val="${c.kind === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  const plot =
    c.kind === 'doughnut'
      ? `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="58"/></c:doughnutChart>`
      : c.kind === 'line'
        ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>${axes}`
        : `<c:barChart><c:barDir val="${c.kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="${c.kind === 'bar' ? 45 : 60}"/><c:overlap val="-10"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>${axes}`;
  const legend =
    c.series.length > 1 || c.kind === 'doughnut'
      ? `<c:legend><c:legendPos val="${c.kind === 'doughnut' ? 'r' : 'b'}"/><c:overlay val="0"/>${axisText}</c:legend>`
      : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:lang val="pt-BR"/><c:roundedCorners val="0"/><c:chart><c:title>${txt(c.title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>${plot}<c:spPr><a:noFill/></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="E3E3E6"/></a:solidFill></a:ln></c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>` +
    `</c:chartSpace>`
  );
}

function drawingXml(charts: { spec: ChartSpec; rid: string }[]): string {
  const anchors = charts
    .map(
      ({ spec, rid }, i) =>
        `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${spec.at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${spec.at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${spec.at.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${spec.at.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
        `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`
  );
}

/* ---------------- zip ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: string | Buffer }[], when = new Date()): Buffer {
  const dosTime =
    (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const dosDate =
    ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const comp = deflateRawSync(raw, { level: 6 });
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/* ---------------- pasta de trabalho ---------------- */

export function buildWorkbook(
  sheets: SheetSpec[],
  styles: Styles,
  meta: { title: string; author?: string; created?: Date },
): Buffer {
  const files: { name: string; data: string }[] = [];
  const created = (meta.created ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  let chartNo = 0;
  let drawingNo = 0;
  const overrides: string[] = [];
  sheets.forEach((sh, i) => {
    const n = i + 1;
    let drawingRid: string | null = null;
    if (sh.charts?.length) {
      drawingNo++;
      drawingRid = 'rId1';
      const rels: string[] = [];
      const placed = sh.charts.map((spec, k) => {
        chartNo++;
        files.push({ name: `xl/charts/chart${chartNo}.xml`, data: chartXml(sh.name, spec) });
        overrides.push(
          `<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        );
        rels.push(
          `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`,
        );
        return { spec, rid: `rId${k + 1}` };
      });
      files.push({ name: `xl/drawings/drawing${drawingNo}.xml`, data: drawingXml(placed) });
      files.push({
        name: `xl/drawings/_rels/drawing${drawingNo}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
      });
      files.push({
        name: `xl/worksheets/_rels/sheet${n}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`,
      });
      overrides.push(
        `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      );
    }
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml(sh, drawingRid) });
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  });

  const definedNames = sheets
    .map((sh, i) =>
      sh.autoFilter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${sh.name.replace(/'/g, "''")}'!${sh.autoFilter
            .split(':')
            .map((r) => r.replace(/([A-Z]+)(\d+)/, '$$$1$$$2'))
            .join(':')}</definedName>`
        : '',
    )
    .join('');

  files.unshift(
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
        `${overrides.join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.author ?? 'Comandou')}</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Comandou</Application></Properties>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>` +
        `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: styles.xml() },
  );
  return zip(files, meta.created);
}
