"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { AppPage, Button, Card, Input, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { RefreshCw, Tag, Ticket, List, Plus, X, ToggleLeft, ToggleRight } from "lucide-react";

type Promotion = {
  id: string;
  name: string;
  type: "PERCENTAGE" | "FIXED" | "BUY_X_GET_Y";
  value: number;
  minQty: number | null;
  productId: string | null;
  categoryId: string | null;
  product: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

type Coupon = {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED" | "BUY_X_GET_Y";
  value: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
};

type PriceList = {
  id: string;
  name: string;
  type: "REGULAR" | "VIP" | "WHOLESALE";
  isActive: boolean;
  items: Array<{ id: string; productId: string; productName: string; productSku: string; regularPrice: number; price: number }>;
};

type Tab = "promotions" | "coupons" | "priceLists";

function formatEGP(n: number) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB");
}

export default function PromotionsPage() {
  const { t, lang } = useLang();
  const pt = t.promotions as unknown as Record<string, string> & { tabs: Record<string, string> };

  const [tab, setTab] = useState<Tab>("promotions");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Create promotion form
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [promoName, setPromoName] = useState("");
  const [promoType, setPromoType] = useState("PERCENTAGE");
  const [promoValue, setPromoValue] = useState("");
  const [promoStartsAt, setPromoStartsAt] = useState("");
  const [promoEndsAt, setPromoEndsAt] = useState("");
  const [promoMinQty, setPromoMinQty] = useState("");
  const [savingPromo, setSavingPromo] = useState(false);

  // Create coupon form
  const [showCouponForm, setShowCouponForm] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState("PERCENTAGE");
  const [couponValue, setCouponValue] = useState("");
  const [couponMaxUses, setCouponMaxUses] = useState("");
  const [couponExpiry, setCouponExpiry] = useState("");
  const [savingCoupon, setSavingCoupon] = useState(false);

  // Create price list form
  const [showPLForm, setShowPLForm] = useState(false);
  const [plName, setPlName] = useState("");
  const [plType, setPlType] = useState("REGULAR");
  const [savingPL, setSavingPL] = useState(false);

  const load = async () => {
    setLoading(true);
    setMsg(""); setError("");
    const res = await fetch("/api/promotions");
    if (res.ok) {
      const data = await parseResponseJson<{ promotions: Promotion[]; coupons: Coupon[]; priceLists: PriceList[] }>(res);
      if (data) { setPromotions(data.promotions); setCoupons(data.coupons); setPriceLists(data.priceLists); }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const togglePromo = async (id: string, isActive: boolean) => {
    const res = await fetch(`/api/promotions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "promotion", isActive: !isActive }),
    });
    if (res.ok) load();
    else setError(t.errors.generic);
  };

  const toggleCoupon = async (id: string, isActive: boolean) => {
    const res = await fetch(`/api/promotions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "coupon", isActive: !isActive }),
    });
    if (res.ok) load();
    else setError(t.errors.generic);
  };

  const togglePL = async (id: string, isActive: boolean) => {
    const res = await fetch(`/api/promotions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "priceList", isActive: !isActive }),
    });
    if (res.ok) load();
    else setError(t.errors.generic);
  };

  const savePromo = async () => {
    if (!promoName || !promoValue || !promoStartsAt || !promoEndsAt) return;
    setSavingPromo(true); setMsg(""); setError("");
    const res = await fetch("/api/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "promotion",
        name: promoName,
        type: promoType,
        value: parseFloat(promoValue),
        startsAt: promoStartsAt,
        endsAt: promoEndsAt,
        minQty: promoMinQty ? parseInt(promoMinQty) : undefined,
      }),
    });
    setSavingPromo(false);
    if (res.ok) {
      setMsg(lang === "ar" ? "تم إنشاء العرض." : "Promotion created.");
      setShowPromoForm(false);
      setPromoName(""); setPromoValue(""); setPromoStartsAt(""); setPromoEndsAt(""); setPromoMinQty("");
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const saveCoupon = async () => {
    if (!couponCode || !couponValue) return;
    setSavingCoupon(true); setMsg(""); setError("");
    const res = await fetch("/api/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "coupon",
        code: couponCode,
        type: couponType,
        value: parseFloat(couponValue),
        maxUses: couponMaxUses ? parseInt(couponMaxUses) : undefined,
        expiresAt: couponExpiry || undefined,
      }),
    });
    setSavingCoupon(false);
    if (res.ok) {
      setMsg(lang === "ar" ? "تم إنشاء الكوبون." : "Coupon created.");
      setShowCouponForm(false);
      setCouponCode(""); setCouponValue(""); setCouponMaxUses(""); setCouponExpiry("");
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const savePL = async () => {
    if (!plName) return;
    setSavingPL(true); setMsg(""); setError("");
    const res = await fetch("/api/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "priceList", name: plName, priceListType: plType }),
    });
    setSavingPL(false);
    if (res.ok) {
      setMsg(lang === "ar" ? "تم إنشاء القائمة." : "Price list created.");
      setShowPLForm(false);
      setPlName("");
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const promoTypeLabel = (type: string) => {
    if (type === "PERCENTAGE") return lang === "ar" ? "%" : "%";
    if (type === "FIXED") return "EGP";
    return lang === "ar" ? "اشترِ X" : "Buy X";
  };

  const promoValueDisplay = (p: Promotion) => {
    if (p.type === "PERCENTAGE") return `${p.value}%`;
    if (p.type === "FIXED") return formatEGP(p.value);
    return `× ${p.value}`;
  };

  const isExpired = (endsAt: string) => new Date(endsAt) < new Date();

  const plTypeLabel = (type: string) => {
    if (type === "VIP") return "VIP";
    if (type === "WHOLESALE") return pt.customerTypeWholesale ?? "Wholesale";
    return pt.customerTypeRegular ?? "Regular";
  };

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "promotions", label: pt.tabs?.promotions ?? "Promotions", icon: Tag },
    { key: "coupons", label: pt.tabs?.coupons ?? "Coupons", icon: Ticket },
    { key: "priceLists", label: pt.tabs?.priceLists ?? "Price Lists", icon: List },
  ];

  return (
    <AppPage>
      <PageHeader
        title={pt.title}
        subtitle={pt.subtitle}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={15} aria-hidden /> {pt.refresh}
          </Button>
        }
      />

      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border p-1" style={{ background: "var(--surface-muted)", borderColor: "var(--border)" }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all"
            style={
              tab === key
                ? { background: "var(--accent)", color: "var(--accent-foreground)" }
                : { color: "var(--foreground)", background: "transparent" }
            }
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {/* Promotions tab */}
      {tab === "promotions" && (
        <div className="flex flex-col gap-4">
          {/* Create form */}
          {showPromoForm ? (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title={pt.newPromotion} />
                <button onClick={() => setShowPromoForm(false)} style={{ color: "var(--muted)" }}><X size={16} /></button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.promoName}</label>
                  <Input value={promoName} onChange={(e) => setPromoName(e.target.value)} placeholder={lang === "ar" ? "مثال: خصم رمضان" : "e.g. Ramadan Sale"} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.promoType}</label>
                  <select className="app-input w-full" value={promoType} onChange={(e) => setPromoType(e.target.value)}>
                    <option value="PERCENTAGE">{pt.typePercentage}</option>
                    <option value="FIXED">{pt.typeFixed}</option>
                    <option value="BUY_X_GET_Y">{pt.typeBuyXGetY}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.promoValue} ({promoTypeLabel(promoType)})</label>
                  <Input type="number" min="0" value={promoValue} onChange={(e) => setPromoValue(e.target.value)} placeholder="10" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.promoStartsAt}</label>
                  <Input type="date" value={promoStartsAt} onChange={(e) => setPromoStartsAt(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.promoEndsAt}</label>
                  <Input type="date" value={promoEndsAt} onChange={(e) => setPromoEndsAt(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.promoMinQty}</label>
                  <Input type="number" min="1" value={promoMinQty} onChange={(e) => setPromoMinQty(e.target.value)} placeholder={lang === "ar" ? "اختياري" : "Optional"} />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button onClick={savePromo} disabled={savingPromo || !promoName || !promoValue || !promoStartsAt || !promoEndsAt}>
                  {savingPromo ? pt.saving : pt.save}
                </Button>
                <Button variant="ghost" onClick={() => setShowPromoForm(false)}>{pt.cancel}</Button>
              </div>
            </Card>
          ) : (
            <div className="flex justify-end">
              <Button onClick={() => setShowPromoForm(true)}>
                <Plus size={15} aria-hidden /> {pt.newPromotion}
              </Button>
            </div>
          )}

          <Card>
            <SectionTitle title={pt.tabs?.promotions ?? "Promotions"} />
            {loading ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{pt.loading}</p>
            ) : promotions.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{pt.noPromotions}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {[pt.colName, pt.colType, pt.colValue, pt.colTarget, pt.colPeriod, pt.colStatus, pt.colActions].map((h) => (
                        <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {promotions.map((p) => {
                      const expired = isExpired(p.endsAt);
                      const tone = !p.isActive ? "neutral" : expired ? "warning" : "success";
                      const statusLabel = !p.isActive ? pt.inactive : expired ? pt.expired : pt.active;
                      return (
                        <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-3 py-2.5 font-medium">{p.name}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{promoTypeLabel(p.type)}</td>
                          <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--accent)" }}>{promoValueDisplay(p)}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                            {p.product?.name ?? p.category?.name ?? (lang === "ar" ? "كل المنتجات" : "All products")}
                          </td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                            {fmtDate(p.startsAt, lang)} → {fmtDate(p.endsAt, lang)}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => togglePromo(p.id, p.isActive)}
                              className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                              style={{ color: p.isActive ? "var(--muted)" : "var(--accent)" }}
                            >
                              {p.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                              {p.isActive ? pt.deactivate : pt.activate}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Coupons tab */}
      {tab === "coupons" && (
        <div className="flex flex-col gap-4">
          {showCouponForm ? (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title={pt.newCoupon} />
                <button onClick={() => setShowCouponForm(false)} style={{ color: "var(--muted)" }}><X size={16} /></button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.couponCode}</label>
                  <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="SAVE20" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.couponType}</label>
                  <select className="app-input w-full" value={couponType} onChange={(e) => setCouponType(e.target.value)}>
                    <option value="PERCENTAGE">{pt.typePercentage}</option>
                    <option value="FIXED">{pt.typeFixed}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.couponValue}</label>
                  <Input type="number" min="0" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} placeholder="20" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.couponMaxUses}</label>
                  <Input type="number" min="1" value={couponMaxUses} onChange={(e) => setCouponMaxUses(e.target.value)} placeholder={lang === "ar" ? "غير محدود" : "Unlimited"} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.couponExpiry}</label>
                  <Input type="date" value={couponExpiry} onChange={(e) => setCouponExpiry(e.target.value)} />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button onClick={saveCoupon} disabled={savingCoupon || !couponCode || !couponValue}>
                  {savingCoupon ? pt.saving : pt.save}
                </Button>
                <Button variant="ghost" onClick={() => setShowCouponForm(false)}>{pt.cancel}</Button>
              </div>
            </Card>
          ) : (
            <div className="flex justify-end">
              <Button onClick={() => setShowCouponForm(true)}>
                <Plus size={15} aria-hidden /> {pt.newCoupon}
              </Button>
            </div>
          )}

          <Card>
            <SectionTitle title={pt.tabs?.coupons ?? "Coupons"} />
            {loading ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{pt.loading}</p>
            ) : coupons.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{pt.noCoupons}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {[pt.couponCode, pt.colType, pt.colValue, pt.couponUsed, pt.couponExpiry, pt.colStatus, pt.colActions].map((h) => (
                        <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map((c) => {
                      const expired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
                      const exhausted = c.maxUses != null && c.usedCount >= c.maxUses;
                      const tone = !c.isActive || exhausted ? "neutral" : expired ? "warning" : "success";
                      const statusLabel = !c.isActive ? pt.inactive : exhausted ? (lang === "ar" ? "نفد" : "Exhausted") : expired ? pt.expired : pt.active;
                      return (
                        <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-3 py-2.5 font-mono font-semibold" style={{ color: "var(--accent)" }}>{c.code}</td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                            {c.type === "PERCENTAGE" ? "%" : "EGP"}
                          </td>
                          <td className="px-3 py-2.5 font-semibold">
                            {c.type === "PERCENTAGE" ? `${c.value}%` : formatEGP(c.value)}
                          </td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                            {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ""}
                          </td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                            {c.expiresAt ? fmtDate(c.expiresAt, lang) : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => toggleCoupon(c.id, c.isActive)}
                              className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                              style={{ color: c.isActive ? "var(--muted)" : "var(--accent)" }}
                            >
                              {c.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                              {c.isActive ? pt.deactivate : pt.activate}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Price Lists tab */}
      {tab === "priceLists" && (
        <div className="flex flex-col gap-4">
          {showPLForm ? (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title={pt.newPriceList} />
                <button onClick={() => setShowPLForm(false)} style={{ color: "var(--muted)" }}><X size={16} /></button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.priceListName}</label>
                  <Input value={plName} onChange={(e) => setPlName(e.target.value)} placeholder={lang === "ar" ? "مثال: أسعار الجملة" : "e.g. Wholesale Prices"} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{pt.priceListType}</label>
                  <select className="app-input w-full" value={plType} onChange={(e) => setPlType(e.target.value)}>
                    <option value="REGULAR">{pt.customerTypeRegular}</option>
                    <option value="VIP">VIP</option>
                    <option value="WHOLESALE">{pt.customerTypeWholesale}</option>
                  </select>
                </div>
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                {lang === "ar" ? "بعد الإنشاء يمكنك إضافة المنتجات وأسعارها الخاصة." : "After creating, you can add products with their special prices."}
              </p>
              <div className="mt-4 flex gap-2">
                <Button onClick={savePL} disabled={savingPL || !plName}>
                  {savingPL ? pt.saving : pt.save}
                </Button>
                <Button variant="ghost" onClick={() => setShowPLForm(false)}>{pt.cancel}</Button>
              </div>
            </Card>
          ) : (
            <div className="flex justify-end">
              <Button onClick={() => setShowPLForm(true)}>
                <Plus size={15} aria-hidden /> {pt.newPriceList}
              </Button>
            </div>
          )}

          <Card>
            <SectionTitle title={pt.tabs?.priceLists ?? "Price Lists"} />
            {loading ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{pt.loading}</p>
            ) : priceLists.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{pt.noPriceLists}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {priceLists.map((pl) => (
                  <div key={pl.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold">{pl.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                          {plTypeLabel(pl.type)} · {pl.items.length} {lang === "ar" ? "منتج" : "products"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={pl.isActive ? "success" : "neutral"}>
                          {pl.isActive ? pt.active : pt.inactive}
                        </StatusBadge>
                        <button
                          onClick={() => togglePL(pl.id, pl.isActive)}
                          className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: pl.isActive ? "var(--muted)" : "var(--accent)" }}
                        >
                          {pl.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          {pl.isActive ? pt.deactivate : pt.activate}
                        </button>
                      </div>
                    </div>
                    {pl.items.length > 0 && (
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {[lang === "ar" ? "المنتج" : "Product", lang === "ar" ? "السعر العادي" : "Regular", pt.itemPrice].map((h) => (
                              <th key={h} className="px-2 py-1.5 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pl.items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td className="px-2 py-2">
                                <p className="font-medium">{item.productName}</p>
                                <p className="text-xs" style={{ color: "var(--muted)" }}>{item.productSku}</p>
                              </td>
                              <td className="px-2 py-2 text-xs" style={{ color: "var(--muted)", textDecoration: "line-through" }}>
                                {formatEGP(item.regularPrice)}
                              </td>
                              <td className="px-2 py-2 font-semibold" style={{ color: "var(--accent)" }}>
                                {formatEGP(item.price)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </AppPage>
  );
}
