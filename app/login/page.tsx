"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
      return;
    }
    // First-run: if no users exist yet, go to setup wizard
    if (status === "unauthenticated") {
      fetch("/api/setup")
        .then((r) => r.json())
        .then((d: { needsSetup?: boolean }) => {
          if (d.needsSetup) router.replace("/setup");
        })
        .catch(() => {});
    }
  }, [status, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError(t.login.invalidCredentials);
      return;
    }

    router.push("/");
    router.refresh();
  };

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t.login.loading}</p>
      </main>
    );
  }

  if (status === "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t.login.redirecting}</p>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--background)" }}
    >
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo mark */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl border"
            style={{
              background: "color-mix(in srgb, var(--accent) 12%, var(--surface))",
              borderColor: "var(--border)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <LogIn size={26} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t.login.title}</h1>
        </div>

        <form
          onSubmit={onSubmit}
          className="app-card space-y-4"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t.login.emailLabel}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="app-input"
              autoComplete="email"
              inputMode="email"
            />
            <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
              {t.login.emailHint}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t.login.passwordLabel}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="app-input"
              autoComplete="current-password"
            />
            <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
              {t.login.passwordHint}
            </p>
          </div>

          {error ? (
            <p
              className="rounded-lg px-3 py-2 text-sm font-medium"
              style={{
                background: "color-mix(in srgb, var(--danger) 10%, transparent)",
                color: "var(--danger)",
                border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)",
              }}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="app-btn app-btn-primary w-full justify-center"
            style={{ height: "2.6rem" }}
          >
            {loading ? t.actions.signingIn : t.actions.signIn}
          </button>
        </form>
      </div>
    </main>
  );
}
