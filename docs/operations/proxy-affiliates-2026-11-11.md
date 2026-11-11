# PiBrowse 代理联盟申请资料

核实日期：2026-11-11。申请邮箱使用用户本次指定的地址，不存入代码仓库。用户已亲自登录最初三家。Webshare 与 Proxy-Seller 已发放自有公开推广链接；用户另提供蜘蛛IP推广链接，三家均已接入客户端源码。Decodo／Impact 尚未发放品牌链接。

## 当前接入状态

- **Webshare：已激活并接入。** 使用后台“Your personal affiliate link”提供的完整地址，未改动收款资料。后台当前显示前30天按推荐客户消费额计50%，之后10%；这是佣金规则，不是客户折扣。Coupons列表为空，因此不展示任何优惠码或折扣。
- **Proxy-Seller：KYC通过并接入。** 用户本人完成核验；Profile 显示 KYC verification passed successfully，Affiliate portal 已发放带 partner 参数的推广链接及推荐码 `DGEPVL_923657`。两者均来自本人后台。推荐码提示只说明结算时输入可取得 offer 并归因，未给出明确折扣比例；客户端按用户要求仅标注“推荐码”。未改动收款方式。
- **蜘蛛IP：使用用户提供的推广链接。** 完整保留 `https://www.zhizhuip.com/?ref=12175`，显示推广合作及统一佣金说明。产品概述依据[官网](https://www.zhizhuip.com/)和[官方使用文档](https://help.zhizhuip.com/docs/Process)列出的动态住宅、静态住宅与数据中心代理。未新增优惠码、折扣或佣金比例承诺，未操作其后台账号。
- **Decodo／Impact：复核工单已提交。** 登录后的通知显示 marketplace application declined，尚未取得品牌追踪链接，保持官网入口。已将 `pibrowse.dev` 添加为媒体资源并验证 Connected。用户明确授权发送后，已提交市场准入复核工单 **920738**；详情页显示 **Open** 及“Ticket created successfully”。工单说明官网、开源地址及可选客户端推广位置，询问缺失资料和 Decodo 直接邀请可能性。工单提交不等于准入或品牌合作获批。

### 网站验证与交付范围

- `site/pibrowse/index.html` 仅增加公开 `impact-site-verification` meta，无跟踪脚本。部署前确认线上主页与本地文件除该标签外完全一致。
- 已通过现有 Wrangler 配置部署至 `https://pibrowse.dev/`，版本 `c8da6c69-5ec2-4764-a5d3-b60f57ddfe4d`；公开页面回读包含该标签，Impact 媒体资源界面显示 Website `pibrowse.dev` Connected。
- 客户端源码已使用三家自有推广链接，目录共四家服务商；隔离预览已逐一点击确认完整归因参数，蜘蛛IP点击目标与用户提供的URL完全一致，显示三处推广合作及统一佣金披露。Proxy-Seller 推荐码显示及复制反馈已检查；未独立验证系统剪贴板内容。
- 按用户后续要求，底部完整替换为“通过分销维持开发的费用以及项目更新。”，不再拼接原外部浏览器及配置说明；推荐码去掉结算页面提示。英文、俄文同步调整，隔离预览已确认中文全文精确匹配。
- 蜘蛛IP加入后，从待提交的 Git 暂存内容导出独立客户端目录，28 项测试、TypeScript 检查及 Vite 构建通过。现有大包警告仍在；独立配置复审通过。未打包、安装或发布新的桌面版本，未完成真实商家订单归因与到账验收。

### Webshare 渠道核对

官方协议将推荐链接描述为在 web properties 展示，但没有明确写软件入口禁令或每个链接位置须再次审批；官方FAQ允许广泛内容渠道。不能将这一范围描述直接解释成“现有ACTIVE联盟仍必须重新申请”。本次仅使用现有账号已分配的链接、纯文字服务商名称与通用图标，披露佣金，不新增官方认证表述或商家Logo。具体渠道没有单独书面承诺，不夸大此点。商标素材使用仍需遵守[协议第3节](https://www.webshare.io/affiliate-agreement)。

## 优先申请的三家

| 服务商 | 官方计划与公开佣金 | 需要完成的步骤 |
| --- | --- | --- |
| Webshare | [官方联盟页](https://www.webshare.io/affiliate-program)及[帮助](https://help.webshare.io/en/articles/8451043-affiliate-program)：首购50%、续费10%，每客户累计上限$3,000；30天归因；PayPal、$10起。普通Referral是账户credits，不是现金Affiliate。官网页底部仍有25%的旧文案，实际以账号中的当前offer为准。 | 现金Affiliate已激活、自有链接已接入源码；后续按正常客户端发布流程打包。 |
| Decodo | [官方计划](https://decodo.com/proxy-affiliate-program)：最高50%、每位新客户最高$2,500、60天Cookie，经Impact审核。普通Refer-a-Friend给钱包credits，与现金联盟不同。 | 网站媒体资源已验证；市场准入复核工单920738为Open。待回复及品牌合作获批后取得追踪链接。 |
| Proxy-Seller | [官方计划](https://proxy-seller.com/affiliate-program-main/)：IPv4/IPv6/ISP首单30%、续单10%；移动首单10%、续单3%；住宅每单50%、每客户上限$2,500。可用专属链接和优惠码。 | 本人KYC已通过，自有推广链接及推荐码已接入源码。收款方式由用户自行设置。 |

佣金是推广者收入，不是客户折扣。未核准优惠码时，客户端不展示折扣承诺。公开佣金不是已获批合同或已到账收入。

## 可直接使用的英文申请简介

Product: PiBrowse

Website: https://pibrowse.dev/

Source: https://github.com/aronhy/pibrowse

Publisher description:

> I maintain PiBrowse, an open-source desktop application for managing separate browser profile workspaces. It can run locally or be self-hosted by teams. We would like to offer users a clearly labelled, optional proxy-provider directory inside the desktop client. A user deliberately clicks a provider button, which opens the approved provider or affiliate URL in their system browser. We do not embed provider checkout pages or automatically send browser-profile data to providers. We are not claiming an existing partnership, a traffic volume, or a guaranteed number of conversions.

Channel approval request:

> Please confirm whether this desktop-client placement is accepted under your affiliate program, which tracking URL and brand assets we may use, how purchases and renewals are attributed, and whether a customer coupon may be offered. Any commercial relationship will be disclosed. We will use only the rates, claims and assets you approve.

申请表中的真实姓名、国家、收款及身份信息由用户本人填写。不要虚报网站流量、装机数、用户数或媒体资质。以上简介可复用；本轮已授权发送的具体内容见工单920738，未向商家另发邮件。

## 官方规则核对入口

- Webshare：[Affiliate Agreement](https://www.webshare.io/affiliate-agreement)。渠道核对见上文，不将措辞范围推断为额外审批条件。公开帮助与协议的支付时间表可能不同，以开户时实际条款为准。
- Decodo：[Affiliate terms](https://decodo.com/legal/decodo-affiliate-program-terms-and-conditions)。加密货币付款、退款和拒付可能不计佣；具体offer以Impact账户为准。申请入口由官网指向Impact，注册前要求确认品牌offer与program terms。
- Proxy-Seller：[Public Offer](https://proxy-seller.com/trust-center/public-offer/)、[KYC policy](https://proxy-seller.com/trust-center/kyc-policy/)。无需为申请购买代理；推广资格和KYC由商家审核。官网列有付费导流限制，本轮不投放广告。
- IPRoyal备选：[站内Referral](https://iproyal.com/referral-program/)和[Impact Affiliate](https://iproyal.com/affiliate-program/)是不同计划；前者自2026-06-30起有每客户6个月计佣窗口，不能把后者的lifetime宣传套在站内计划上，因此本轮未放入三家初始列表。

## 获批后启用自己的链接

中央配置：`desktop/src/proxyPartners.ts`。Webshare、Proxy-Seller 已使用后台分配的自有链接，蜘蛛IP使用用户提供的自有链接；Decodo 为 `promotion: null`，仅打开官方首页。当前推广组件不会继承上游Fury归因。

获得商家认可的自有链接后，对相应条目设置：

```ts
promotion: {
  approved: true,
  url: "https://商家实际提供的追踪地址",
  // 无获批优惠码时省略 coupons。
  coupons: [{
    code: "商家实际分配的优惠码",
    description: { en: "实际优惠说明", zh: "实际优惠说明", ru: "实际优惠说明" },
  }],
}
```

仅 `approved: true` 且不含用户名密码的HTTPS推广链接有效时，客户端才显示推广合作及对应优惠码。上述示例不是可以直接使用的返佣链接或优惠码；不要原样启用。修改后运行 `npm test` 与 `npm run build`，再按正常客户端发布流程打包。
