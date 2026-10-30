import { Navigate, Route, Routes } from 'react-router';
import { useCan } from '../../app/auth';
import { HelpScope } from '../../design-system';
import { FISCAL_HELP } from '../../features/help/fiscal-help';
import { DocumentDetail } from './DocumentDetail';
import { DocumentsList } from './DocumentsList';
import { ReceivedSection } from './ReceivedSection';
import { RulesSection } from './RulesSection';
import { SettingsSection } from './SettingsSection';
import { VoidsSection } from './VoidsSection';
import './fiscal.css';

/** Fiscal: NFC-e, NF-e, notas recebidas, inutilização, padrões fiscais e configuração. */
export function FiscalPage() {
  const canManage = useCan('fiscal:manage');
  const manage = (el: React.ReactElement) =>
    canManage ? el : <Navigate to="/fiscal/nfce" replace />;
  return (
    <HelpScope dict={FISCAL_HELP}>
      <Routes>
        <Route path="nfce" element={<DocumentsList kind="nfce" />} />
        <Route path="nfe" element={<DocumentsList kind="nfe" />} />
        <Route path="nota/:id" element={<DocumentDetail />} />
        <Route path="recebidas" element={<ReceivedSection />} />
        <Route path="inutilizacao" element={<VoidsSection />} />
        <Route path="padroes" element={manage(<RulesSection />)} />
        <Route path="configuracao" element={manage(<SettingsSection />)} />
        <Route path="*" element={<Navigate to="nfce" replace />} />
      </Routes>
    </HelpScope>
  );
}
