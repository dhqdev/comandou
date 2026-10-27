import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { SlideTabs } from '../features/SlideTabs';
import { FamiliesTab } from './menu/FamiliesTab';
import { GroupsTab } from './menu/GroupsTab';
import { ItemEditor } from './menu/ItemEditor';
import { ItemsTab } from './menu/ItemsTab';
import { MenuEditor } from './menu/MenuEditor';
import { MenusTab } from './menu/MenusTab';
import './menu/menu.css';

type Section = 'itens' | 'familias' | 'complementos' | 'cardapios';
const SECTIONS: { value: Section; label: string; sub: string }[] = [
  {
    value: 'itens',
    label: 'Itens',
    sub: 'Categorias e itens que aparecem no PDV, no garçom e no cardápio online.',
  },
  {
    value: 'familias',
    label: 'Famílias',
    sub: 'Agrupam as vendas nos relatórios, independente da categoria.',
  },
  {
    value: 'complementos',
    label: 'Complementos',
    sub: 'Grupos de adicionais, tamanhos, sabores e ingredientes para retirar.',
  },
  {
    value: 'cardapios',
    label: 'Cardápios',
    sub: 'Quais itens e preços valem no salão e no delivery.',
  },
];

/** Cardápio: itens, famílias, grupos de complementos e os cardápios (Principal e Delivery). */
export function MenuPage() {
  return (
    <Routes>
      <Route path="itens/:id" element={<ItemEditor />} />
      <Route path="cardapios/:id" element={<MenuEditor />} />
      <Route path="*" element={<MenuSections />} />
    </Routes>
  );
}

function MenuSections() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const seg = pathname.split('/')[2] as Section | undefined;
  const current = SECTIONS.find((s) => s.value === seg) ?? SECTIONS[0]!;
  return (
    <>
      <div className="mn-head">
        <div>
          <h1 className="page-title">Cardápio</h1>
          <p className="page-sub">{current.sub}</p>
        </div>
        <SlideTabs<Section>
          label="Seções do cardápio"
          tabs={SECTIONS.map(({ value, label }) => ({ value, label }))}
          value={current.value}
          onChange={(v) => navigate(v === 'itens' ? '/cardapio' : `/cardapio/${v}`)}
        />
      </div>
      {current.value === 'itens' && <ItemsTab />}
      {current.value === 'familias' && <FamiliesTab />}
      {current.value === 'complementos' && <GroupsTab />}
      {current.value === 'cardapios' && <MenusTab />}
    </>
  );
}
