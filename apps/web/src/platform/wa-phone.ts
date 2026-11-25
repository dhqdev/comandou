/** +55 11 91234-5678 (telefone só com dígitos, como vem do WhatsApp). */
export function formatPhone(d: string | null) {
  if (!d) return '';
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}
