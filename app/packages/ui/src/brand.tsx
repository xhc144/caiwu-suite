import type { ReactNode } from 'react';

const FEATURES = [
  '凭证、账簿、报表一体化',
  '每个账套一个独立文件，保存在本机',
  '支持自动备份与恢复',
];

/** 品牌标识：圆角渐变方块 + "财"。 */
export function BrandLogo({ size = 40 }: { size?: number }) {
  return (
    <span
      className="cw-brand-mark"
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.5, borderRadius: size / 4 }}
    >
      财
    </span>
  );
}

/** 账套选择等宽页面顶部的品牌栏。 */
export function BrandHeader({ extra }: { extra?: ReactNode }) {
  return (
    <div className="cw-brand-header">
      <BrandLogo size={36} />
      <div className="cw-brand-header-text">
        <span className="cw-brand-header-title">财务软件</span>
        <span className="cw-brand-header-sub">轻松会计 · 民非企会计 · 成本会计</span>
      </div>
      {extra && <div className="cw-brand-header-extra">{extra}</div>}
    </div>
  );
}

/** 登录等窄表单页面：左侧品牌介绍，右侧内容；窄屏时品牌区收起为顶部一条。 */
export function BrandSplit({ children }: { children: ReactNode }) {
  return (
    <div className="cw-brand-split-page">
      <div className="cw-brand-split">
        <aside className="cw-brand-panel">
          <BrandLogo size={48} />
          <div className="cw-brand-panel-title">财务软件</div>
          <div className="cw-brand-panel-sub">轻松会计 · 民非企会计 · 成本会计</div>
          <ul className="cw-brand-panel-list">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </aside>
        <div className="cw-brand-split-content">{children}</div>
      </div>
    </div>
  );
}
