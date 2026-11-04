import { CreditCard, Printer } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Card, Segmented } from '../design-system';
import {
  looksLikePos,
  paperCss,
  paperWidth,
  posActive,
  posMode,
  setPaperWidth,
  setPosMode,
  type PaperWidth,
  type PosMode,
} from '../lib/pos-device';

/**
 * Ajustes deste aparelho (ficam só nele, não no restaurante): modo maquininha e largura da
 * bobina da impressão pelo navegador.
 */
export function DeviceSettings() {
  const [mode, setMode] = useState<PosMode>(posMode);
  const [paper, setPaper] = useState<PaperWidth>(paperWidth);
  const detected = looksLikePos();
  const active = posActive(mode);

  function testPrint() {
    const css = paperCss(paper);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const line = '-'.repeat(42);
    const pre = doc.createElement('pre');
    pre.textContent = [
      'TESTE DE IMPRESSAO'.padStart(30),
      line,
      `Bobina: ${paper} mm`,
      '123456789012345678901234567890123456789012',
      'A linha de cima tem 42 colunas e deve',
      'caber inteira, sem cortar.',
      line,
    ].join('\n');
    const style = doc.createElement('style');
    style.textContent = `${css.page}body{margin:0}pre{font:${css.font}/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:pre;margin:0}`;
    doc.head.appendChild(style);
    doc.body.appendChild(pre);
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }

  return (
    <Card searchId="secao-aparelho" title="Este aparelho">
      <div className="device-settings">
        <p className="page-sub">
          Vale só para este aparelho. Use numa maquininha com Android e navegador (Sunmi, PAX,
          Gertec, Positivo, Ingenico) ou num tablet de balcão.
          {detected && <b> Este aparelho parece uma maquininha.</b>}
        </p>
        <div className="device-settings__row">
          <span className="cm-label">
            <CreditCard size={16} aria-hidden /> Modo maquininha
          </span>
          <Segmented
            label="Modo maquininha"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setPosMode(v);
              // Sem escolha de bobina salva, a largura acompanha o modo.
              setPaper(paperWidth());
            }}
            options={[
              { value: 'auto', label: 'Automático' },
              { value: 'on', label: 'Ligado' },
              { value: 'off', label: 'Desligado' },
            ]}
          />
          <small className="device-settings__hint">
            {active
              ? 'Ligado: botões e campos maiores para o dedo e telas mais leves.'
              : 'Desligado: visual normal.'}
          </small>
        </div>
        <div className="device-settings__row">
          <span className="cm-label">
            <Printer size={16} aria-hidden /> Bobina da impressão pelo navegador
          </span>
          <Segmented
            label="Largura da bobina"
            value={paper}
            onChange={(v) => {
              setPaper(v);
              setPaperWidth(v);
            }}
            options={[
              { value: '58', label: '58 mm (maquininha)' },
              { value: '80', label: '80 mm (caixa)' },
            ]}
          />
          <div>
            <Button variant="secondary" size="sm" icon={<Printer size={15} />} onClick={testPrint}>
              Imprimir teste
            </Button>
          </div>
        </div>
        <Alert tone="info">
          Pagamento com cartão: passe o cartão no app da maquininha e registre no Comandou como
          Crédito ou Débito. A cobrança automática, com o valor indo sozinho para a maquininha,
          ainda não está disponível.
        </Alert>
      </div>
    </Card>
  );
}
