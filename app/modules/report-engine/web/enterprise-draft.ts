import type { EnterpriseConfig } from '../templates/enterprise/model';

/** 与账套/报表页面实例同寿命；来源报告日不随临时换期草稿倒退。 */
export function createEnterpriseDraftBridge(initialPeriod: number) {
  let latest: EnterpriseConfig | undefined;
  let sourcePeriod = initialPeriod;
  return {
    publish(configuration: EnterpriseConfig) {
      latest = structuredClone(configuration);
    },
    acceptSource(period: number) {
      if (Number.isSafeInteger(period)) sourcePeriod = Math.max(sourcePeriod, period);
    },
    reset(period: number) {
      latest = undefined;
      sourcePeriod = period;
    },
    options(configuration = latest) {
      return configuration
        ? { enterpriseDraft: { configuration: structuredClone(configuration), sourcePeriod } }
        : undefined;
    },
  };
}
