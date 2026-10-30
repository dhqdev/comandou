import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATIC_ENTRIES } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import { helpKey, type HelpDict } from '../../design-system/help-tip';
import * as fiscal from './fiscal-help';
import * as menu from './menu-help';

const dicts: [string, HelpDict][] = [
  ...Object.entries(menu).filter(([, v]) => typeof v === 'object'),
  ...Object.entries(fiscal).filter(([, v]) => typeof v === 'object'),
] as [string, HelpDict][];

const screens = new Set(STATIC_ENTRIES.filter((e) => e.to).map((e) => e.to!.split('?')[0]));

describe('ajuda dos campos', () => {
  it('todo link leva a uma tela que existe', () => {
    for (const [name, dict] of dicts)
      for (const [label, h] of Object.entries(dict))
        if (h.link)
          expect(screens.has(h.link.to.split('?')[0]), `${name} › ${label} → ${h.link.to}`).toBe(
            true,
          );
  });

  it('explicações curtas e sem chave repetida', () => {
    for (const [name, dict] of dicts) {
      const keys = Object.keys(dict).map(helpKey);
      expect(new Set(keys).size, name).toBe(keys.length);
      for (const [label, h] of Object.entries(dict)) {
        expect(h.text.length, `${name} › ${label}`).toBeGreaterThan(10);
        expect(h.text.length, `${name} › ${label}`).toBeLessThan(300);
      }
    }
  });

  it('"Código (opcional)" acha "Código"', () => {
    expect(helpKey('Código (opcional)')).toBe(helpKey('Código'));
    expect(helpKey('CST do IPI (NF-e)')).toBe('cst do ipi');
  });

  // Campo novo no Cardápio ou na Nota fiscal precisa de explicação (senão fica sem o "?").
  it('todo campo com rótulo fixo do Cardápio e da Nota fiscal tem explicação', () => {
    const files: [string, HelpDict][] = [
      ['pages/menu/ItemEditor.tsx', menu.ITEM_HELP],
      ['pages/menu/GroupsTab.tsx', menu.GROUP_HELP],
      ['pages/menu/FamiliesTab.tsx', menu.FAMILY_HELP],
      ['pages/menu/MenusTab.tsx', menu.MENUS_HELP],
      ['pages/menu/MenuEditor.tsx', menu.MENUS_HELP],
      ['pages/fiscal/SettingsSection.tsx', fiscal.FISCAL_HELP],
      ['features/FiscalCompanySetup.tsx', fiscal.FISCAL_HELP],
      ['pages/fiscal/RulesSection.tsx', fiscal.RULE_HELP],
      ['pages/fiscal/VoidsSection.tsx', fiscal.VOID_HELP],
      ['pages/fiscal/DocumentDetail.tsx', fiscal.DOC_HELP],
    ];
    const missing: string[] = [];
    for (const [file, dict] of files) {
      const src = readFileSync(join(process.cwd(), 'src', file), 'utf8');
      const keys = new Set(Object.keys(dict).map(helpKey));
      for (const m of src.matchAll(/<(?:TextField|SelectField|CheckField)\s[^>]*?label="([^"]+)"/g))
        if (!keys.has(helpKey(m[1]!))) missing.push(`${file}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
