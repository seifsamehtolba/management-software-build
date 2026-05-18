"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Store, User, Lock, Phone, ChevronRight, CheckCircle, Loader2, ImagePlus, X } from "lucide-react";

type Step = 1 | 2 | 3;

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Owner account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Step 2: Logo
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError("حجم الصورة يجب أن يكون أقل من 3 ميغابايت");
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = (ev) => setLogoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  };

  // Step 2: Store info
  const [storeName, setStoreName] = useState("");
  const [storePhone, setStorePhone] = useState("");

  const validateStep1 = () => {
    if (!name.trim()) return "أدخل اسمك الكامل";
    if (!email.trim() || !email.includes("@")) return "أدخل بريد إلكتروني صحيح";
    if (password.length < 6) return "كلمة المرور يجب أن تكون 6 أحرف على الأقل";
    if (password !== confirmPassword) return "كلمات المرور غير متطابقة";
    return null;
  };

  const handleStep1Next = () => {
    const err = validateStep1();
    if (err) { setError(err); return; }
    setError("");
    setStep(2);
  };

  const handleFinish = async () => {
    if (!storeName.trim()) { setError("أدخل اسم المتجر"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, storeName, storePhone, storeLogo: logoDataUrl ?? undefined }),
      });
      if (res.ok) {
        setStep(3);
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

  const steps = [
    { num: 1, label: "حساب المالك" },
    { num: 2, label: "معلومات المتجر" },
    { num: 3, label: "جاهز!" },
  ];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--background, #f8fafc)" }}
      dir="rtl"
    >
      {/* Logo / title */}
      <div className="mb-10 flex flex-col items-center gap-3 text-center">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg"
          style={{ background: "var(--accent, #60a5fa)" }}
        >
          <Store size={40} strokeWidth={1.8} color="white" aria-hidden />
        </div>
        <h1 className="text-3xl font-black tracking-tight" style={{ color: "var(--foreground, #0f172a)" }}>
          إعداد المتجر
        </h1>
        <p className="text-base" style={{ color: "var(--muted, #64748b)" }}>
          اتبع الخطوات لإعداد برنامج إدارة متجرك
        </p>
      </div>

      {/* Step indicators */}
      <div className="mb-8 flex items-center gap-0">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all"
                style={{
                  background: step >= s.num
                    ? (step === 3 && s.num === 3 ? "#22c55e" : "var(--accent, #60a5fa)")
                    : "var(--border, #e2e8f0)",
                  color: step >= s.num ? "white" : "var(--muted, #94a3b8)",
                }}
              >
                {step > s.num ? <CheckCircle size={18} aria-hidden /> : s.num}
              </div>
              <span className="text-[11px] font-semibold" style={{ color: step >= s.num ? "var(--foreground, #0f172a)" : "var(--muted, #94a3b8)" }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="mb-5 mx-2 h-0.5 w-16 transition-all"
                style={{ background: step > s.num ? "var(--accent, #60a5fa)" : "var(--border, #e2e8f0)" }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <div
        className="w-full max-w-md rounded-3xl border p-8 shadow-xl"
        style={{
          background: "var(--surface, white)",
          borderColor: "var(--border, #e2e8f0)",
        }}
      >
        {/* ── Step 1: Account ── */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-black" style={{ color: "var(--foreground, #0f172a)" }}>
                أنشئ حساب المالك
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--muted, #64748b)" }}>
                هذا هو حساب صاحب المتجر الرئيسي — سيكون له صلاحية الوصول لكل شيء.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <User size={14} className="inline me-1.5 opacity-60" aria-hidden />
                الاسم الكامل
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: محمد علي"
                className="app-input w-full"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                البريد الإلكتروني (اسم الدخول)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                className="app-input w-full"
                dir="ltr"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <Lock size={14} className="inline me-1.5 opacity-60" aria-hidden />
                كلمة المرور
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6 أحرف على الأقل"
                className="app-input w-full"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                تأكيد كلمة المرور
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="أعد كتابة كلمة المرور"
                className="app-input w-full"
                onKeyDown={(e) => e.key === "Enter" && handleStep1Next()}
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handleStep1Next}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "var(--accent, #60a5fa)" }}
            >
              التالي
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        )}

        {/* ── Step 2: Store info ── */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-black" style={{ color: "var(--foreground, #0f172a)" }}>
                معلومات متجرك
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--muted, #64748b)" }}>
                هذه المعلومات ستظهر في الفواتير وأعلى البرنامج.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <Store size={14} className="inline me-1.5 opacity-60" aria-hidden />
                اسم المتجر
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

            {/* Logo upload */}
            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <ImagePlus size={14} className="inline me-1.5 opacity-60" aria-hidden />
                شعار المتجر (اختياري)
              </label>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
              {logoDataUrl ? (
                <div className="relative flex items-center gap-4 rounded-2xl border p-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoDataUrl} alt="شعار المتجر" className="h-16 w-16 rounded-xl object-contain" style={{ background: "#f8fafc" }} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--foreground, #0f172a)" }}>تم رفع الشعار</p>
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="mt-0.5 text-xs underline"
                      style={{ color: "var(--accent, #60a5fa)" }}
                    >
                      تغيير الصورة
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setLogoDataUrl(null); if (logoInputRef.current) logoInputRef.current.value = ""; }}
                    className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-red-50"
                    style={{ color: "var(--muted, #94a3b8)" }}
                    aria-label="حذف الشعار"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed py-6 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                  style={{ borderColor: "var(--border, #e2e8f0)" }}
                >
                  <ImagePlus size={28} strokeWidth={1.5} style={{ color: "var(--muted, #94a3b8)" }} aria-hidden />
                  <span className="text-sm font-medium" style={{ color: "var(--muted, #64748b)" }}>
                    انقر لرفع شعار المتجر
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted, #94a3b8)" }}>PNG أو JPG — حتى 3 ميغابايت</span>
                </button>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: "var(--foreground, #0f172a)" }}>
                <Phone size={14} className="inline me-1.5 opacity-60" aria-hidden />
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

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setError(""); setStep(1); }}
                className="flex-1 rounded-2xl border py-3.5 text-base font-bold transition-all hover:opacity-80"
                style={{ borderColor: "var(--border, #e2e8f0)", color: "var(--muted, #64748b)" }}
              >
                رجوع
              </button>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                style={{ background: "var(--accent, #60a5fa)" }}
              >
                {saving ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
                {saving ? "جاري الحفظ..." : "إنهاء الإعداد"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === 3 && (
          <div className="flex flex-col items-center gap-6 py-4 text-center">
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full"
              style={{ background: "#dcfce7" }}
            >
              <CheckCircle size={52} strokeWidth={1.5} color="#16a34a" aria-hidden />
            </div>
            <div>
              <h2 className="text-2xl font-black" style={{ color: "var(--foreground, #0f172a)" }}>
                تم الإعداد بنجاح! 🎉
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted, #64748b)" }}>
                تم إنشاء حساب المالك وإعداد المتجر.<br />
                الآن يمكنك تسجيل الدخول وبدء العمل.
              </p>
            </div>
            <button
              onClick={() => router.push("/login")}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "#22c55e" }}
            >
              <CheckCircle size={18} aria-hidden />
              تسجيل الدخول
            </button>
          </div>
        )}
      </div>

      {/* Footer note */}
      {step < 3 && (
        <p className="mt-6 text-center text-xs" style={{ color: "var(--muted, #94a3b8)" }}>
          يمكنك تغيير هذه المعلومات لاحقاً من الإعدادات
        </p>
      )}
    </div>
  );
}
