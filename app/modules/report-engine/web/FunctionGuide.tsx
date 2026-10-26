import { Alert, Drawer } from 'antd';

export function FunctionGuide({ onClose }: { onClose(): void }) {
  return (
    <Drawer getContainer={false} open title="报表函数指南" size={680} onClose={onClose}>
      <p>
        当前引擎支持以下函数。选定单元格后按 F8，可选总账取数、表内求和、表间引用，或编辑组合公式。
      </p>
      <dl>
        <dt>
          <code>BALANCE(科目,指标,单位,币种,方向,辅助类型,辅助编码)</code>
        </dt>
        <dd>
          七个参数均为双引号字符串。指标可选期初、期末、本期借贷、本年累计借贷；含真实下级科目，避免重复汇总。辅助类型包括项目、客供、部门、个人和现金流量项目，须选择对应编码。
        </dd>
        <dt>
          <code>SUM(A1:B3)</code>
        </dt>
        <dd>
          矩形区域求和，也可使用 SUM(A1,B1) 或
          SUM(A1*2,B1)。忽略空格；混合单位或币种会在生成时报错。
        </dd>
        <dt>
          <code>REF("101","A1")</code>
        </dt>
        <dd>
          引用当前账套编码 101 的
          A1。生成时按同期间、同过账口径重新计算来源表；不读取另一期间的旧结果。
        </dd>
        <dt>
          <code>(A1+B1)*0.5</code>
        </dt>
        <dd>
          支持四则、括号和一元负号。普通数值可作比例，金额常数须以分记录在金额单元格后引用。金额相除返回普通数值；结果单位须与单元格声明一致。
        </dd>
      </dl>
      <Alert
        type="info"
        title="先校验语法，再保存并生成"
        description="语法校验不读取账务数据，不能证明引用有效、单位一致或勾稽通过。实际生成会检查循环、越界、除零、缺失科目和单位，并保留上次成功结果。"
      />
      <p>
        金额按整数分取数，显示元，四舍五入落到分；数量和比例保留10位小数。公式最多2000字符、512计算项、40层语法嵌套、64层引用；一次生成最多100000步。
      </p>
      <Alert
        type="warning"
        title="仍未支持的原版能力"
        description="dba.bbfun 基本函数数据行未齐，S/W/F 原版别名不作兼容承诺；外币/数量本年累计、现金流量期初项目分配仍缺可靠共享口径。"
      />
    </Drawer>
  );
}
