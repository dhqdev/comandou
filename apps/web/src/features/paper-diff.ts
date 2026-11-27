/**
 * Linhas do papel novo que não estavam no antigo (mudaram ou entraram), para a prévia piscar só o
 * que a IA mexeu. Diferença por linhas (maior sequência comum), o mesmo jeito do "diff": linha
 * igual que só mudou de lugar por causa de uma linha nova acima não pisca.
 */
export function changedLines(before: string, after: string): number[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  if (before === after) return [];
  // Papel enorme (não acontece com bobina): pisca tudo em vez de travar a tela.
  if (a.length * b.length > 400_000) return b.map((_, i) => i);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
    else out.push(j++);
  }
  return out;
}
