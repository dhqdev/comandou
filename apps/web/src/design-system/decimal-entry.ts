/**
 * Campos de valor (inputmode="decimal", ex.: "0,00"): ao entrar no campo, o cursor vai para
 * a parte antes da vírgula, já selecionada. Digitar 3 em "0,00" dá "3,00" (e não "0,003").
 * A vírgula (ou o ponto) pula para os centavos, também selecionados: "3" "," "5" "0" = "3,50".
 * Só mexe no cursor, nunca no texto, então serve para qualquer campo, controlado pelo React ou não.
 */

/** Posição da vírgula decimal: o último "," ou "." seguido só de dígitos. -1 se não houver. */
export function decimalSeparatorAt(value: string): number {
  const m = /[,.](?=\d*\s*$)/.exec(value);
  return m ? m.index : -1;
}

/** Trecho da parte inteira (os dígitos logo antes da vírgula). Null se não houver vírgula. */
export function integerRange(value: string): [number, number] | null {
  const sep = decimalSeparatorAt(value);
  if (sep < 0) return null;
  let start = sep;
  while (start > 0 && /[\d.]/.test(value[start - 1]!)) start--;
  return [start, sep];
}

/** Ao digitar a vírgula com o cursor antes dela: trecho dos centavos para selecionar. */
export function centsRange(
  value: string,
  selStart: number,
  selEnd: number,
): [number, number] | null {
  const sep = decimalSeparatorAt(value);
  if (sep < 0 || selEnd > sep || selStart > sep) return null;
  return [sep + 1, value.length];
}

function isDecimalInput(el: EventTarget | null): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    el.getAttribute('inputmode') === 'decimal' &&
    !el.readOnly &&
    !el.disabled &&
    (el.type === 'text' || el.type === '')
  );
}

let installed = false;

export function installDecimalEntry(doc: Document = document): void {
  if (installed) return;
  installed = true;

  // Campos que acabaram de ganhar foco e ainda não tiveram o cursor ajustado.
  const pending = new WeakSet<HTMLInputElement>();

  const placeCaret = (el: HTMLInputElement) => {
    if (!pending.has(el)) return;
    pending.delete(el);
    // Clique no meio do número: respeita onde a pessoa clicou. Cursor no começo ou no fim, ou tudo
    // selecionado (o normal ao entrar, pelo Tab, pelo foco automático ou clicando depois do último
    // zero): vai para a parte inteira.
    const v = el.value;
    const a = el.selectionStart ?? 0;
    const b = el.selectionEnd ?? 0;
    const atEdge = a === b && (a === 0 || a === v.length);
    if (!atEdge && !(a === 0 && b === v.length)) return;
    const r = integerRange(v) ?? (/^\s*0+\s*$/.test(v) ? [0, v.length] : null);
    if (!r) return;
    el.setSelectionRange(r[0], r[1]);
    auto.set(el, r);
  };

  // Seleção da parte inteira feita por aqui (e não pela pessoa). Colar ou preencher o valor
  // inteiro ("50,00") por cima dela troca o campo todo, e não só a parte antes da vírgula.
  const auto = new WeakMap<HTMLInputElement, [number, number]>();
  const stillAuto = (el: HTMLInputElement) => {
    const r = auto.get(el);
    return !!r && el.selectionStart === r[0] && el.selectionEnd === r[1];
  };
  const replaceAll = (el: HTMLInputElement, text: string) => {
    auto.delete(el);
    // Pelo "setter" nativo, para o React (campo controlado) ver a mudança no evento input.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (set) set.call(el, text);
    else el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  doc.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement) auto.delete(e.target);
  });
  doc.addEventListener('focusout', (e) => {
    if (e.target instanceof HTMLInputElement) auto.delete(e.target);
  });
  doc.addEventListener('paste', (e) => {
    const el = e.target;
    if (!isDecimalInput(el) || !stillAuto(el)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    replaceAll(el, text.trim());
  });

  // Entrou clicando: o cursor só assenta depois de soltar o botão (ou o dedo).
  let pointerOn: EventTarget | null = null;
  doc.addEventListener('pointerdown', (e) => {
    pointerOn = isDecimalInput(e.target) && doc.activeElement !== e.target ? e.target : null;
  });

  doc.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!isDecimalInput(el)) return;
    pending.add(el);
    // O navegador só põe o cursor depois do foco (e do clique); espera ele terminar.
    const run = () => {
      if (doc.activeElement === el) placeCaret(el);
    };
    if (pointerOn === el) {
      pointerOn = null;
      const up = () => {
        el.removeEventListener('pointerup', up);
        el.removeEventListener('blur', up);
        run();
        setTimeout(run, 0);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('blur', up);
    } else setTimeout(run, 0);
  });

  doc.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!isDecimalInput(el)) return;
    // Digitou antes do ajuste (muito rápido): ajusta agora, antes de a tecla entrar.
    if (/^[\d,.]$/.test(e.key)) placeCaret(el);
    if (e.key !== ',' && e.key !== '.') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = centsRange(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    if (!r) return;
    e.preventDefault();
    el.setSelectionRange(r[0], r[1]);
  });

  // Teclado do celular costuma não dizer a tecla no keydown: confere o texto que vai entrar.
  doc.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!isDecimalInput(el)) return;
    // Texto de uma vez (colar, preencher, sugestão do teclado) por cima da nossa seleção.
    const many = e.inputType === 'insertText' ? (e.data ?? '').length > 1 : true;
    if (many && e.inputType.startsWith('insert') && stillAuto(el)) {
      const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      if (text) {
        e.preventDefault();
        replaceAll(el, text.trim());
      }
      return;
    }
    if (e.inputType !== 'insertText') return;
    if (e.data && /^[\d,.]$/.test(e.data)) placeCaret(el);
    if (e.data !== ',' && e.data !== '.') return;
    const r = centsRange(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    if (!r) return;
    e.preventDefault();
    el.setSelectionRange(r[0], r[1]);
  });
}
