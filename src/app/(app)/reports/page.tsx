"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const ReportsView = dynamic(
  () => import("@/components/reports/reports-view").then((mod) => mod.ReportsView),
  {
    loading: () => (
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-12 w-48 rounded-xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    ),
  },
);

export default function ReportsPage() {
  return <ReportsView />;
}
