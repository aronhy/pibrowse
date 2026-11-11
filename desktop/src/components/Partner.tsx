// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { PROXY_PARTNERS, getProxyPartnerOffer, type ProxyCoupon, type ProxyPartner } from "../proxyPartners";
import { proxyPartnerLabels, proxyPartnerText } from "../proxyPartnerI18n";
import { Icon, IconButton } from "./Icon";
import "./ProxyPartners.css";

type Labels = ReturnType<typeof proxyPartnerLabels>;
type Offer = ReturnType<typeof getProxyPartnerOffer>;

/** Each coupon owns its feedback and timer, including when the panel closes. */
function CouponRow({ coupon, language, labels }: { coupon: ProxyCoupon; language: string; labels: Labels }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(coupon.code);
      if (!mounted.current) return;
      setCopyState("copied");
      timer.current = window.setTimeout(() => {
        setCopyState("idle");
        timer.current = null;
      }, 2000);
    } catch {
      if (mounted.current) setCopyState("failed");
    }
  };

  return (
    <div className="proxyProviderCoupon">
      <div className="productRow">
        <code className="mono" tabIndex={0}>{coupon.code}</code>
        <span className="productText small">{proxyPartnerText(coupon.description, language)}</span>
        <button className="ghost" aria-label={`${labels.copy}: ${coupon.code}`} disabled={copyState === "copying"} onClick={() => void copy()}>
          <Icon name="copy" size={13} />
          <span role="status" aria-live="polite">{copyState === "copied" ? labels.copied : copyState === "copying" ? labels.copying : labels.copy}</span>
        </button>
      </div>
      {copyState === "failed" && <p className="proxyProviderError small" role="alert">{labels.copyFailed}</p>}
    </div>
  );
}

function ProviderRow({ partner, offer, language, labels }: { partner: ProxyPartner; offer: Offer; language: string; labels: Labels }) {
  const [openFailed, setOpenFailed] = useState(false);
  const open = async () => {
    if (!offer.url) return;
    setOpenFailed(false);
    try {
      await api.openUrl(offer.url);
    } catch {
      setOpenFailed(true);
    }
  };

  return (
    <div className="proxyProviderEntry">
      <div className="productRow proxyProviderRow">
        <span className="productIcon"><Icon name="globe" size={18} /></span>
        <div className="productText">
          <div className="productName">
            {partner.name} {offer.isAffiliate && <span className="badge proxyAffiliateBadge">{labels.affiliate}</span>}
          </div>
          <div className="muted small proxyProviderDescription">{proxyPartnerText(partner.description, language)}</div>
        </div>
        <button className="ghost" aria-label={`${offer.isAffiliate ? labels.openAffiliate : labels.openOfficial}: ${partner.name}`} disabled={!offer.url} onClick={() => void open()}>
          {offer.isAffiliate ? labels.openAffiliate : labels.openOfficial} <Icon name="external" size={13} />
        </button>
      </div>
      {openFailed && <p className="proxyProviderError small" role="alert">{labels.openFailed}</p>}
      {offer.coupons.map((coupon, index) => (
        <CouponRow key={`${coupon.code}:${index}`} coupon={coupon} language={language} labels={labels} />
      ))}
    </div>
  );
}

/** A local provider list; external pages open only after the user clicks. */
export function PartnerCard({ onHide }: { onHide?: () => void }) {
  const { resolved } = useI18n();
  const labels = proxyPartnerLabels(resolved);
  const heading = useId();
  const entries = PROXY_PARTNERS.map((partner) => ({ partner, offer: getProxyPartnerOffer(partner) }));
  const hasAffiliate = entries.some(({ offer }) => offer.isAffiliate);

  return (
    <section className="partnerCard proxyProvidersPanel" aria-labelledby={heading}>
      <div className="proxyProvidersHead">
        <h3 id={heading}>{labels.title}</h3>
        {onHide && <IconButton icon="close" label={labels.hide} onClick={onHide} />}
      </div>
      {entries.map(({ partner, offer }) => (
        <ProviderRow key={partner.id} partner={partner} offer={offer} language={resolved} labels={labels} />
      ))}
      <p className="muted small partnerNote">
        {hasAffiliate ? labels.affiliateNote : labels.note}
      </p>
    </section>
  );
}
