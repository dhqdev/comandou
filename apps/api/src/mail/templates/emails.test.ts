import { describe, expect, it } from 'vitest';
import { customerResetEmail, passwordCodeEmail, paymentDueEmail } from './emails';
import { emailSamples } from './samples';

const ASSETS = 'https://comandou.com';

describe('e-mails do Comandou', () => {
  it('o código vem no começo do assunto e na prévia, numa caixa só', () => {
    const m = passwordCodeEmail({
      name: 'Marina Souza',
      code: '482915',
      minutes: 15,
      place: 'Fumaça Burger',
      assets: ASSETS,
    });
    expect(m.subject).toBe('482915 é o seu código do Comandou');
    const pre = /<div style="display:none[^>]*>([^<]*)/.exec(m.html)![1]!;
    expect(pre.startsWith('Código 482915 para criar uma nova senha em Fumaça Burger')).toBe(true);
    expect(m.html).toContain('>482915</div>');
    expect(m.html).toContain(`${ASSETS}/email/panda-codigo.png`);
    expect(m.text).toContain('\n482915\n');
  });

  it('não deixa HTML do nome da loja ou do cliente passar', () => {
    const m = customerResetEmail({
      restaurant: 'Bar <script>x</script>',
      customerName: '<b>Zé</b>',
      code: '123456',
      minutes: 15,
      assets: ASSETS,
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>Zé</b>');
    expect(m.html).toContain('Bar &lt;script&gt;');
  });

  it('lembrete de vencimento: hoje, amanhã ou em N dias', () => {
    const base = {
      restaurant: 'Fumaça',
      planUrl: 'https://f.comandou.com/plano',
      assets: ASSETS,
      amount: 'R$ 149,90',
      dueDate: '2026-11-20',
    };
    expect(paymentDueEmail({ ...base, daysLeft: 0 }).subject).toContain('vence hoje (20/11/2026)');
    expect(paymentDueEmail({ ...base, daysLeft: 1 }).subject).toContain('vence amanhã');
    const m = paymentDueEmail({ ...base, daysLeft: 3 });
    expect(m.subject).toContain('vence em 3 dias');
    // Sem link de pagamento, o botão leva para a tela Plano.
    expect(m.html).toContain('href="https://f.comandou.com/plano"');
  });

  it('todos os modelos montam, com texto puro e sem "undefined"', () => {
    const all = emailSamples(ASSETS, (s) => `https://${s}.comandou.com`);
    expect(all.length).toBeGreaterThanOrEqual(12);
    for (const s of all) {
      expect(s.mail.subject.length).toBeGreaterThan(5);
      expect(s.mail.text.length).toBeGreaterThan(20);
      expect(s.mail.html).toMatch(/^<!doctype html>/);
      for (const bad of ['undefined', 'null', 'NaN', '[object'])
        expect(`${s.id}: ${s.mail.html}${s.mail.text}`).not.toContain(bad);
    }
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });
});
