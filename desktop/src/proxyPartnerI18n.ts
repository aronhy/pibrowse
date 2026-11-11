// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LocalizedText } from "./proxyPartners";

const en = {
  title: "Proxy providers", services: "Proxy services", count: "{n} providers",
  intro: "Third-party proxy services you can explore in your system browser.",
  affiliate: "Affiliate partner", openOfficial: "Visit website", openAffiliate: "View services", hide: "Hide providers",
  note: "Third-party services open in your system browser. PiBrowse does not send them your profile or proxy configuration.",
  affiliateNote: "Referral income helps cover development costs and ongoing project updates.",
  copy: "Copy code", copying: "Copying…", copied: "Copied", copyFailed: "Could not copy. Select the code and copy it manually.",
  openFailed: "Could not open the system browser. Try the website button again.",
} as const;
type Labels = { [K in keyof typeof en]: string };
const zh: Labels = {
  title: "代理服务商", services: "代理服务", count: "{n} 家服务商",
  intro: "可在系统浏览器中查看以下第三方代理服务。",
  affiliate: "推广合作", openOfficial: "访问官网", openAffiliate: "查看服务", hide: "收起服务商",
  note: "第三方服务在系统浏览器中打开。PiBrowse 不向服务商发送环境或代理配置。",
  affiliateNote: "通过分销维持开发的费用以及项目更新。",
  copy: "复制优惠码", copying: "复制中…", copied: "已复制", copyFailed: "复制失败，请选中优惠码手动复制。",
  openFailed: "无法打开系统浏览器，请重试访问官网按钮。",
};
const ru: Labels = {
  title: "Поставщики прокси", services: "Прокси-сервисы", count: "Поставщиков: {n}",
  intro: "Сторонние прокси-сервисы можно посмотреть в системном браузере.",
  affiliate: "Партнёрская ссылка", openOfficial: "Открыть сайт", openAffiliate: "Посмотреть услуги", hide: "Скрыть поставщиков",
  note: "Сторонние сервисы открываются в системном браузере. PiBrowse не передаёт им настройки профилей или прокси.",
  affiliateNote: "Доход от партнёрских рекомендаций покрывает затраты на разработку и обновления проекта.",
  copy: "Копировать код", copying: "Копирование…", copied: "Скопировано", copyFailed: "Не удалось скопировать. Выделите код и скопируйте его вручную.",
  openFailed: "Не удалось открыть системный браузер. Нажмите кнопку сайта ещё раз.",
};

export function proxyPartnerLabels(language: string): Labels {
  return language === "zh" ? zh : language === "ru" ? ru : en;
}

export function proxyPartnerText(text: LocalizedText, language: string): string {
  return language === "zh" ? text.zh : language === "ru" ? text.ru : text.en;
}
