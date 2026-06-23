function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800 ${className}`} />;
}

function SkeletonMetric() {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="mt-3 h-8 w-20" />
      <SkeletonBlock className="mt-3 h-3 w-32" />
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <SkeletonBlock className="h-4 w-40" />
        <SkeletonBlock className="h-7 w-20" />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1.2fr_0.8fr_0.7fr]" key={index}>
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppSkeleton() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[260px_1fr]">
        <aside className="hidden rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:block">
          <SkeletonBlock className="h-8 w-36" />
          <div className="mt-6 grid gap-2">
            {Array.from({ length: 9 }).map((_, index) => (
              <SkeletonBlock className="h-10 w-full" key={index} />
            ))}
          </div>
        </aside>

        <section className="min-w-0">
          <header className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonBlock className="mt-3 h-7 w-64 max-w-full" />
              </div>
              <div className="flex gap-2">
                <SkeletonBlock className="size-10" />
                <SkeletonBlock className="size-10" />
              </div>
            </div>
          </header>

          <div className="mt-5 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            Cargando informacion...
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonMetric key={index} />
            ))}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
            <SkeletonTable />
            <div className="grid gap-5">
              <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <SkeletonBlock className="h-5 w-36" />
                <SkeletonBlock className="mt-4 h-48 w-full" />
              </div>
              <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <SkeletonBlock className="h-5 w-44" />
                <SkeletonBlock className="mt-4 h-28 w-full" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export function RefreshSkeletonBar() {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-4 w-4 rounded-full" />
        <span>Actualizando informacion...</span>
      </div>
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonMetric key={index} />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <SkeletonTable />
        <div className="grid gap-5">
          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <SkeletonBlock className="h-5 w-40" />
            <SkeletonBlock className="mt-4 h-40 w-full" />
          </div>
          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <SkeletonBlock className="h-5 w-32" />
            <SkeletonBlock className="mt-4 h-24 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
