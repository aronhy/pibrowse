// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { useEffect, useState } from "react";
import { api, ApiError, type BillingStatus } from "../api";
import { billingStrings, format, languageNames, useI18n } from "../i18n";

export function TeamBilling() {
  const { resolved, say } = useI18n();
  const copy = billingStrings(resolved);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [opening, setOpening] = useState(false);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let current = true;
    void api.billingStatus().then(
      (next) => {
        if (current) {
          setStatus(next);
          setRefreshing(false);
        }
      },
      (failure: unknown) => {
        if (current) {
          if (failure instanceof ApiError && failure.status === 404) setStatus(null);
          else setError(failure);
          setRefreshing(false);
        }
      },
    );
    return () => { current = false; };
  }, [revision]);

  const refresh = () => {
    setError(null);
    setRefreshing(true);
    setRevision((previous) => previous + 1);
  };

  if (!status?.enabled) {
    if (error === null) return null;
    return (
      <section className="settingsGroup" aria-labelledby="team-billing-heading">
        <h2 id="team-billing-heading">{copy.title}</h2>
        <p className="error" role="alert">{say(error)}</p>
        <button type="button" className="ghost" onClick={refresh}>{copy.refresh}</button>
      </section>
    );
  }

  const busy = opening || refreshing;
  const paidThrough = status.paid_through ? Date.parse(status.paid_through) : NaN;
  const open = async (kind: "checkout" | "portal") => {
    setOpening(true);
    setError(null);
    try {
      await api.openBilling(kind);
      if (kind === "checkout") setCheckoutOpened(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="settingsGroup" aria-labelledby="team-billing-heading">
      <h2 id="team-billing-heading">{copy.title}</h2>
      <p role="status">
        {status.active ? copy.active : status.status === "incomplete" ? copy.pending : copy.inactive}
        {status.active && Number.isFinite(paidThrough) && (
          <span className="muted">
            {" "}{format(copy.paidThrough, {
              date: new Date(paidThrough).toLocaleString(languageNames[resolved].tag, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </span>
        )}
      </p>
      {error !== null && <p className="error" role="alert">{say(error)}</p>}
      <div className="row">
        {status.can_manage && !status.active && (
          <button type="button" className="primary" disabled={busy} onClick={() => void open("checkout")}>
            {copy.checkout}
          </button>
        )}
        {status.can_manage && status.has_customer && (
          <button type="button" disabled={busy} onClick={() => void open("portal")}>
            {copy.portal}
          </button>
        )}
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={refresh}
        >
          {refreshing ? copy.refreshing : copy.refresh}
        </button>
      </div>
      {checkoutOpened && !status.active && <p className="hint" role="status">{copy.afterCheckout}</p>}
      {!status.can_manage && !status.active && <p className="hint">{copy.askOwner}</p>}
    </section>
  );
}
