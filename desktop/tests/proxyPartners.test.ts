// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { PROXY_PARTNERS, getProxyPartnerOffer, type ProxyPartner } from "../src/proxyPartners.ts";

const description = { en: "Approved discount", zh: "商家确认的优惠", ru: "Подтверждённая скидка" };
const provider = (promotion: ProxyPartner["promotion"]): ProxyPartner => ({
  id: "fixture", name: "Fixture vendor", website: "https://vendor.example/",
  enrollment: "https://vendor.example/affiliates", description, promotion,
});

test("active programs use the owner's allocated links and coupons while Decodo stays on its official site", () => {
  const webshare = PROXY_PARTNERS.find((partner) => partner.id === "webshare")!;
  const active = getProxyPartnerOffer(webshare);
  assert.equal(active.isAffiliate, true);
  const url = new URL(active.url!);
  assert.equal(url.origin, "https://www.webshare.io");
  assert.equal(url.searchParams.get("referral_code"), "06sdtipx4h55");
  assert.deepEqual([...url.searchParams.keys()], ["referral_code"]);
  assert.deepEqual(active.coupons, []);
  const proxySeller = getProxyPartnerOffer(PROXY_PARTNERS.find((partner) => partner.id === "proxy-seller")!);
  assert.equal(proxySeller.isAffiliate, true);
  const sellerUrl = new URL(proxySeller.url!);
  assert.equal(sellerUrl.origin, "https://proxy-seller.com");
  assert.equal(sellerUrl.searchParams.get("partner"), "508C890BD9E74268");
  assert.deepEqual([...sellerUrl.searchParams.keys()], ["partner"]);
  assert.deepEqual(proxySeller.coupons.map((coupon) => coupon.code), ["DGEPVL_923657"]);

  const decodo = PROXY_PARTNERS.find((partner) => partner.id === "decodo")!;
  const pending = getProxyPartnerOffer(decodo);
  assert.deepEqual(pending, { url: decodo.website, isAffiliate: false, coupons: [] });
});

test("ZhizhuIP preserves the owner-supplied referral URL without inventing coupons", () => {
  const partner = PROXY_PARTNERS.find((entry) => entry.id === "zhizhuip");
  assert.ok(partner);
  assert.deepEqual(getProxyPartnerOffer(partner), {
    url: "https://www.zhizhuip.com/?ref=12175",
    isAffiliate: true,
    coupons: [],
  });
});

test("unapproved promotions never send traffic or expose coupons from that promotion", () => {
  const offer = getProxyPartnerOffer(provider({ approved: false, url: "https://tracking.example/owner",
    coupons: [{ code: "OWNER10", description }] }));
  assert.deepEqual(offer, { url: "https://vendor.example/", isAffiliate: false, coupons: [] });
});

test("an approved owner link enables its own coupons and affiliate disclosure", () => {
  const offer = getProxyPartnerOffer(provider({ approved: true, url: "https://tracking.example/owner?campaign=pibrowse",
    coupons: [{ code: " OWNER10 ", description }, { code: "", description }, { code: "OWNER10", description }] }));
  assert.equal(offer.url, "https://tracking.example/owner?campaign=pibrowse");
  assert.equal(offer.isAffiliate, true);
  assert.deepEqual(offer.coupons, [{ code: "OWNER10", description }]);
});

test("unsafe promotion links fall back to the official site and suppress associated coupons", () => {
  for (const url of ["javascript:alert(1)", "http://tracking.example/", "https://user:password@tracking.example/", "not-a-url"]) {
    const offer = getProxyPartnerOffer(provider({ approved: true, url, coupons: [{ code: "OWNER10", description }] }));
    assert.deepEqual(offer, { url: "https://vendor.example/", isAffiliate: false, coupons: [] });
  }
});

test("an invalid official URL disables navigation rather than passing it to the shell", () => {
  const offer = getProxyPartnerOffer({ ...provider(null), website: "javascript:alert(1)" });
  assert.equal(offer.url, null);
  assert.equal(offer.isAffiliate, false);
});
