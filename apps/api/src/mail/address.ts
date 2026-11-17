/** Endereços de e-mail e cabeçalhos: validar, formatar e limpar (sem injeção de cabeçalho). */

export interface Address {
  email: string;
  name?: string;
}

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export const isEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s);

export const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/** Valor de cabeçalho numa linha só: quebra de linha viraria um cabeçalho novo. */
export const cleanHeader = (s: string) => s.replace(/[\r\n\0]+/g, ' ').trim();

/** `"Nome" <a@b.com>` ou só o endereço. Aspas e barras do nome saem (não dá para escapar errado). */
export function formatAddress(a: Address): string {
  const name = cleanHeader(a.name ?? '')
    .replace(/["\\<>]/g, '')
    .trim();
  return name ? `"${name}" <${a.email}>` : a.email;
}

/** Message-ID sempre com < >; qualquer coisa fora do formato vira null. */
export function normalizeMessageId(v: string | null | undefined): string | null {
  const s = cleanHeader(v ?? '').replace(/^<|>$/g, '');
  if (!s || s.length > 990 || /[\s<>]/.test(s)) return null;
  return `<${s}>`;
}

/** "a@x.com, Fulano <b@y.com>" → lista sem repetidos; o que não for e-mail fica de fora. */
export function parseAddressList(raw: string): Address[] {
  const out: Address[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(.*)<([^<>]+)>\s*$/.exec(p);
    const email = (m ? m[2]! : p).trim().toLowerCase();
    const name = m
      ? cleanHeader(m[1]!)
          .replace(/^["']|["']$/g, '')
          .trim()
      : '';
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(name ? { email, name: name.slice(0, 120) } : { email });
  }
  return out;
}

/** Remove repetidos (sem diferenciar maiúsculas) mantendo a ordem. */
export function uniqueAddresses(list: Address[], skip: string[] = []): Address[] {
  const seen = new Set(skip.map((s) => s.toLowerCase()));
  return list.filter((a) => {
    const k = a.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
