import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  SmallBusinessStatementActions,
  SmallBusinessStatementView,
  SmallBusinessConfiguration,
} from '../../templates/small-business/statutory.web';
import type {
  PreparedSmallBusiness,
  smallBusinessConfigurationData,
} from '../../templates/small-business/statutory.server';
import type { PrintJob } from '@caiwu/print';
import type { Configuration } from '../../templates/small-business/configuration';
type Data = {
  prepared: PreparedSmallBusiness;
  workbooks: string[];
  jobs: PrintJob[];
  configurationData?: Awaited<ReturnType<typeof smallBusinessConfigurationData>>;
};
declare global {
  interface Window {
    mountSmallBusiness: (data: Data, mode?: 'view' | 'configuration') => void;
    smallPrintedDocument?: string;
    smallSavedConfiguration?: Configuration;
    smallErrors?: string[];
  }
}
function Host({ data, mode }: { data: Data; mode: 'view' | 'configuration' }) {
  const [index, setIndex] = useState(0),
    [configuration, setConfiguration] = useState(data.prepared.configuration);
  if (mode === 'configuration' && data.configurationData) {
    const c = data.configurationData;
    return (
      <SmallBusinessConfiguration
        value={configuration}
        accounts={c.accounts}
        entries={c.entries}
        analysisRows={c.analysisRows}
        startPeriod={c.book.startPeriod}
        openingRows={c.openingRows}
        onChange={setConfiguration}
        onSave={() => {
          window.smallSavedConfiguration = configuration;
        }}
      />
    );
  }
  const s = data.prepared.statements[index]!;
  return (
    <main>
      <nav>
        {data.prepared.statements.map((s, i) => (
          <button key={s.code} onClick={() => setIndex(i)}>
            {s.name}
          </button>
        ))}
      </nav>
      <SmallBusinessStatementActions
        name={s.name}
        loadWorkbook={async () => data.workbooks[index]!}
        loadPrintJob={async () => data.jobs[index]!}
        onError={(e) => {
          window.smallErrors = [...(window.smallErrors ?? []), String(e)];
        }}
      />
      <SmallBusinessStatementView
        statement={s}
        comparisonNote={data.prepared.comparisonNote}
        orgName={data.prepared.orgName}
        period={data.prepared.period}
      />
    </main>
  );
}
window.mountSmallBusiness = (data, mode = 'view') => {
  createRoot(document.getElementById('root')!).render(
    <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }}>
      <Host data={data} mode={mode} />
    </ConfigProvider>,
  );
};
