function AutomaticSkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800 ${className}`} />;
}

export function AutomaticAttendanceLoadingSkeleton() {
  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="border-b border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <AutomaticSkeletonBlock className="size-5 rounded-full" />
                <AutomaticSkeletonBlock className="h-4 w-44" />
              </div>
              <AutomaticSkeletonBlock className="mt-4 h-9 w-full max-w-3xl" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Cargando videos locales y estado de procesamiento...</p>
            </div>
            <div className="grid gap-2 sm:flex sm:justify-end">
              <AutomaticSkeletonBlock className="h-10 w-full sm:w-28" />
              <AutomaticSkeletonBlock className="h-10 w-full sm:w-44" />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {["Servicio local", "Videos en cola", "Ultimo trabajo"].map((label) => (
              <div key={label} className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">{label}</p>
                <AutomaticSkeletonBlock className="mt-3 h-8 w-24" />
              </div>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="rounded-md border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
            <AutomaticSkeletonBlock className="h-3 w-24" />
            <AutomaticSkeletonBlock className="mt-3 h-4 w-full max-w-xl" />
            <AutomaticSkeletonBlock className="mt-4 h-3 w-full rounded-full" />
            <AutomaticSkeletonBlock className="mt-3 h-3 w-64 max-w-full" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {["Videos pendientes", "Grabaciones y subida", "Procesados recientes"].map((title) => (
          <div key={title} className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <AutomaticSkeletonBlock className="h-4 w-40" />
              <AutomaticSkeletonBlock className="mt-2 h-3 w-56 max-w-full" />
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="px-4 py-4">
                  <AutomaticSkeletonBlock className="h-4 w-full" />
                  <AutomaticSkeletonBlock className="mt-3 h-3 w-3/4" />
                  <AutomaticSkeletonBlock className="mt-3 h-8 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
