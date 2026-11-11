// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LocalizedText { en: string; zh: string; ru: string; }
export interface ProxyCoupon { code: string; description: LocalizedText; }
export interface ProxyPromotion { approved: boolean; url: string; coupons?: readonly ProxyCoupon[]; }
export interface ProxyPartner {
  id: string;
  name: string;
  website: string;
  enrollment: string;
  description: LocalizedText;
  promotion: ProxyPromotion | null;
}

/** Official sites remain the fallback. Promotions use account-issued or
 * owner-supplied public tracking links, with commercial disclosure in the UI. */
export const PROXY_PARTNERS: readonly ProxyPartner[] = [
  {
    id: "webshare", name: "Webshare", website: "https://www.webshare.io/",
    enrollment: "https://www.webshare.io/affiliate-program",
    description: { en: "Residential, ISP and datacenter proxies.", zh: "住宅、ISP 与数据中心代理。", ru: "Резидентные, ISP и серверные прокси." },
    promotion: {
      approved: true,
      url: "https://www.webshare.io/?referral_code=06sdtipx4h55",
    },
  },
  {
    id: "decodo", name: "Decodo", website: "https://decodo.com/",
    enrollment: "https://decodo.com/proxy-affiliate-program",
    description: { en: "Residential, mobile, ISP and datacenter proxies.", zh: "住宅、移动、ISP 与数据中心代理。", ru: "Резидентные, мобильные, ISP и серверные прокси." },
    promotion: null,
  },
  {
    id: "proxy-seller", name: "Proxy-Seller", website: "https://proxy-seller.com/",
    enrollment: "https://proxy-seller.com/affiliate-program-main/",
    description: { en: "IPv4, IPv6, ISP, mobile and residential proxies.", zh: "IPv4、IPv6、ISP、移动与住宅代理。", ru: "IPv4, IPv6, ISP, мобильные и резидентные прокси." },
    promotion: {
      approved: true,
      url: "https://proxy-seller.com/?partner=508C890BD9E74268",
      coupons: [{
        code: "DGEPVL_923657",
        description: {
          en: "Referral code",
          zh: "推荐码",
          ru: "Реферальный код",
        },
      }],
    },
  },
  {
    id: "zhizhuip", name: "蜘蛛IP", website: "https://www.zhizhuip.com/",
    enrollment: "https://www.zhizhuip.com/",
    description: {
      en: "Rotating residential, static residential and datacenter proxies.",
      zh: "动态住宅、静态住宅与数据中心代理。",
      ru: "Ротационные и статические резидентные, серверные прокси.",
    },
    promotion: {
      approved: true,
      url: "https://www.zhizhuip.com/?ref=12175",
    },
  },
];

export function getProxyPartnerOffer(partner: ProxyPartner): { url: string | null; isAffiliate: boolean; coupons: readonly ProxyCoupon[] } {
  const official = httpsDestination(partner.website);
  const promotion = partner.promotion;
  const promoted = promotion?.approved === true ? httpsDestination(promotion.url) : null;
  if (!promoted || !promotion) return { url: official, isAffiliate: false, coupons: [] };
  const seen = new Set<string>();
  const coupons: ProxyCoupon[] = [];
  for (const coupon of promotion.coupons ?? []) {
    const code = coupon.code.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    coupons.push({ code, description: { ...coupon.description } });
  }
  return { url: promoted, isAffiliate: true, coupons };
}

function httpsDestination(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
