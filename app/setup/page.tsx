"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Phone, ChevronRight, CheckCircle, Loader2, ImagePlus, X, KeyRound } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [storeName, setStoreName] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError("حجم الصورة يجب أن يكون أقل من 3 ميغابايت"); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = (ev) => setLogoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  };

  const handleFinish = async () => {
    if (!storeName.trim()) { setError("أدخل اسم المتجر"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, storePhone, storeLogo: logoDataUrl ?? undefined }),
      });
      if (res.ok) {
        setStep(2);
      } else {
        const d = await res.json().catch(() => ({}));
        setError((d as { message?: string }).message ?? "حدث خطأ، حاول مرة أخرى");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--background, #f8fafc)" }}
      dir="rtl"
    >
      {/* Header */}
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg"
          style={{ background: "var(--accent, #60a5fa)" }}
        >
          <Store size={40} strokeWidth={1.8} color="white" />
        </div>
        <h1 className="text-3xl font-black tracking-tight" style={{ color: "var(--foreground, #0f172a)" }}>
          إعداد المتجر
        </h1>
        <p className="text-base" style={{ color: "var(--muted, #64748b)" }}>
          أدخل معلومات متجرك لتظهر في الفواتير والتقارير
        </p>
      </div>

      <div
        className="w-full max-w-md rounded-3xl border p-8 shadow-xl"
        style={{ background: "var(--surface, white)", borderColor: "var(--border, #e2e8f0)" }}
      >
        {/* ── Step 1: Store info ── */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-black" style={{ color: "var(--foreground, #0f172a)" }}>
                معلومات متجرك
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--muted, #64748b)" }}>
                ستظهر هذه البيانات في كل الفواتير والتقارير.
              </p>
            </div>

            {/* Store name */}
            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <Store size={14} className="inline me-1.5 opacity-60" />
                اسم المتجر <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="مثال: متجر التقنية"
                className="app-input w-full"
                autoFocus
              />
            </div>

            {/* Logo */}
            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <ImagePlus size={14} className="inline me-1.5 opacity-60" />
                شعار المتجر (اختياري)
              </label>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
              {logoDataUrl ? (
                <div className="relative flex items-center gap-4 rounded-2xl border p-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoDataUrl} alt="شعار" className="h-16 w-16 rounded-xl object-contain" style={{ background: "#f8fafc" }} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--foreground, #0f172a)" }}>تم رفع الشعار</p>
                    <button type="button" onClick={() => logoInputRef.current?.click()} className="mt-0.5 text-xs underline" style={{ color: "var(--accent, #60a5fa)" }}>
                      تغيير الصورة
                    </button>
                  </div>
                  <button type="button" onClick={() => { setLogoDataUrl(null); if (logoInputRef.current) logoInputRef.current.value = ""; }} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-red-50" style={{ color: "var(--muted, #94a3b8)" }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => logoInputRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed py-6 transition-colors hover:border-blue-300 hover:bg-blue-50/40" style={{ borderColor: "var(--border, #e2e8f0)" }}>
                  <ImagePlus size={28} strokeWidth={1.5} style={{ color: "var(--muted, #94a3b8)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--muted, #64748b)" }}>انقر لرفع شعار المتجر</span>
                  <span className="text-xs" style={{ color: "var(--muted, #94a3b8)" }}>PNG أو JPG — حتى 3 ميغابايت</span>
                </button>
              )}
            </div>

            {/* Phone */}
            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <Phone size={14} className="inline me-1.5 opacity-60" />
                رقم الهاتف (اختياري)
              </label>
              <input
                type="tel"
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
                placeholder="01012345678"
                className="app-input w-full"
                dir="ltr"
                onKeyDown={(e) => e.key === "Enter" && handleFinish()}
              />
            </div>

            {/* Default credentials reminder */}
            <div className="rounded-2xl border p-4" style={{ borderColor: "#fde68a", background: "#fffbeb" }}>
              <div className="flex items-start gap-2">
                <KeyRound size={16} className="mt-0.5 shrink-0" style={{ color: "#d97706" }} />
                <div>
                  <p className="text-sm font-bold" style={{ color: "#92400e" }}>بيانات تسجيل الدخول الافتراضية</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "#b45309" }}>
                    البريد: <span className="font-mono font-bold">admin@store.com</span><br />
                    كلمة المرور: <span className="font-mono font-bold">admin123</span><br />
                    <span className="mt-1 block">غيّر كلمة المرور من الإعدادات بعد الانتهاء.</span>
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
            )}

            <button
              onClick={handleFinish}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              style={{ background: "var(--accent, #60a5fa)" }}
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />}
              {saving ? "جاري الحفظ..." : "حفظ وبدء العمل"}
            </button>
          </div>
        )}

        {/* ── Step 2: Done ── */}
        {step === 2 && (
          <div className="flex flex-col items-center gap-6 py-4 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full" style={{ background: "#dcfce7" }}>
              <CheckCircle size={52} strokeWidth={1.5} color="#16a34a" />
            </div>
            <div>
              <h2 className="text-2xl font-black" style={{ color: "var(--foreground, #0f172a)" }}>
                تم إعداد المتجر! 🎉
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted, #64748b)" }}>
                تم حفظ معلومات <strong>{storeName}</strong> بنجاح.<br />
                يمكنك تعديل هذه المعلومات لاحقاً من الإعدادات.
              </p>
            </div>
            <button
              onClick={() => router.replace("/")}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold text-white transition-all hover:opacity-90"
              style={{ background: "#22c55e" }}
            >
              <CheckCircle size={18} />
              ابدأ الاستخدام
            </button>
          </div>
        )}
      </div>

      {step === 1 && (
        <p className="mt-6 text-center text-xs" style={{ color: "var(--muted, #94a3b8)" }}>
          يمكنك تغيير هذه المعلومات لاحقاً من الإعدادات
        </p>
      )}
    </div>
  );
}
