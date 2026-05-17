export default function Loading() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 py-16">
      <div
        className="relative h-14 w-14 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
        aria-hidden
      />
      <div className="max-w-md text-center">
        <p className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Loading workspace
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Preparing your data…
        </p>
      </div>
      <div className="grid w-full max-w-lg grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-xl animate-pulse"
            style={{ background: "var(--surface-muted)" }}
          />
        ))}
      </div>
    </div>
  );
}
